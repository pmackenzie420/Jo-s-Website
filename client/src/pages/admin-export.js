import {
  formatDateLong,
  formatDateShort,
  formatLocationShort,
  formatCurrency,
  formatPhoneDisplay,
  normalizeDate
} from './admin-utils';

const INVOICE_TEMPLATE_SRC = '/Facture - Les Fermes Soulard - Edited2.jpg';
const INVOICE_BASE_WIDTH = 1650;
const INVOICE_BASE_HEIGHT = 2550;
const INVOICE_FONT_FAMILY = 'Arial, "DejaVu Sans", "DejaVuSans", "Liberation Sans", sans-serif';
const INVOICE_FONT_SIZES = {
  clientMeta: 44,
  description: 30,
  number: 30,
  grandTotal: 40,
  factureNumber: 76
};
const INVOICE_LAYOUT = {
  clientX: 190,
  clientYRows: [708, 778, 848],
  clientNameMaxWidth: 690,
  clientContactMaxWidth: 690,
  clientAddressMaxWidth: 690,
  dateX: 1025,
  dateY: 707,
  sellerX: 1025,
  sellerY: 777,
  headerNoRightX: 1538,
  headerNoY: 284,
  qtyCenterBox: [72, 327],
  descX: 340,
  descMaxWidth: 660,
  priceCenterBox: [1013, 1299],
  amountCenterBox: [1299, 1490],
  amountDividerX: 1538,
  amountCentsXOffset: 10,
  priceNudgeX: 0,
  amountNudgeX: -66,
  totalNudgeX: -65,
  rowY: [1040, 1098, 1157, 1216, 1275],
  totalY: 2270,
  paymentSummaryY: 2340
};

const getExportTitle = (groupDate, locationLabel) => {
  if (groupDate && locationLabel) {
    return `Orders - ${formatDateLong(groupDate)} (${locationLabel})`;
  }
  return `Orders - ${formatDateLong(new Date())}`;
};

const buildOrdersTableRowsForGroup = (groupDate, locationGroup) => {
  const rows = [];
  locationGroup.orders.forEach((order) => {
    rows.push([
      formatDateShort(groupDate),
      formatLocationShort(locationGroup.locationLabel),
      order.customerName,
      formatPhoneDisplay(order.customerPhone || ''),
      order.customerEmail || '',
      order.customerAddress || '',
      order.itemSummaryCompact || `${order.itemCount} items`,
      formatCurrency(order.totalAmount),
      order.amountDue > 0 ? 'Deposit' : 'Paid',
      order.amountDue > 0 ? formatCurrency(order.amountDue) : '$0.00'
    ]);
  });
  if (rows.length === 0) {
    rows.push(['No orders', '', '', '', '', '', '', '', '', '']);
  }
  return rows;
};

const savePdfDocument = (doc, filename) => {
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && 'ontouchend' in document);

  if (isIOS) {
    const pdfBlob = doc.output('blob');
    const pdfUrl = window.URL.createObjectURL(pdfBlob);
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(pdfUrl);
    return;
  }

  doc.save(filename);
};

const parseAmount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const parseAmountFromCents = (value) => {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return 0;
  return cents / 100;
};

const parseLineAmount = (item, quantity, unitAmount) => {
  const lineCents = Number(item?.lineCents ?? item?.line_cents ?? 0);
  if (Number.isFinite(lineCents) && lineCents > 0) {
    return lineCents / 100;
  }
  return Math.max(quantity, 0) * unitAmount;
};

const parseUnitAmount = (item, quantity) => {
  const unitCents = Number(item?.unitCents ?? item?.unit_cents ?? 0);
  if (Number.isFinite(unitCents) && unitCents > 0) {
    return unitCents / 100;
  }
  const lineCents = Number(item?.lineCents ?? item?.line_cents ?? 0);
  if (Number.isFinite(lineCents) && lineCents > 0 && quantity > 0) {
    return (lineCents / 100) / quantity;
  }
  return 0;
};

