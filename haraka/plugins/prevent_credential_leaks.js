// Prevent a user from sending their AUTH credentials
// This is a simple, primitive form of anti-phishing.

function escapeRegExp(str) {
    return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
}

exports.hook_data = (next, connection) => {
    if (connection.notes.auth_user && connection.notes.auth_passwd) {
        connection.transaction.parse_body = true;
    }
    next();
};

exports.hook_data_post = (next, connection) => {
    if (!(connection.notes.auth_user && connection.notes.auth_passwd)) {
        return next();
    }

    let user = connection.notes.auth_user;
    let domain;
    let idx;
    if ((idx = user.indexOf('@'))) {
        // If the username is qualified (e.g. user@domain.com)
        // then we make the @domain.com part optional in the regexp.
        domain = user.substr(idx);
        user = user.substr(0, idx);
    }
    const passwd = connection.notes.auth_passwd;
    const bound_regexp = '(?:\\b|\\B)';
    const passwd_regexp = new RegExp(
        bound_regexp + escapeRegExp(passwd) + bound_regexp,
        'm'
    );
    const user_regexp = new RegExp(
        bound_regexp +
            escapeRegExp(user) +
            (domain ? `(?:${escapeRegExp(domain)})?` : '') +
            bound_regexp,
        'im'
    );

    if (
        look_for_credentials(
            user_regexp,
            passwd_regexp,
            connection.transaction.body
        )
    ) {
        return next(
            DENY,
            'Credential leak detected: never give out your username/password to anyone!'
        );
    }

    next();
};

function look_for_credentials(user_regexp, passwd_regexp, body) {
    if (user_regexp.test(body.bodytext) && passwd_regexp.test(body.bodytext)) {
        return true;
    }

    // Check all child parts
    for (let i = 0, l = body.children.length; i < l; i++) {
        if (
            look_for_credentials(user_regexp, passwd_regexp, body.children[i])
        ) {
            return true;
        }
    }

    return false;
}
