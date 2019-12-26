var amplitude = require('amplitude-js');

amplitude.init('f4a9057be8a560a55f75c74420490a5e', null, { includeReferrer: true });

export var setUserId = function (userId) {
    amplitude.setUserId(userId);
};
export var identify = function(userId) {
    amplitude.identify(userId);
}
export var setPeople = function(properties) {
    amplitude.setUserProperties(properties);
}
export var logEvent = function (event, data) {
    amplitude.logEvent(event, data);
};