import ApiService from '../utils/apiService';
import ErrorService from '../utils/errorService';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'ping... Remove this comment to see the full error message
import ping from 'ping';
// it collects all monitors then ping them one by one to store their response
// checks if the IP Address of the IP monitor is up or down
// creates incident if a IP Address is down and resolves it when they come back up
export default {
    ping: async ({ monitor }: $TSFixMe) => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.IPAddress) {
                    let retry = true;
                    let retryCount = 0;
                    while (retry || retryCount > 2) {
                        const { res, resp, rawResp } = await pingfetch(
                            monitor.data.IPAddress
                        );

                        const response = await ApiService.ping(monitor._id, {
                            monitor,
                            res,
                            resp,
                            rawResp,
                            type: monitor.type,
                            retryCount,
                        });

                        if (response && !response.retry) {
                            retry = false;
                        } else {
                            retryCount++;
                        }
                    }
                }
            }
        } catch (error) {
            ErrorService.log('IPMonitors.ping', error);
            throw error;
        }
    },
};

const pingfetch = async (IPAddress: $TSFixMe) => {
    const now = new Date().getTime();
    let resp = null;
    let rawResp = null;
    let res = null;

    try {
        const response = await ping.promise.probe(IPAddress, {
            timeout: 120,
            extra: ['-i', '2'],
        });

        const isAlive = response ? response.alive : false;

        res = new Date().getTime() - now;

        resp = {
            status: isAlive ? 200 : 408,
            body: null,
        };
        rawResp = {
            body: null,
            status: isAlive ? 200 : 408,
        };
    } catch (error) {
        res = new Date().getTime() - now;
        resp = { status: 408, body: error };
    }

    return { res, resp, rawResp };
};