const byInvoiceOrder = (first, second) => {
  const dateA = normalizeDate(first?.pickupDate || first?.pickup_date || first?.created_at || first?.orderDate);
  const dateB = normalizeDate(second?.pickupDate || second?.pickup_date || second?.created_at || second?.orderDate);
  if (dateA !== dateB) return dateA.localeCompare(dateB);

  const locationA = String(first?.pickupLocationLabel || first?.pickupLocation || first?.pickup_location || '');
  const locationB = String(second?.pickupLocationLabel || second?.pickupLocation || second?.pickup_location || '');
  if (locationA !== locationB) return locationA.localeCompare(locationB);

  const customerA = String(first?.customerName || first?.customer_name || '');
  const customerB = String(second?.customerName || second?.customer_name || '');
  if (customerA !== customerB) return customerA.localeCompare(customerB);

  return String(first?.id || '').localeCompare(String(second?.id || ''), undefined, { numeric: true });
};

const collectLocationOrderIds = (locationGroup) => {
  if (!Array.isArray(locationGroup?.orders)) return null;
  const ids = new Set();
  locationGroup.orders.forEach((entry) => {
    if (Array.isArray(entry?.orderIds)) {
      entry.orderIds.forEach((id) => {
        if (id !== null && id !== undefined) ids.add(String(id));
      });
      return;
    }
    if (entry?.id !== null && entry?.id !== undefined) {
      ids.add(String(entry.id));
    }
  });
  return ids.size ? ids : null;
};

const buildInvoiceOrdersForExport = ({ orders = [], groupDate, locationGroup }) => {
  const locationOrderIds = collectLocationOrderIds(locationGroup);
  return (Array.isArray(orders) ? orders : [])
    .filter((order) => {
      const status = String(order?.status || '').trim().toLowerCase();
      if (status === 'cancelled' || status === 'archived' || status === 'reserved') {
        return false;
      }

      if (groupDate && normalizeDate(order?.pickupDate || order?.pickup_date) !== groupDate) {
        return false;
      }
      if (locationGroup?.location) {
        const orderLocation = String(order?.pickupLocation || order?.pickup_location || '');
        if (orderLocation !== String(locationGroup.location)) {
          return false;
        }
      }
      if (locationOrderIds && !locationOrderIds.has(String(order?.id || ''))) {
        return false;
      }
      return true;
    })
    .sort(byInvoiceOrder);
};

const loadImageElement = (src) => (
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  })
);

const loadInvoiceTemplate = async () => {
  const sourceImage = await loadImageElement(encodeURI(INVOICE_TEMPLATE_SRC));
  const imageWidth = sourceImage.naturalWidth || sourceImage.width || INVOICE_BASE_WIDTH;
  const imageHeight = sourceImage.naturalHeight || sourceImage.height || INVOICE_BASE_HEIGHT;
  const pageWidth = Math.max(Math.round(imageWidth), 1);
  const pageHeight = Math.max(Math.round(imageHeight), 1);

  return {
    pageWidth,
    pageHeight,
    sourceImage
  };
};

const setCanvasFont = (context, size, options = {}) => {
  const weight = options.bold ? 'bold' : 'normal';
  context.font = `${weight} ${size}px ${INVOICE_FONT_FAMILY}`;
};

const fitCanvasTextToWidth = (context, value, maxWidth) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return text;
  if (context.measureText(text).width <= maxWidth) return text;

  const ellipsis = '...';
  let result = text;
  while (result.length > 0 && context.measureText(`${result}${ellipsis}`).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result ? `${result.trimEnd()}${ellipsis}` : ellipsis;
};

const drawCanvasRight = (context, text, xRight, y, maxWidth) => {
  const safeText = fitCanvasTextToWidth(context, text, maxWidth);
  const textWidth = context.measureText(safeText).width;
  context.fillText(safeText, xRight - textWidth, y);
};

