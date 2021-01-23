// Just relay everything - could be useful for a spamtrap

exports.register = function() {
    this.logerror(this, "deprecated. see 'haraka -h relay'");
    this.register_hook('rcpt', 'confirm_all');
};

exports.confirm_all = function(next, connection, params) {
    const recipient = params.shift();
    connection.loginfo(this, `confirming recipient ${recipient}`);
    connection.relaying = true;
    next(OK);
};
