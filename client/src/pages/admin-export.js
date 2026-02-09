import { formatDateLong, formatDateShort, formatLocationShort, formatCurrency, formatPhoneDisplay } from './admin-utils';

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

const exportOrdersPdf = async ({ groupedPickups, groupDate, locationGroup }) => {
  const dateSuffix = groupDate || new Date().toISOString().split('T')[0];
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

export { exportOrdersPdf };
