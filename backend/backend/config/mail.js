/**
 *
 * Copyright HackerBay, Inc.
 *
 */
let secure = false;
if ( process.env['MAIL_SMTP_SECURE'] === 'true' ){
    secure = true;
}
let mailUserIndex = 0;
if(process.env['MAIL_USER'])
    mailUserIndex = Math.floor(Math.random() * process.env['MAIL_USER'].split(',').length);

module.exports = {
    user: process.env['MAIL_USER'] ? process.env['MAIL_USER'].split(',')[mailUserIndex] : null,
    pass: process.env['MAIL_PASSWORD'] ? process.env['MAIL_PASSWORD'].split(',')[mailUserIndex]: null,
    host: process.env['MAIL_SERVER_SMTP'],
    port: process.env['MAIL_PORT_SMTP'],
    from: process.env['MAIL_FROM'],
    secure
};
