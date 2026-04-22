#!/usr/bin/env python3
import argparse
import csv
from collections import OrderedDict
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer


FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--from-date", required=True)
    return parser.parse_args()


def register_font():
    for candidate in FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            pdfmetrics.registerFont(TTFont("AuditSans", str(path)))
            return "AuditSans"
    raise RuntimeError("No supported TTF font found for PDF rendering.")


def load_rows(csv_path):
    with open(csv_path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def build_styles(font_name):
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name="AuditTitle",
        fontName=font_name,
        fontSize=16,
        leading=20,
        textColor=colors.black,
        spaceAfter=8,
    ))
    styles.add(ParagraphStyle(
        name="AuditHeading",
        fontName=font_name,
        fontSize=11,
        leading=14,
        textColor=colors.black,
        spaceBefore=8,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="AuditBody",
        fontName=font_name,
        fontSize=9,
        leading=11,
        textColor=colors.black,
    ))
    styles.add(ParagraphStyle(
        name="AuditSmall",
        fontName=font_name,
        fontSize=8,
        leading=10,
        textColor=colors.black,
    ))
    styles.add(ParagraphStyle(
        name="AuditEntry",
        fontName=font_name,
        fontSize=9,
        leading=12,
        textColor=colors.black,
        spaceAfter=4,
    ))
    return styles


def summarize(rows):
    summary = {
        "total": len(rows),
        "ready": 0,
        "warning": 0,
        "blocked": 0,
        "suppressed": 0,
    }
    for row in rows:
        status = (row.get("status") or "").strip().lower()
        if status in summary:
            summary[status] += 1
    return summary


def build_entry(row, styles):
    lines = []
    email = (row.get("email") or "").strip()
    name = (row.get("customer_names") or "").strip()
    phone = (row.get("customer_phones") or "").strip()
    pickup_dates = (row.get("pickup_dates") or "").strip()
    pickup_locations = (row.get("pickup_locations") or "").strip()
    order_numbers = (row.get("order_numbers") or "").strip()
    reason = (row.get("reason") or "").strip()

    lines.append(f"<b>{email}</b>")

    if name or phone:
        contact = name or "Name not available"
        if phone:
            contact = f"{contact}  |  {phone}"
        lines.append(contact)

    pickup_parts = []
    if pickup_dates:
        pickup_parts.append(pickup_dates)
    if pickup_locations:
        pickup_parts.append(pickup_locations)
    if pickup_parts:
        lines.append("Pickup: " + "  |  ".join(pickup_parts))

    if order_numbers:
        lines.append(f"Orders: {order_numbers}")

    if reason:
        lines.append(f"Note: {reason}")

    return Paragraph("<br/>".join(lines), styles["AuditEntry"])


def group_rows_by_reason(rows):
    grouped = OrderedDict()
    for row in rows:
        reason = (row.get("reason") or "").strip() or "Unspecified"
        grouped.setdefault(reason, []).append(row)
    return grouped


def add_page_number(canvas, doc):
    canvas.setFont("AuditSans", 8)
    canvas.setFillColor(colors.black)
    canvas.drawRightString(doc.pagesize[0] - 0.5 * inch, 0.4 * inch, f"Page {doc.page}")


def main():
    args = parse_args()
    font_name = register_font()
    rows = load_rows(args.input)
    styles = build_styles(font_name)
    summary = summarize(rows)

    actionable_sections = [
        ("Suppressed", [row for row in rows if (row.get("status") or "").strip().lower() == "suppressed"]),
        ("Blocked", [row for row in rows if (row.get("status") or "").strip().lower() == "blocked"]),
        ("Warning", [row for row in rows if (row.get("status") or "").strip().lower() == "warning"]),
    ]

    story = []
    story.append(Paragraph("Email Audit", styles["AuditTitle"]))
    story.append(Paragraph(
        f"Orders from {args.from_date} forward<br/>"
        f"Total unique emails: {summary['total']}<br/>"
        f"Ready: {summary['ready']}<br/>"
        f"Warning: {summary['warning']}<br/>"
        f"Blocked: {summary['blocked']}<br/>"
        f"Suppressed: {summary['suppressed']}",
        styles["AuditBody"],
    ))
    story.append(Spacer(1, 0.14 * inch))

    has_actionable = False
    for title, section_rows in actionable_sections:
        if not section_rows:
            continue
        has_actionable = True
        story.append(Paragraph(f"{title} ({len(section_rows)})", styles["AuditHeading"]))
        for reason, reason_rows in group_rows_by_reason(section_rows).items():
            story.append(Paragraph(reason, styles["AuditBody"]))
            story.append(Spacer(1, 0.05 * inch))
            for row in reason_rows:
                story.append(build_entry(row, styles))
                story.append(Spacer(1, 0.08 * inch))
            story.append(Spacer(1, 0.06 * inch))

    if not has_actionable:
        story.append(Paragraph("No warning, blocked, or suppressed addresses found.", styles["AuditBody"]))

    doc = SimpleDocTemplate(
        args.output,
        pagesize=letter,
        leftMargin=0.5 * inch,
        rightMargin=0.5 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.55 * inch,
        title="Upcoming Orders Email Audit",
    )
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)


if __name__ == "__main__":
    main()