const drawCanvasCenteredInBox = (context, text, x1, x2, y, maxWidth) => {
  const safeText = fitCanvasTextToWidth(context, text, maxWidth ?? (x2 - x1));
  const textWidth = context.measureText(safeText).width;
  const startX = x1 + ((x2 - x1 - textWidth) / 2);
  context.fillText(safeText, startX, y);
};

const splitCurrencyParts = (amount) => {
  const safeAmount = parseAmount(amount);
  const centsValue = Math.round(safeAmount * 100);
  const dollars = Math.floor(Math.abs(centsValue) / 100);
  const cents = Math.abs(centsValue) % 100;
  const sign = centsValue < 0 ? '-' : '';
  return {
    dollars: `${sign}${dollars.toLocaleString('en-US')}`,
    cents: String(cents).padStart(2, '0')
  };
};

const drawAmountWithDivider = (context, amount, y, options = {}) => {
  const parts = splitCurrencyParts(amount);
  const xOffset = Number(options?.xOffset || 0);
  const dividerX = INVOICE_LAYOUT.amountDividerX + xOffset;
  const dollarsRightX = dividerX - 8;
  const centsX = dividerX + INVOICE_LAYOUT.amountCentsXOffset;

  drawCanvasRight(context, parts.dollars, dollarsRightX, y, 220);
  context.fillText(`${parts.cents} $`, centsX, y);
};

const buildInvoiceClientLines = (order, context, maxWidth) => {
  const name = String(order?.customerName || order?.customer_name || 'Guest').trim();
  const phone = formatPhoneDisplay(String(order?.customerPhone || order?.customer_phone || '').trim());
  const address = String(order?.customerAddress || order?.customer_address || '').trim();
  const pickupDate = normalizeDate(order?.pickupDate || order?.pickup_date || order?.created_at);
  const pickupLocation = String(order?.pickupLocationLabel || order?.pickupLocation || order?.pickup_location || '')
    .trim();
  const nameMaxWidth = Math.min(maxWidth, Number(INVOICE_LAYOUT.clientNameMaxWidth) || maxWidth);
  const contactMaxWidth = Math.min(maxWidth, Number(INVOICE_LAYOUT.clientContactMaxWidth) || maxWidth);
  const addressMaxWidth = Math.min(maxWidth, Number(INVOICE_LAYOUT.clientAddressMaxWidth) || maxWidth);

  const contactLine = phone;
  const fallbackLine = [pickupDate, pickupLocation].filter(Boolean).join(' | ');
  return [
    fitCanvasTextToWidth(context, name, nameMaxWidth),
    fitCanvasTextToWidth(context, contactLine || fallbackLine, contactMaxWidth),
    fitCanvasTextToWidth(context, address || fallbackLine, addressMaxWidth)
  ];
};

const normalizeInvoiceItems = (orderItems = []) => {
  const grouped = new Map();
  (Array.isArray(orderItems) ? orderItems : []).forEach((item) => {
    const quantityRaw = Number(item?.quantity ?? item?.qty ?? 0);
    const quantity = Number.isFinite(quantityRaw) ? Math.floor(quantityRaw) : 0;
    if (quantity <= 0) return;

    const unitAmount = parseUnitAmount(item, quantity);
    const lineAmount = parseLineAmount(item, quantity, unitAmount);
    const description = String(item?.displayName || item?.name || 'Item').trim() || 'Item';
    const key = `${description}::${unitAmount.toFixed(2)}`;
    const current = grouped.get(key) || {
      quantity: 0,
      description,
      unitAmount,
      lineAmount: 0
    };
    grouped.set(key, {
      quantity: current.quantity + quantity,
      description,
      unitAmount,
      lineAmount: current.lineAmount + lineAmount
    });
  });
  return Array.from(grouped.values()).sort((a, b) => a.description.localeCompare(b.description));
};

