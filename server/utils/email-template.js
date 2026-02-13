const { escapeHtml } = require('./helpers');
const { COMPANY_CONTACT } = require('../config/constants');

const EMAIL_FONT_STACK = 'Arial, sans-serif';
const BRAND_COLOR = '#2D5A3D';

const buildBrandedEmailHtml = ({ contentHtml }) => {
    return `
<!doctype html>
<html lang="en">
  <body style="margin:0; padding:0; background:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin:0; padding:0; background:#ffffff;">
      <tr>
        <td align="center" style="padding:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; width:100%; max-width:600px; margin:0 auto; background:#ffffff;">
            <tr>
              <td style="background:${BRAND_COLOR}; color:#ffffff; font-family:${EMAIL_FONT_STACK}; padding:20px; text-align:center;">
                <h1 style="margin:0; font-size:20px; line-height:1.2; font-weight:700;">${escapeHtml(COMPANY_CONTACT.name)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 20px; background:#ffffff; color:#333333; font-family:${EMAIL_FONT_STACK}; font-size:15px; line-height:1.45; text-align:left;">
                ${contentHtml}
              </td>
            </tr>
            <tr>
              <td style="background:#f5f5f5; padding:15px; text-align:center; font-family:${EMAIL_FONT_STACK}; font-size:12px; color:#666666;">
                <p style="margin:0;">
                  ${escapeHtml(COMPANY_CONTACT.name)}<br>
                  ${escapeHtml(COMPANY_CONTACT.address)}<br>
                  ${escapeHtml(COMPANY_CONTACT.phone)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
};

module.exports = {
    buildBrandedEmailHtml,
    EMAIL_FONT_STACK,
    BRAND_COLOR
};
