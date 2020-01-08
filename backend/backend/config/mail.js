/**
 *
 * Copyright HackerBay, Inc.
 *
 */
var secure = false;
if ( process.env['MAIL_SECURE'] === 'true' ){
    secure = true;
}

module.exports = {
    user: process.env['MAIL_USER'] || 'noreply@fyipe.com',
    pass: process.env['MAIL_PASSWORD'] || 'gBote8sHiWpbxGEJo9Puv8cevW',
    host: process.env['MAIL_SERVER_SMTP'] || 'mail.hackerbay.io',
    port: process.env['MAIL_PORT_SMTP'] || '587',
    from: process.env['MAIL_FROM'] || 'noreply@fyipe.com',
    secure
};