const clampItemsToTemplateRows = (items) => {
  const maxRows = INVOICE_LAYOUT.rowY.length;
  if (items.length <= maxRows) return items;
  const keep = maxRows - 1;
  const visible = items.slice(0, keep);
  const overflow = items.slice(keep);
  const mergedQuantity = overflow.reduce((sum, item) => sum + item.quantity, 0);
  const mergedLineAmount = overflow.reduce((sum, item) => sum + item.lineAmount, 0);
  visible.push({
    quantity: mergedQuantity,
    description: `Additional items (${overflow.length})`,
    unitAmount: mergedQuantity > 0 ? mergedLineAmount / mergedQuantity : 0,
    lineAmount: mergedLineAmount
  });
  return visible;
};

const renderInvoicePage = ({
  doc,
  order,
  template,
  invoiceNumber
}) => {
  const canvas = document.createElement('canvas');
  canvas.width = template.pageWidth;
  canvas.height = template.pageHeight;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not initialize invoice drawing context.');
  }

  context.drawImage(template.sourceImage, 0, 0, template.pageWidth, template.pageHeight);
  context.textBaseline = 'top';
  context.textAlign = 'left';

  const dateText = normalizeDate(order?.orderDate || order?.created_at || order?.pickupDate || new Date());
  const darkColor = 'rgb(55, 55, 55)';
  const redColor = 'rgb(220, 25, 35)';

  setCanvasFont(context, INVOICE_FONT_SIZES.factureNumber, { bold: true });
  context.fillStyle = redColor;
  context.strokeStyle = redColor;
  context.lineWidth = 2;
  const numberText = fitCanvasTextToWidth(context, invoiceNumber, 260);
  const numberWidth = context.measureText(numberText).width;
  const numberX = INVOICE_LAYOUT.headerNoRightX - numberWidth;
  context.strokeText(numberText, numberX, INVOICE_LAYOUT.headerNoY);
  context.fillText(numberText, numberX, INVOICE_LAYOUT.headerNoY);

  setCanvasFont(context, INVOICE_FONT_SIZES.clientMeta);
  context.fillStyle = darkColor;
  const clientLines = buildInvoiceClientLines(order, context, 780);
  clientLines.forEach((line, index) => {
    if (index < INVOICE_LAYOUT.clientYRows.length) {
      context.fillText(line, INVOICE_LAYOUT.clientX, INVOICE_LAYOUT.clientYRows[index]);
    }
  });
  context.fillText(
    fitCanvasTextToWidth(context, dateText, 420),
    INVOICE_LAYOUT.dateX,
    INVOICE_LAYOUT.dateY
  );
  context.fillText('Les Fermes Soulard S.E.N.C', INVOICE_LAYOUT.sellerX, INVOICE_LAYOUT.sellerY);

  const normalizedItems = normalizeInvoiceItems(order?.orderItems || order?.items || []);
  const items = clampItemsToTemplateRows(normalizedItems);

  setCanvasFont(context, INVOICE_FONT_SIZES.number);
  context.fillStyle = darkColor;
  items.forEach((item, index) => {
    const rowY = INVOICE_LAYOUT.rowY[index];
    if (!Number.isFinite(rowY)) return;
    const qtyText = String(Math.max(item.quantity, 0));
    const unitText = `${parseAmount(item.unitAmount).toFixed(2)} $`;

    drawCanvasCenteredInBox(
      context,
      qtyText,
      INVOICE_LAYOUT.qtyCenterBox[0],
      INVOICE_LAYOUT.qtyCenterBox[1],
      rowY,
      120
    );

    setCanvasFont(context, INVOICE_FONT_SIZES.description);
    context.fillText(
      fitCanvasTextToWidth(context, item.description, INVOICE_LAYOUT.descMaxWidth),
      INVOICE_LAYOUT.descX,
      rowY
    );
    setCanvasFont(context, INVOICE_FONT_SIZES.number);

    drawCanvasCenteredInBox(
      context,
      unitText,
      INVOICE_LAYOUT.priceCenterBox[0] + INVOICE_LAYOUT.priceNudgeX,
      INVOICE_LAYOUT.priceCenterBox[1] + INVOICE_LAYOUT.priceNudgeX,
      rowY,
      250
    );
    drawAmountWithDivider(context, parseAmount(item.lineAmount), rowY, {
      xOffset: INVOICE_LAYOUT.amountNudgeX
    });
  });

  const totalAmount = parseAmount(order?.totalAmount) || parseAmountFromCents(order?.total_cents);
  setCanvasFont(context, INVOICE_FONT_SIZES.grandTotal);
  drawAmountWithDivider(context, totalAmount, INVOICE_LAYOUT.totalY, {
    xOffset: INVOICE_LAYOUT.totalNudgeX
  });

  doc.addImage(canvas, 'JPEG', 0, 0, template.pageWidth, template.pageHeight, undefined, 'FAST');
};

