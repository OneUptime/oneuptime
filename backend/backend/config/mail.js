/**
 *
 * Copyright HackerBay, Inc.
 *
 */
let secure = false;
if ( process.env['MAIL_SMTP_SECURE'] === 'true' ){
    secure = true;
}

module.exports = {
    user: process.env['MAIL_USER'],
    pass: process.env['MAIL_PASSWORD'],
    host: process.env['MAIL_SERVER_SMTP'],
    port: process.env['MAIL_PORT_SMTP'],
    from: process.env['MAIL_FROM'],
    secure
};
