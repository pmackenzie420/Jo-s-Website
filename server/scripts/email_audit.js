const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = require('../db');
const {
    ensureEmailOpsSchema,
    verifyManagedEmailAddress
} = require('../logic/email-ops');
const { verifyCheckoutEmail } = require('../logic/email-verification');

const ACTIONABLE_STATUSES = new Set(['warning', 'blocked', 'suppressed']);
const EXCLUDED_ORDER_STATUSES = new Set([
    'cancelled',
    'archived',
    'picked_up',
    'fulfilled',
    'reserved'
]);

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeText = (value) => String(value || '').trim();
const csvEscape = (value) => {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) {
        return text;
    }
    return `"${text.replace(/"/g, '""')}"`;
};

const getTodayDateString = () => new Date().toISOString().slice(0, 10);

const parseArgs = (argv) => {
    const args = {
        fromDate: process.env.EMAIL_AUDIT_FROM_DATE || getTodayDateString(),
        outputDir: path.join(__dirname, '..', '..', 'email_exports'),
        ordersCsv: '',
        emailsCsv: ''
    };

    for (let index = 0; index < argv.length; index += 1) {
        const current = argv[index];
        if (current === '--from-date' && argv[index + 1]) {
            args.fromDate = normalizeText(argv[index + 1]);
            index += 1;
            continue;
        }
        if (current === '--output-dir' && argv[index + 1]) {
            args.outputDir = path.resolve(process.cwd(), argv[index + 1]);
            index += 1;
            continue;
        }
        if (current === '--orders-csv' && argv[index + 1]) {
            args.ordersCsv = path.resolve(process.cwd(), argv[index + 1]);
            index += 1;
            continue;
        }
        if (current === '--emails-csv' && argv[index + 1]) {
            args.emailsCsv = path.resolve(process.cwd(), argv[index + 1]);
            index += 1;
        }
    }

    return args;
};

const ensureDirectory = (directoryPath) => {
    fs.mkdirSync(directoryPath, { recursive: true });
};

const runWithConcurrency = async (items, limit, worker) => {
    let nextIndex = 0;
    const workers = Array.from(
        { length: Math.min(Math.max(limit, 1), items.length || 1) },
        async () => {
            while (nextIndex < items.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                await worker(items[currentIndex], currentIndex);
            }
        }
    );
    await Promise.all(workers);
};

const statusRank = (status) => {
    if (status === 'suppressed') return 0;
    if (status === 'blocked') return 1;
    if (status === 'warning') return 2;
    return 3;
};

const formatList = (values) => Array.from(values).filter(Boolean).sort().join('; ');

const parseRecipient = (value) => {
    const raw = String(value || '').trim();
    const match = raw.match(/^(.*?)<([^>]+)>$/);
    if (match) {
        return {
            name: normalizeText(match[1].replace(/^"|"$/g, '')),
            email: normalizeEmail(match[2])
        };
    }
    return {
        name: '',
        email: normalizeEmail(raw)
    };
};

const findLatestExport = (directoryPath, pattern) => {
    if (!fs.existsSync(directoryPath)) return '';
    const matches = fs.readdirSync(directoryPath)
        .filter((fileName) => pattern.test(fileName))
        .map((fileName) => ({
            filePath: path.join(directoryPath, fileName),
            mtimeMs: fs.statSync(path.join(directoryPath, fileName)).mtimeMs
        }))
        .sort((left, right) => right.mtimeMs - left.mtimeMs);
    return matches[0]?.filePath || '';
};

