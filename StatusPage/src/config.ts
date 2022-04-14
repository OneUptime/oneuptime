import isEmail from 'sane-email-validation';
import validUrl from 'valid-url';
let apiUrl = window.location.origin + '/api';
let dashboardUrl = window.location.origin + '/dashboard';
let accountsUrl = window.location.origin + '/accounts';
let realtimeUrl = window.location.origin + '/realtime';

export const env: Function = (value: $TSFixMe): void => {
    const { _env }: $TSFixMe = window;
    return (
        (_env && _env[`REACT_APP_${value}`]) ||
        process.env[`REACT_APP_${value}`]
    );
};

let protocol = window.location.protocol;
if (env('BACKEND_PROTOCOL')) {
    protocol = env('BACKEND_PROTOCOL') + ':';
}

if (
    window &&
    window.location &&
    window.location.host &&
    (window.location.host.includes('localhost:') ||
        window.location.host.includes('0.0.0.0:') ||
        window.location.host.includes('127.0.0.1:'))
) {
    apiUrl = protocol + '//localhost:3002/api';
    dashboardUrl = protocol + '//localhost:3000/dashboard';
    accountsUrl = protocol + '//localhost:3003/accounts';
    realtimeUrl = protocol + '//localhost:3300/realtime';
} else if (env('ONEUPTIME_HOST')) {
    const ONEUPTIME_HOST: $TSFixMe = env('ONEUPTIME_HOST').replace(
        /(http:\/\/|https:\/\/)/,
        ''
    ); // remove any protocol that might have been added
    apiUrl = protocol + `//${ONEUPTIME_HOST}/api`;
    dashboardUrl = protocol + `//${ONEUPTIME_HOST}/dashboard`;
    accountsUrl = protocol + `//${ONEUPTIME_HOST}/accounts`;
    realtimeUrl = protocol + `//${ONEUPTIME_HOST}/realtime`;
}

export const API_URL: $TSFixMe = apiUrl;

export const REALTIME_URL: $TSFixMe = realtimeUrl;

export const DASHBOARD_URL: $TSFixMe = dashboardUrl;

export const ACCOUNTS_URL: $TSFixMe = accountsUrl;

export const DOMAIN: $TSFixMe = window.location.origin;

export const VERSION: $TSFixMe = process.env.VERSION || env('VERSION');

export const User: $TSFixMe = {
    getAccessToken() {
        return localStorage.getItem('access_token');
    },

    setAccessToken(token: $TSFixMe) {
        localStorage.setItem('access_token', token);
    },

    setUserId(id: $TSFixMe) {
        localStorage.setItem('id', id);
    },

    getUserId() {
        return localStorage.getItem('id');
    },

    clear() {
        localStorage.clear();
    },

    removeUserId() {
        localStorage.removeItem('id');
    },

    removeAccessToken() {
        localStorage.removeItem('token');
    },

    isLoggedIn() {
        return Boolean(localStorage.getItem('access_token'));
    },
};

// Data validation Util goes in here.
export const Validate: $TSFixMe = {
    isDomain(domain: $TSFixMe) {
        return domain.search(/\./) >= 0;
    },

    url(url: URL) {
        return validUrl.isUri(url);
    },

    text(text: $TSFixMe) {
        if (!text || text.trim() === '') {
            return false;
        }

        return true;
    },

    email(email: $TSFixMe) {
        if (this.text(email)) {
            return isEmail(email);
        }

        return false;
    },

    compare(text1: $TSFixMe, text2: $TSFixMe) {
        return text1 === text2;
    },
};

export const getQueryVar: Function = (variable: $TSFixMe, url: URL): void => {
    if (!url) {
        url = window.location.href;
    }
    variable = variable.replace(/[[\]]/g, '\\$&');
    const regex: $TSFixMe = new RegExp('[?&]' + variable + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) {
        return null;
    }
    if (!results[2]) {
        return '';
    }
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
};

export const bindRaf: Function = (fn: $TSFixMe): void => {
    let isRunning: $TSFixMe = null;
    let args: $TSFixMe = null;

    const run: Function = (): void => {
        isRunning = false;
        fn(...args);
    };

    return function (...invokingArguments: $TSFixMe[]): void {
        args = invokingArguments;

        if (isRunning) {
            return;
        }

        isRunning = true;
        requestAnimationFrame(run);
    };
};

