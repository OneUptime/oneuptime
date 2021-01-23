// Stop accepting new connections when we are too busy

let toobusy;
let was_busy = false;

exports.register = function() {
    const plugin = this;

    try {
        toobusy = require('toobusy-js');
    } catch (e) {
        plugin.logerror(e);
        plugin.logerror("try: 'npm install -g toobusy-js'");
        return;
    }

    plugin.loadConfig();

    plugin.register_hook('connect', 'check_busy', -100);
};

exports.loadConfig = function() {
    const plugin = this;
    let maxLag = plugin.config.get('toobusy.maxlag', 'value', () => {
        plugin.loadConfig();
    });

    maxLag = parseInt(maxLag);
    if (maxLag) {
        // This will throw an exception on error
        toobusy.maxLag(maxLag);
    }
};

exports.check_busy = function(next, connection) {
    if (!toobusy()) {
        was_busy = false;
        return next();
    }

    if (!was_busy) {
        was_busy = true;
        // Log a CRIT error at the first occurrence
        const currentLag = toobusy.lag();
        const maxLag = toobusy.maxLag();
        this.logcrit(`deferring connections: lag=${currentLag} max=${maxLag}`);
    }

    return next(DENYSOFTDISCONNECT, 'Too busy; please try again later');
};
