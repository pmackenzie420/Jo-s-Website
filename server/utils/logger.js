const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('--test');

const toErrorObject = (error) => {
    if (!error) return undefined;
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack
        };
    }
    return { message: String(error) };
};

const writeLog = (level, message, meta) => {
    if (isTest) {
        return;
    }
    if (!isProduction) {
        const method = level === 'error' ? console.error : console.log;
        if (meta !== undefined) {
            method(message, meta);
        } else {
            method(message);
        }
        return;
    }

    const payload = {
        ts: new Date().toISOString(),
        level,
        message
    };
    if (meta !== undefined) {
        payload.meta = meta;
    }
    const method = level === 'error' ? console.error : console.log;
    method(JSON.stringify(payload));
};

const logInfo = (message, meta) => writeLog('info', message, meta);
const logWarn = (message, meta) => writeLog('warn', message, meta);
const logError = (message, error) => writeLog('error', message, toErrorObject(error));

module.exports = {
    logInfo,
    logWarn,
    logError
};
