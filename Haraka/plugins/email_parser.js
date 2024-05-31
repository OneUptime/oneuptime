// const MailParser = require('mailparser').MailParser;

// exports.hook_data_post = function (next, connection) {
//     // Get the email data
//     var email_data = connection.transaction.data_lines.join('\n');

//     // Parse the email data
//     var mailparser = new MailParser();

//     mailparser.on('end', function(mail_object){
//         // Log the email data
//         connection.loginfo('Subject: ' + mail_object.subject);
//         connection.loginfo('From: ' + JSON.stringify(mail_object.from));
//         connection.loginfo('To: ' + JSON.stringify(mail_object.to));
//         connection.loginfo('Text: ' + mail_object.text);
//         connection.loginfo('HTML: ' + mail_object.html);
//     });

//     mailparser.write(email_data);
//     mailparser.end();

//     next();
// };


exports.hook_rcpt = function (next, connection, params) {
    var rcpt = params[0];
    this.loginfo("Got recipient: " + rcpt);
    next();
}