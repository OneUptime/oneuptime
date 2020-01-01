var amplitude = require('amplitude-js');

amplitude.init('cb70632f45c1ca7fe6180812c0d6494a', null, { includeReferrer: true });

export var setUserId = function (userId) {
    amplitude.setUserId(userId);
};
export var identify = function(userId) {
    amplitude.identify(userId);
}
export var setUserProperties = function(properties) {
    amplitude.setUserProperties(properties);
}
export var logEvent = function (event, data) {
    amplitude.logEvent(event, data);
};