const exportOrdersPdf = async ({ groupedPickups, groupDate, locationGroup }) => {
  const dateSuffix = groupDate || normalizeDate(new Date());
  const locationSuffix = locationGroup?.location || 'all';
  const filename = `orders-${dateSuffix}-${locationSuffix}.pdf`;
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable')
  ]);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter'
  });

  const tableConfig = {
    head: [
      [
        'Date',
        'Loc',
        'Customer',
        'Phone',
        'Email',
        'Address',
        'Items',
        'Total',
        'Pay',
        'Due'
      ]
    ],
    styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: [47, 107, 63], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 45 },
      1: { cellWidth: 40 },
      2: { cellWidth: 80 },
      3: { cellWidth: 70 },
      4: { cellWidth: 90 },
      5: { cellWidth: 120 },
      6: { cellWidth: 120 },
      7: { cellWidth: 50 },
      8: { cellWidth: 40 },
      9: { cellWidth: 55 }
    }
  };

  let yPos = 40;

  const renderTable = (rows, title) => {
    const pageHeight = doc.internal.pageSize.height;
    if (yPos + 60 > pageHeight) {
      doc.addPage();
      yPos = 40;
    }

    doc.setFontSize(14);
    doc.text(title, 40, yPos);
    yPos += 15;

    autoTable(doc, {
      ...tableConfig,
      body: rows,
      startY: yPos,
      margin: { bottom: 40 }
    });

    yPos = doc.lastAutoTable.finalY + 30;
  };

  if (locationGroup) {
    const rows = buildOrdersTableRowsForGroup(groupDate, locationGroup);
    const title = getExportTitle(groupDate, locationGroup.locationLabel);
    renderTable(rows, title);
  } else {
    doc.setFontSize(18);
    doc.text('All Orders', 40, yPos);
    yPos += 30;

    let hasContent = false;
    groupedPickups.forEach((group) => {
      group.locations.forEach((locationItem) => {
        const rows = buildOrdersTableRowsForGroup(group.date, locationItem);
        const title = `${formatDateLong(group.date)} - ${locationItem.locationLabel}`;
        renderTable(rows, title);
        hasContent = true;
      });
    });

    if (!hasContent) {
      doc.setFontSize(12);
      doc.text('No orders found.', 40, yPos);
    }
  }

  savePdfDocument(doc, filename);
};

const exportInvoicesPdf = async ({ orders, groupDate, locationGroup }) => {
  const invoiceOrders = buildInvoiceOrdersForExport({
    orders,
    groupDate,
    locationGroup
  });
  if (invoiceOrders.length === 0) {
    throw new Error('No orders available for invoice export.');
  }

  const [{ jsPDF }, template] = await Promise.all([
    import('jspdf'),
    loadInvoiceTemplate()
  ]);

  const dateSuffix = groupDate || normalizeDate(new Date());
  const locationSuffix = locationGroup?.location || 'all';
  const filename = `invoices-${dateSuffix}-${locationSuffix}.pdf`;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'px',
    format: [template.pageWidth, template.pageHeight]
  });

  invoiceOrders.forEach((order, index) => {
    if (index > 0) {
      doc.addPage([template.pageWidth, template.pageHeight], 'portrait');
    }
    renderInvoicePage({
      doc,
      order,
      template,
      invoiceNumber: String(index + 1)
    });
  });

  savePdfDocument(doc, filename);
};

export { exportOrdersPdf, exportInvoicesPdf };
