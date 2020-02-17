/**
 *
 * Copyright HackerBay, Inc.
 *
 */
let secure = false;
if ( process.env['MAIL_SMTP_SECURE'] === 'true' ){
    secure = true;
}

const mailUserIndex = Math.floor(Math.random() * process.env['MAIL_USER'].split(",").length);

module.exports = {
    user: process.env['MAIL_USER'].split(",")[mailUserIndex],
    pass: process.env['MAIL_PASSWORD'].split(",")[mailUserIndex],
    host: process.env['MAIL_SERVER_SMTP'],
    port: process.env['MAIL_PORT_SMTP'],
    from: process.env['MAIL_FROM'],
    secure
};
