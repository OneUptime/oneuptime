var Imap = require('imap');

var imap = new Imap({
    user: process.env['MAIL_RECIPIENT'] ,
    password: process.env['MAIL_RECIPIENT_PASSWORD'],
    host: process.env['MAIL_SERVER_IMAP'],
    port: process.env['MAIL_PORT_IMAP'],
    tls: true
});

function openBox(cb) {
    imap.openBox('INBOX', true, cb);
}

var signUpEmailContent = 'WELCOME TO FYIPE\nHiOlalekan,\n\n I\'m Nawaz and I\'m the founder of Fyipe. I can\'t thank you enough for signing\nup. \n\nIf you need any help using Fyipe, Please Send us an email at support@fyipe.com\nand let me know.\n\nThanks, have a great day.\n\nFyipe Team';

var feedbackEmailContent = ' THANK YOU FOR YOUR FEEDBACK\nHi Olalekan, \n\nThank you for your feedback. We’ll get back to you as soon as we can. Have a\ngreat day. \n\nFyipe Team';

module.exports = {
    imap,
    openBox,
    signUpEmailContent,
    feedbackEmailContent
};