const loadResendEvidenceByEmail = (emailsCsvPath) => {
    const evidenceByEmail = new Map();
    if (!emailsCsvPath || !fs.existsSync(emailsCsvPath)) {
        return evidenceByEmail;
    }

    const lines = fs.readFileSync(emailsCsvPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length <= 1) return evidenceByEmail;
    const headers = lines[0].split(',');
    const toIndex = headers.indexOf('to');
    const createdAtIndex = headers.indexOf('created_at');
    const lastEventIndex = headers.indexOf('last_event');
    const subjectIndex = headers.indexOf('subject');
    if (toIndex < 0) return evidenceByEmail;

    for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
        const raw = lines[lineIndex];
        const row = [];
        let current = '';
        let inQuotes = false;
        for (let index = 0; index < raw.length; index += 1) {
            const char = raw[index];
            if (char === '"') {
                if (inQuotes && raw[index + 1] === '"') {
                    current += '"';
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (char === ',' && !inQuotes) {
                row.push(current);
                current = '';
                continue;
            }
            current += char;
        }
        row.push(current);

        const recipient = parseRecipient(row[toIndex]);
        if (!recipient.email) continue;
        const lastEvent = normalizeText(row[lastEventIndex]).toLowerCase();
        if (lastEvent && lastEvent !== 'delivered') continue;
        const createdAt = normalizeText(row[createdAtIndex]);
        const subject = normalizeText(row[subjectIndex]);
        const existing = evidenceByEmail.get(recipient.email);
        if (!existing || createdAt > existing.createdAt) {
            evidenceByEmail.set(recipient.email, {
                name: recipient.name,
                createdAt,
                subject,
                delivered: true
            });
            continue;
        }
        if (!existing.name && recipient.name) {
            existing.name = recipient.name;
        }
    }

    return evidenceByEmail;
};

const loadUpcomingOrders = async (fromDate) => {
    const result = await pool.query(
        `
        SELECT
            orders.id,
            orders.order_number,
            orders.customer_id,
            orders.customer_email,
            orders.pickup_date,
            orders.pickup_location,
            orders.status,
            orders.language,
            orders.confirmation_email_sent_at,
            customers.name AS customer_name,
            customers.phone AS customer_phone
        FROM orders
        LEFT JOIN customers
            ON customers.id = orders.customer_id
        WHERE orders.pickup_date >= $1
        ORDER BY orders.pickup_date ASC, orders.pickup_location ASC, orders.created_at ASC
        `,
        [fromDate]
    );

    const grouped = new Map();
    for (const row of result.rows) {
        const status = normalizeText(row.status).toLowerCase();
        const email = normalizeEmail(row.customer_email);
        if (!email || EXCLUDED_ORDER_STATUSES.has(status)) {
            continue;
        }
        if (!grouped.has(email)) {
            grouped.set(email, {
                email,
                names: new Set(),
                phones: new Set(),
                orderNumbers: new Set(),
                orderIds: new Set(),
                customerIds: new Set(),
                pickupDates: new Set(),
                pickupLocations: new Set(),
                statuses: new Set(),
                languages: new Set(),
                confirmationSentAtValues: new Set()
            });
        }
        const entry = grouped.get(email);
        const customerName = normalizeText(row.customer_name);
        const customerPhone = normalizeText(row.customer_phone);
        const pickupDate = normalizeText(row.pickup_date);
        const pickupLocation = normalizeText(row.pickup_location);
        const language = normalizeText(row.language).toLowerCase();
        const confirmationSentAt = normalizeText(row.confirmation_email_sent_at);

        if (customerName) entry.names.add(customerName);
        if (customerPhone) entry.phones.add(customerPhone);
        if (row.order_number !== null && row.order_number !== undefined && String(row.order_number).trim()) {
            entry.orderNumbers.add(String(Math.floor(Number(row.order_number) || 0) || row.order_number).trim());
        }
        if (normalizeText(row.id)) entry.orderIds.add(normalizeText(row.id));
        if (normalizeText(row.customer_id)) entry.customerIds.add(normalizeText(row.customer_id));
        if (pickupDate) entry.pickupDates.add(pickupDate);
        if (pickupLocation) entry.pickupLocations.add(pickupLocation);
        if (status) entry.statuses.add(status);
        if (language) entry.languages.add(language);
        if (confirmationSentAt) entry.confirmationSentAtValues.add(confirmationSentAt);
    }

    return Array.from(grouped.values());
};

const loadUpcomingOrdersFromCsv = (csvPath, fromDate, resendEvidenceByEmail) => {
    const grouped = new Map();
    const raw = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
    if (raw.length <= 1) return [];

    const headers = raw[0].split(',');
    const indexByHeader = new Map(headers.map((header, index) => [header, index]));
    const parseLine = (line) => {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let index = 0; index < line.length; index += 1) {
            const char = line[index];
            if (char === '"') {
                if (inQuotes && line[index + 1] === '"') {
                    current += '"';
                    index += 1;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }
            if (char === ',' && !inQuotes) {
                values.push(current);
                current = '';
                continue;
            }
            current += char;
        }
        values.push(current);
        return values;
    };

    const getValue = (values, headerName) => values[indexByHeader.get(headerName)] || '';

    for (let lineIndex = 1; lineIndex < raw.length; lineIndex += 1) {
        const values = parseLine(raw[lineIndex]);
        const pickupDate = normalizeText(getValue(values, 'pickup_date'));
        const status = normalizeText(getValue(values, 'status')).toLowerCase();
        const email = normalizeEmail(getValue(values, 'customer_email'));
        if (!pickupDate || pickupDate < fromDate || !email || EXCLUDED_ORDER_STATUSES.has(status)) {
            continue;
        }

        if (!grouped.has(email)) {
            grouped.set(email, {
                email,
                names: new Set(),
                phones: new Set(),
                orderNumbers: new Set(),
                orderIds: new Set(),
                customerIds: new Set(),
                pickupDates: new Set(),
                pickupLocations: new Set(),
                statuses: new Set(),
                languages: new Set(),
                confirmationSentAtValues: new Set()
            });
        }
        const entry = grouped.get(email);
        const pickupLocation = normalizeText(getValue(values, 'pickup_location'));
        const customerName = normalizeText(getValue(values, 'customer_name'))
            || normalizeText(resendEvidenceByEmail.get(email)?.name);
        const customerPhone = normalizeText(getValue(values, 'customer_phone'));
        const orderNumber = normalizeText(getValue(values, 'order_number'));
        const orderId = normalizeText(getValue(values, 'id'));
        const customerId = normalizeText(getValue(values, 'customer_id'));
        const language = normalizeText(getValue(values, 'language')).toLowerCase();
        const confirmationSentAt = normalizeText(getValue(values, 'confirmation_email_sent_at'));

        if (customerName) entry.names.add(customerName);
        if (customerPhone) entry.phones.add(customerPhone);
        if (orderNumber) entry.orderNumbers.add(orderNumber);
        if (orderId) entry.orderIds.add(orderId);
        if (customerId) entry.customerIds.add(customerId);
        if (pickupDate) entry.pickupDates.add(pickupDate);
        if (pickupLocation) entry.pickupLocations.add(pickupLocation);
        if (status) entry.statuses.add(status);
        if (language) entry.languages.add(language);
        if (confirmationSentAt) entry.confirmationSentAtValues.add(confirmationSentAt);
    }

    return Array.from(grouped.values());
};

const loadLatestTrackedEmailEvents = async (emails) => {
    if (!Array.isArray(emails) || emails.length === 0) {
        return new Map();
    }

    const result = await pool.query(
        `
        SELECT DISTINCT ON (normalized_email)
            normalized_email,
            email_type,
            send_status,
            verification_status,
            last_error,
            COALESCE(last_event_at, created_at) AS event_at
        FROM email_messages
        WHERE normalized_email = ANY($1::text[])
        ORDER BY normalized_email ASC, COALESCE(last_event_at, created_at) DESC, created_at DESC
        `,
        [emails]
    );

    return new Map(
        result.rows.map((row) => ([
            normalizeEmail(row.normalized_email),
            {
                latestEmailType: normalizeText(row.email_type),
                latestEmailStatus: normalizeText(row.send_status),
                latestVerificationStatus: normalizeText(row.verification_status),
                latestEmailError: normalizeText(row.last_error),
                latestEmailAt: normalizeText(row.event_at)
            }
        ]))
    );
};

const assessEmail = async ({ email, useDatabase }) => {
    if (useDatabase) {
        return verifyManagedEmailAddress({
            pool,
            email,
            language: 'en',
            verifyEmail: verifyCheckoutEmail
        });
    }

    const verification = await verifyCheckoutEmail(email, { language: 'en' });
    return {
        normalizedEmail: verification?.normalizedEmail || email,
        status: normalizeText(
            verification?.status
            || (verification?.shouldBlock ? 'invalid' : 'valid')
        ).toLowerCase() || 'valid',
        shouldBlock: Boolean(verification?.shouldBlock),
        message: normalizeText(verification?.message),
        suggestion: verification?.suggestion || null
    };
};

const buildAuditRows = async (emailEntries, { useDatabase = true, resendEvidenceByEmail = new Map() } = {}) => {
    const auditRows = new Array(emailEntries.length);
    const trackedEventsByEmail = useDatabase
        ? await loadLatestTrackedEmailEvents(emailEntries.map((entry) => entry.email))
        : new Map();

    await runWithConcurrency(emailEntries, 5, async (entry, index) => {
        const assessment = await assessEmail({
            email: entry.email,
            useDatabase
        });
        const tracked = trackedEventsByEmail.get(entry.email) || {};
        const normalizedStatus = assessment.shouldBlock
            ? (assessment.status === 'suppressed' ? 'suppressed' : 'blocked')
            : (assessment.status === 'warning' ? 'warning' : 'ready');
        const resendEvidence = resendEvidenceByEmail.get(entry.email) || null;
        const suggestion = normalizeText(assessment.suggestion);
        const reasonParts = [];
        const assessmentMessage = normalizeText(assessment.message);
        if (assessmentMessage && normalizedStatus !== 'ready') {
            reasonParts.push(normalizeText(assessment.message));
        }
        if (suggestion) {
            reasonParts.push(`Suggestion: ${suggestion}`);
        }
        let finalStatus = normalizedStatus;
        if (!useDatabase && finalStatus === 'ready' && !resendEvidence) {
            finalStatus = 'warning';
            reasonParts.push('No delivered email found in the Resend export.');
        }

        auditRows[index] = {
            status: finalStatus,
            reason: reasonParts.join(' '),
            suggestion,
            email: entry.email,
            customerNames: formatList(entry.names),
            customerPhones: formatList(entry.phones),
            pickupDates: formatList(entry.pickupDates),
            pickupLocations: formatList(entry.pickupLocations),
            orderNumbers: formatList(entry.orderNumbers),
            orderIds: formatList(entry.orderIds),
            customerIds: formatList(entry.customerIds),
            orderStatuses: formatList(entry.statuses),
            confirmationSentAt: formatList(entry.confirmationSentAtValues),
            latestEmailType: tracked.latestEmailType || (resendEvidence ? 'historical_export' : ''),
            latestEmailStatus: tracked.latestEmailStatus || (resendEvidence ? 'delivered' : ''),
            latestVerificationStatus: tracked.latestVerificationStatus || '',
            latestEmailAt: tracked.latestEmailAt || (resendEvidence?.createdAt || ''),
            latestEmailError: tracked.latestEmailError || '',
            latestEmailSubject: resendEvidence?.subject || ''
        };
    });

    return auditRows.sort((left, right) => (
        statusRank(left.status) - statusRank(right.status)
        || left.pickupDates.localeCompare(right.pickupDates)
        || left.pickupLocations.localeCompare(right.pickupLocations)
        || left.email.localeCompare(right.email)
    ));
};

const writeCsv = (filePath, rows) => {
    const headers = [
        'status',
        'reason',
        'suggestion',
        'email',
        'customer_names',
        'customer_phones',
        'pickup_dates',
        'pickup_locations',
        'order_numbers',
        'order_ids',
        'customer_ids',
        'order_statuses',
        'confirmation_sent_at',
        'latest_email_type',
        'latest_email_status',
        'latest_verification_status',
        'latest_email_at',
        'latest_email_error',
        'latest_email_subject'
    ];
    const lines = [headers.join(',')];
    for (const row of rows) {
        lines.push([
            row.status,
            row.reason,
            row.suggestion,
            row.email,
            row.customerNames,
            row.customerPhones,
            row.pickupDates,
            row.pickupLocations,
            row.orderNumbers,
            row.orderIds,
            row.customerIds,
            row.orderStatuses,
            row.confirmationSentAt,
            row.latestEmailType,
            row.latestEmailStatus,
            row.latestVerificationStatus,
            row.latestEmailAt,
            row.latestEmailError,
            row.latestEmailSubject
        ].map(csvEscape).join(','));
    }
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
};

const writeSummaryJson = (filePath, rows, { fromDate, sourceMode, sourceFile }) => {
    const counts = rows.reduce((acc, row) => {
        acc.total += 1;
        acc[row.status] = (acc[row.status] || 0) + 1;
        return acc;
    }, {
        fromDate,
        sourceMode,
        sourceFile,
        generatedAt: new Date().toISOString(),
        total: 0,
        ready: 0,
        warning: 0,
        blocked: 0,
        suppressed: 0
    });
    fs.writeFileSync(filePath, JSON.stringify(counts, null, 2), 'utf8');
};

const renderPdf = ({ csvPath, pdfPath, fromDate }) => {
    const rendererPath = path.join(__dirname, 'render_email_audit_pdf.py');
    const pythonCommand = process.env.EMAIL_AUDIT_PYTHON || 'python';
    const result = spawnSync(
        pythonCommand,
        [rendererPath, '--input', csvPath, '--output', pdfPath, '--from-date', fromDate],
        {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8'
        }
    );

    if (result.status !== 0) {
        const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || 'Unknown PDF render failure.';
        throw new Error(detail);
    }
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    ensureDirectory(args.outputDir);

    const csvPath = path.join(args.outputDir, `email_audit_upcoming_${args.fromDate}.csv`);
    const jsonPath = path.join(args.outputDir, `email_audit_upcoming_${args.fromDate}.summary.json`);
    const pdfPath = path.join(args.outputDir, `email_audit_upcoming_${args.fromDate}.pdf`);

    let sourceMode = 'database';
    let sourceFile = '';
    try {
        let emailEntries = [];
        let auditRows = [];

        if (args.ordersCsv) {
            const resendEvidenceByEmail = loadResendEvidenceByEmail(args.emailsCsv);
            emailEntries = loadUpcomingOrdersFromCsv(args.ordersCsv, args.fromDate, resendEvidenceByEmail);
            sourceMode = 'orders_csv';
            sourceFile = args.ordersCsv;
            auditRows = await buildAuditRows(emailEntries, {
                useDatabase: false,
                resendEvidenceByEmail
            });
        } else {
            try {
                await ensureEmailOpsSchema(pool);
                emailEntries = await loadUpcomingOrders(args.fromDate);
                auditRows = await buildAuditRows(emailEntries, {
                    useDatabase: true
                });
            } catch (dbError) {
                const ordersCsvPath = findLatestExport(args.outputDir, /^orders_rows.*\.csv$/i);
                if (!ordersCsvPath) {
                    throw dbError;
                }
                const emailsCsvPath = args.emailsCsv || findLatestExport(args.outputDir, /^emails-sent.*\.csv$/i);
                const resendEvidenceByEmail = loadResendEvidenceByEmail(emailsCsvPath);
                emailEntries = loadUpcomingOrdersFromCsv(ordersCsvPath, args.fromDate, resendEvidenceByEmail);
                sourceMode = 'orders_csv';
                sourceFile = ordersCsvPath;
                console.warn(`Database audit source unavailable. Falling back to CSV: ${ordersCsvPath}`);
                auditRows = await buildAuditRows(emailEntries, {
                    useDatabase: false,
                    resendEvidenceByEmail
                });
            }
        }

        writeCsv(csvPath, auditRows);
        writeSummaryJson(jsonPath, auditRows, {
            fromDate: args.fromDate,
            sourceMode,
            sourceFile
        });
        renderPdf({ csvPath, pdfPath, fromDate: args.fromDate });

        const counts = auditRows.reduce((acc, row) => {
            acc[row.status] = (acc[row.status] || 0) + 1;
            return acc;
        }, { ready: 0, warning: 0, blocked: 0, suppressed: 0 });
        const actionableCount = auditRows.filter((row) => ACTIONABLE_STATUSES.has(row.status)).length;

        console.log(`Email audit complete for ${args.fromDate}`);
        console.log(`CSV: ${csvPath}`);
        console.log(`PDF: ${pdfPath}`);
        console.log(`Summary JSON: ${jsonPath}`);
        console.log(`Source: ${sourceMode}${sourceFile ? ` (${sourceFile})` : ''}`);
        console.log(`Total unique emails: ${auditRows.length}`);
        console.log(`Ready: ${counts.ready}`);
        console.log(`Warning: ${counts.warning}`);
        console.log(`Blocked: ${counts.blocked}`);
        console.log(`Suppressed: ${counts.suppressed}`);
        console.log(`Action needed: ${actionableCount}`);
    } finally {
        await pool.end();
    }
};

main().catch((error) => {
    console.error('Email audit failed.');
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
