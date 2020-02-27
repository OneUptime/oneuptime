const amplitude = require('amplitude-js');
const { env } = require('./config');

amplitude.init(env('AMPLITUDE_PUBLIC_KEY'), null, { includeReferrer: true });

export const setUserId = function(userId) {
    amplitude.setUserId(userId);
};
export const identify = function(userId) {
    amplitude.identify(userId);
};
export const setUserProperties = function(properties) {
    amplitude.setUserProperties(properties);
};
export const logEvent = function(event, data) {
    amplitude.logEvent(event, data);
};
