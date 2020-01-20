var amplitude = require('amplitude-js');
var { env } = require('./config');

amplitude.init(env('AMPLITUDE_PUBLIC_KEY'), null, { includeReferrer: true });

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