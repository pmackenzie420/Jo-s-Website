#!/usr/bin/env python3
"""
Fill Les Fermes Soulard invoice templates with dummy or custom data.

Usage:
  python fill_invoice.py --input "Facture - Les Fermes Soulard - Edited.jpg"
  python fill_invoice.py --input "Facture - Les Fermes Soulard - Edited2.jpg"
  python fill_invoice.py --input template.png --layout original --data-json data.json
  python fill_invoice.py --input template.png --output out.png
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw, ImageFont


@dataclass
class InvoiceItem:
    qty: int
    description: str
    unit_price: Decimal


@dataclass
class InvoiceData:
    client_lines: List[str]
    date: str
    seller: str
    invoice_no: Optional[str]
    order_no: Optional[str]
    items: List[InvoiceItem]


@dataclass
class Layout:
    name: str
    has_order_no: bool
    client_x: int
    client_y_rows: List[int]
    date_xy: tuple[int, int]
    seller_xy: tuple[int, int]
    header_no_right_x: Optional[int] = None
    header_no_y: Optional[int] = None
    seller_center_box: Optional[tuple[int, int]] = None
    order_xy: Optional[tuple[int, int]] = None
    order_center_box: Optional[tuple[int, int]] = None
    qty_center_box: Optional[tuple[int, int]] = None
    price_center_box: Optional[tuple[int, int]] = None
    amount_center_box: Optional[tuple[int, int]] = None
    qty_right: int = 305
    desc_x: int = 340
    price_right: int = 1270
    amount_right: int = 1470
    row_y: List[int] = None  # type: ignore[assignment]
    subtotal_y: int = 2108
    tps_y: int = 2168
    tvq_y: int = 2227
    total_y: int = 2285


DEFAULT_DATA = InvoiceData(
    client_lines=[
        "Bistro du Coin",
        "1287 rue Saint-Denis",
        "Montreal, QC H2X 3J6",
    ],
    date="2026-03-04",
    seller="P. Mackenzie",
    invoice_no="4001",
    order_no="CMD-2026-031",
    items=[
        InvoiceItem(4, "Oeufs fermiers (douzaine)", Decimal("7.50")),
        InvoiceItem(6, "Poulet entier", Decimal("16.00")),
        InvoiceItem(3, "Miel local 500 g", Decimal("11.25")),
        InvoiceItem(8, "Pain de campagne", Decimal("5.75")),
        InvoiceItem(2, "Panier de legumes", Decimal("24.00")),
    ],
)


LAYOUTS: Dict[str, Layout] = {
    "original": Layout(
        name="original",
        has_order_no=True,
        client_x=190,
        client_y_rows=[715, 785, 855],
        date_xy=(1060, 715),
        seller_xy=(0, 840),  # centered in seller box
        # Template already contains 4001 pre-printed.
        seller_center_box=(958, 1211),
        order_xy=(0, 840),  # centered in order box
        order_center_box=(1211, 1450),
        qty_center_box=(72, 327),
        price_center_box=(1013, 1299),
        amount_center_box=(1299, 1490),
        row_y=[1098, 1157, 1216, 1275, 1334],
    ),
    "edited": Layout(
        name="edited",
        has_order_no=False,
        client_x=190,
        client_y_rows=[715, 785, 855],
        date_xy=(1035, 715),
        seller_xy=(1035, 840),
        header_no_right_x=1538,
        header_no_y=284,
        qty_center_box=(72, 327),
        price_center_box=(1013, 1299),
        amount_center_box=(1299, 1490),
        row_y=[1098, 1157, 1216, 1275, 1334],
    ),
    "edited2": Layout(
        name="edited2",
        has_order_no=False,
        client_x=190,
        client_y_rows=[711, 781, 851],
        # Date/seller lines shifted right and both should be line-aligned.
        date_xy=(1025, 710),
        seller_xy=(1025, 780),
        header_no_right_x=1538,
        header_no_y=284,
        qty_center_box=(72, 327),
        price_center_box=(1013, 1299),
        amount_center_box=(1299, 1490),
        row_y=[1098, 1157, 1216, 1275, 1334],
        total_y=2270,
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fill invoice template with data.")
    parser.add_argument("--input", required=True, help="Input invoice template image path.")
    parser.add_argument(
        "--output",
        help=(
            "Output image path. If omitted, writes '<input name> - dummy.png' in the same folder "
            "and overwrites that same file on repeated runs."
        ),
    )
    parser.add_argument(
        "--layout",
        choices=["original", "edited", "edited2", "auto"],
        default="auto",
        help="Template layout variant (default: auto-detect).",
    )
    parser.add_argument(
        "--data-json",
        help=(
            "Optional JSON file overriding default data. "
            "Keys: client_lines, date, seller, invoice_no, order_no, items."
        ),
    )
    parser.add_argument("--font", help="Optional TTF font path.")
    return parser.parse_args()


def pick_font_path(preferred: Optional[str]) -> Optional[str]:
    candidates = [
        preferred,
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def pick_bold_font_path(regular_font_path: Optional[str]) -> Optional[str]:
    if not regular_font_path:
        return None

    candidates = [regular_font_path]
    dirname = os.path.dirname(regular_font_path)
    basename = os.path.basename(regular_font_path)
    stem, ext = os.path.splitext(basename)

    candidates.extend(
        [
            os.path.join(dirname, f"{stem} Bold{ext}"),
            os.path.join(dirname, f"{stem}-Bold{ext}"),
            os.path.join(dirname, "Arial Bold.ttf"),
            os.path.join(dirname, "DejaVuSans-Bold.ttf"),
        ]
    )

    for path in candidates:
        if os.path.exists(path):
            return path
    return regular_font_path


def load_data(json_path: Optional[str]) -> InvoiceData:
    if not json_path:
        return DEFAULT_DATA

    with open(json_path, "r", encoding="utf-8") as f:
        raw: Dict[str, Any] = json.load(f)

    client_lines = raw.get("client_lines", DEFAULT_DATA.client_lines)
    date = raw.get("date", DEFAULT_DATA.date)
    seller = raw.get("seller", DEFAULT_DATA.seller)
    order_no = raw.get("order_no", DEFAULT_DATA.order_no)
    invoice_no = raw.get("invoice_no")
    if invoice_no is None:
        invoice_no = order_no if order_no is not None else DEFAULT_DATA.invoice_no
    raw_items = raw.get("items", [])

    if not raw_items:
        items = DEFAULT_DATA.items
    else:
        items = []
        for i, item in enumerate(raw_items, start=1):
            try:
                qty = int(item["qty"])
                description = str(item["description"])
                unit_price = Decimal(str(item["unit_price"]))
            except Exception as exc:
                raise ValueError(f"Invalid item at index {i}: {item}") from exc
            items.append(InvoiceItem(qty, description, unit_price))

    return InvoiceData(
        client_lines=list(client_lines)[:3],
        date=str(date),
        seller=str(seller),
        invoice_no=None if invoice_no is None else str(invoice_no),
        order_no=None if order_no is None else str(order_no),
        items=items[: len(LAYOUTS["edited"].row_y)],
    )


def detect_layout(image: Image.Image, input_name: str) -> str:
    name = input_name.lower()
    if "edited2" in name:
        return "edited2"
    if "edited" in name:
        return "edited"

    # In original template, there is a vertical divider near x=1211 between vendeur/commande.
    gray = image.convert("L")
    px = gray.load()
    dark = 0
    x = 1211
    for y in range(780, 900):
        if px[x, y] < 110:
            dark += 1
    if dark > 40:
        return "original"

    # Distinguish edited vs edited2 by where the right-side DATE line starts.
    # edited ~ x=950-960, edited2 ~ x=1000+.
    y = 758
    run_start = None
    run_len = 0
    for x in range(860, min(image.width, 1620)):
        is_dark = px[x, y] < 145
        if is_dark:
            if run_start is None:
                run_start = x
            run_len += 1
        else:
            if run_len >= 200 and run_start is not None:
                return "edited2" if run_start >= 990 else "edited"
            run_start = None
            run_len = 0

    if run_len >= 200 and run_start is not None:
        return "edited2" if run_start >= 990 else "edited"

    return "edited"


def default_output_path(input_path: str) -> str:
    directory = os.path.dirname(input_path)
    stem = os.path.splitext(os.path.basename(input_path))[0]
    filename = f"{stem} - dummy.png"
    return os.path.join(directory, filename)


def to_decimal(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    x0, _, x1, _ = draw.textbbox((0, 0), text, font=font)
    return x1 - x0


def draw_right(
    draw: ImageDraw.ImageDraw,
    x_right: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    ink: tuple[int, int, int, int],
    stroke_width: int = 0,
    stroke_fill: Optional[tuple[int, int, int, int]] = None,
) -> None:
    draw.text(
        (x_right - text_width(draw, text, font), y),
        text,
        font=font,
        fill=ink,
        stroke_width=stroke_width,
        stroke_fill=stroke_fill,
    )


def draw_center(
    draw: ImageDraw.ImageDraw,
    x1: int,
    x2: int,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    ink: tuple[int, int, int, int],
) -> None:
    width = text_width(draw, text, font)
    draw.text((x1 + (x2 - x1 - width) // 2, y), text, font=font, fill=ink)


def fill_invoice(
    image: Image.Image,
    data: InvoiceData,
    layout: Layout,
    font_path: Optional[str],
) -> tuple[Image.Image, Dict[str, Decimal]]:
    img = image.convert("RGBA")
    draw = ImageDraw.Draw(img)

    if font_path:
        bold_font_path = pick_bold_font_path(font_path)
        font_client = ImageFont.truetype(font_path, 44)
        font_meta = ImageFont.truetype(font_path, 34)
        font_desc = ImageFont.truetype(font_path, 30)
        font_num = ImageFont.truetype(font_path, 30)
        font_total = ImageFont.truetype(font_path, 40)
        font_header_no = ImageFont.truetype(bold_font_path or font_path, 76)
    else:
        font_client = ImageFont.load_default()
        font_meta = ImageFont.load_default()
        font_desc = ImageFont.load_default()
        font_num = ImageFont.load_default()
        font_total = ImageFont.load_default()
        font_header_no = ImageFont.load_default()

    ink = (55, 55, 55, 255)
    red_ink = (220, 25, 35, 255)

    # Client lines
    for i, y in enumerate(layout.client_y_rows):
        line = data.client_lines[i] if i < len(data.client_lines) else ""
        draw.text((layout.client_x, y), line, fill=ink, font=font_client)

    # Date
    draw.text(layout.date_xy, data.date, fill=ink, font=font_client)

    # Header invoice/order number under FACTURE (edited layout).
    if layout.header_no_right_x and layout.header_no_y and data.invoice_no:
        draw_right(
            draw,
            layout.header_no_right_x,
            layout.header_no_y,
            data.invoice_no,
            font_header_no,
            red_ink,
            stroke_width=2,
            stroke_fill=red_ink,
        )

    # Seller / Order
    if layout.seller_center_box:
        draw_center(
            draw,
            layout.seller_center_box[0],
            layout.seller_center_box[1],
            layout.seller_xy[1],
            data.seller,
            font_client,
            ink,
        )
    else:
        draw.text(layout.seller_xy, data.seller, fill=ink, font=font_client)

    if layout.has_order_no and data.order_no:
        if layout.order_center_box:
            draw_center(
                draw,
                layout.order_center_box[0],
                layout.order_center_box[1],
                layout.order_xy[1],  # type: ignore[index]
                data.order_no,
                font_meta,
                ink,
            )
        elif layout.order_xy:
            draw.text(layout.order_xy, data.order_no, fill=ink, font=font_meta)

    # Items table
    subtotal = Decimal("0.00")
    for y, item in zip(layout.row_y, data.items):
        line_total = to_decimal(Decimal(item.qty) * item.unit_price)
        subtotal += line_total

        if layout.qty_center_box:
            draw_center(
                draw,
                layout.qty_center_box[0],
                layout.qty_center_box[1],
                y,
                str(item.qty),
                font_num,
                ink,
            )
        else:
            draw_right(draw, layout.qty_right, y, str(item.qty), font_num, ink)
        draw.text((layout.desc_x, y), item.description, fill=ink, font=font_desc)
        if layout.price_center_box:
            draw_center(
                draw,
                layout.price_center_box[0],
                layout.price_center_box[1],
                y,
                f"{item.unit_price:.2f} $",
                font_num,
                ink,
            )
        else:
            draw_right(draw, layout.price_right, y, f"{item.unit_price:.2f} $", font_num, ink)
        if layout.amount_center_box:
            draw_center(
                draw,
                layout.amount_center_box[0],
                layout.amount_center_box[1],
                y,
                f"{line_total:.2f} $",
                font_num,
                ink,
            )
        else:
            draw_right(draw, layout.amount_right, y, f"{line_total:.2f} $", font_num, ink)

    # Final invoice total without taxes.
    grand_total = to_decimal(subtotal)
    draw_right(draw, layout.amount_right, layout.total_y, f"{grand_total:.2f} $", font_total, ink)

    totals = {"grand_total": grand_total}
    return img, totals


def main() -> None:
    args = parse_args()

    image = Image.open(args.input)
    layout_name = args.layout if args.layout != "auto" else detect_layout(image, os.path.basename(args.input))
    layout = LAYOUTS[layout_name]

    data = load_data(args.data_json)
    if layout.has_order_no and not data.order_no:
        data.order_no = DEFAULT_DATA.order_no

    font_path = pick_font_path(args.font)
    if not font_path:
        print("Warning: no TTF font found, using Pillow default bitmap font.")

    output_path = args.output or default_output_path(args.input)
    filled, totals = fill_invoice(image, data, layout, font_path)
    filled.save(output_path)

    print(f"Input: {args.input}")
    print(f"Layout: {layout_name}")
    print(f"Output: {output_path}")
    print(f"Grand total (no tax): {totals['grand_total']:.2f}")


if __name__ == "__main__":
    main()