export const filterProbeData: Function = (
    monitor: $TSFixMe,
    probe: $TSFixMe,
    backupStatus: $TSFixMe
): void => {
    const monitorStatuses: $TSFixMe = monitor.statuses || backupStatus;

    const probesStatus: $TSFixMe =
        monitorStatuses && monitorStatuses.length > 0
            ? probe
                ? monitorStatuses.filter((probeStatuses: $TSFixMe) => {
                      return (
                          probeStatuses._id === null ||
                          String(probeStatuses._id) === String(probe._id)
                      );
                  })
                : monitorStatuses
            : [];
    const statuses: $TSFixMe =
        probesStatus &&
        probesStatus[0] &&
        probesStatus[0].statuses &&
        probesStatus[0].statuses.length > 0
            ? probesStatus[0].statuses
            : [];

    return statuses;
};

export const getMonitorStatus: Function = (statuses: $TSFixMe): void =>
    statuses && statuses.length > 0 ? statuses[0].status || 'online' : 'online';

export const getServiceStatus: Function = (
    monitorsData: $TSFixMe,
    probes: $TSFixMe
): void => {
    const monitorsLength: $TSFixMe = monitorsData.length;
    const probesLength: $TSFixMe = probes && probes.length;

    const totalServices: $TSFixMe = monitorsLength * probesLength;
    let onlineServices = totalServices;
    let degraded = 0;

    monitorsData.forEach((monitor: $TSFixMe) => {
        probes.forEach((probe: $TSFixMe) => {
            const statuses: $TSFixMe = filterProbeData(monitor, probe);
            const monitorStatus: $TSFixMe = monitor.status
                ? monitor.status
                : getMonitorStatus(statuses);
            if (monitorStatus === 'offline') {
                onlineServices--;
            }
            if (monitorStatus === 'degraded') {
                degraded++;
            }
        });
    });

    if (onlineServices === totalServices) {
        if (degraded !== 0) {
            return 'some-degraded';
        }
        return 'all';
    } else if (onlineServices === 0) {
        return 'none';
    } else if (onlineServices < totalServices) {
        return 'some';
    }
};

export const formatDecimal: Function = (
    value: $TSFixMe,
    decimalPlaces: $TSFixMe
): void => {
    return Number(
        Math.round(parseFloat(value + 'e' + decimalPlaces)) +
            'e-' +
            decimalPlaces
    ).toFixed(decimalPlaces);
};

export const formatBytes: Function = (
    a: $TSFixMe,
    b: $TSFixMe,
    c: $TSFixMe,
    d: $TSFixMe,
    e: $TSFixMe
): void => {
    return (
        formatDecimal(
            ((b = Math),
            (c = b.log),
            (d = 1e3),
            (e = (c(a) / c(d)) | 0),
            a / b.pow(d, e)),
            2
        ) +
        ' ' +
        (e ? 'kMGTPEZY'[--e] + 'B' : 'Bytes')
    );
};

export const capitalize: Function = (words: $TSFixMe): void => {
    if (!words || !words.trim()) {
        return '';
    }

    words = words.split(' ');
    words = words.map(
        (word: $TSFixMe) =>
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

    return words.join(' ').trim();
};

export const handleResources: Function = (
    monitorState: $TSFixMe,
    announcement: $TSFixMe
): void => {
    const affectedMonitors: $TSFixMe = [];
    let monitorCount = 0;

    if (announcement.monitors.length <= 0) {
        return 'No resource is affected';
    }

    const announcementMonitors: $TSFixMe = [];
    // populate the ids of the announcement monitors in an array
    announcement &&
        announcement.monitors &&
        announcement.monitors.map((monitor: $TSFixMe) => {
            announcementMonitors.push(
                String(monitor.monitorId._id || monitor.monitorId)
            );
            return monitor;
        });

    monitorState.map((monitor: $TSFixMe) => {
        if (announcementMonitors.includes(String(monitor._id))) {
            affectedMonitors.push(monitor);
            monitorCount += 1;
        }
        return monitor;
    });
    // check if the length of monitors on status page equals the monitor count
    // if they are equal then all the monitors in status page is in a particular scheduled event
    if (monitorCount === monitorState.length) {
        return 'All resources are affected';
    } else {
        const result: $TSFixMe = affectedMonitors

            .map(monitor => capitalize(monitor.name))
            .join(', ')
            .replace(/, ([^,]*)$/, ' and $1');
        return result;
    }
};

export const cacheProvider: $TSFixMe = {
    get: (language: $TSFixMe, key: $TSFixMe) =>
        ((JSON.parse(localStorage.getItem('translations')) || {})[key] || {})[
            language
        ],
    set: (language: $TSFixMe, key: $TSFixMe, value: $TSFixMe) => {
        const existing: $TSFixMe = JSON.parse(
            localStorage.getItem('translations')
        ) || {
            [key]: {},
        };
        existing[key] = { ...existing[key], [language]: value };
        localStorage.setItem('translations', JSON.stringify(existing));
    },
};
