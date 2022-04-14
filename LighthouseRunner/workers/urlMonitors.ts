import UrlService from '../Utils/urlService';

import { fork } from 'child_process';
import moment from 'moment';

// This runs the lighthouse of URL Monitors

export default {
    ping: async (monitor: $TSFixMe) => {
        if (monitor && monitor.type) {
            if (monitor.data.url) {
                const now: $TSFixMe = new Date().getTime();
                const scanIntervalInDays: $TSFixMe = monitor.lighthouseScannedAt
                    ? moment(now).diff(
                          moment(monitor.lighthouseScannedAt),
                          'days'
                      )
                    : -1;
                if (
                    (monitor.lighthouseScanStatus &&
                        monitor.lighthouseScanStatus === 'scan') ||
                    (monitor.lighthouseScanStatus &&
                        monitor.lighthouseScanStatus === 'failed') ||
                    ((!monitor.lighthouseScannedAt || scanIntervalInDays > 0) &&
                        (!monitor.lighthouseScanStatus ||
                            monitor.lighthouseScanStatus !== 'scanning'))
                ) {
                    await UrlService.ping(monitor._id, {
                        monitor,
                        resp: { lighthouseScanStatus: 'scanning' },
                    });

                    const sites: $TSFixMe = monitor.siteUrls;

                    for (const url of sites) {
                        const resp: $TSFixMe = await lighthouseFetch(url);

                        await UrlService.ping(monitor._id, {
                            monitor,
                            resp,
                        });
                    }
                }
            }
        }
    },
};

const lighthouseFetch: Function = (url: URL): void => {
    return new Promise((resolve: Function, reject: Function) => {
        const lighthouseWorker: $TSFixMe = fork('./utils/lighthouse');
        const timeoutHandler: $TSFixMe = setTimeout(async (): $TSFixMe => {
            await processLighthouseScan({
                data: { url },
                error: { message: 'TIMEOUT' },
            });
        }, 300000);

        lighthouseWorker.send(url);
        lighthouseWorker.on('message', async result => {
            await processLighthouseScan(result);
        });

        async function processLighthouseScan(result: $TSFixMe): void {
            clearTimeout(timeoutHandler);
            lighthouseWorker.removeAllListeners();
            if (result.error) {
                reject({ lighthouseScanStatus: 'failed', ...result });
            } else {
                resolve({ lighthouseScanStatus: 'scanned', ...result });
            }
        }
    });
};
