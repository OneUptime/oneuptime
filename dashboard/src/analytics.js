import amplitude from 'amplitude-js'
import { env } from './config';

amplitude.getInstance().init(env('AMPLITUDE_PUBLIC_KEY'), null, { includeReferrer: true });

export const setUserId = (userId) => {
    amplitude.setUserId(userId);
};
export const identify = (userId) => {
    amplitude.identify(userId);
};
export const setUserProperties = (properties) => {
    amplitude.setUserProperties(properties);
};
export const logEvent = (event, data) => {
    amplitude.logEvent(event, data);
};
