import ApiService from '../Utils/apiService';

import logger from 'CommonServer/Utils/Logger';
import pingfetch from '../Utils/pingFetch';

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up

export default {
    ping: async ({ monitor }: $TSFixMe) => {
        if (monitor && monitor.type) {
            if (monitor.data.url) {
                let retry: $TSFixMe = true;
                let retryCount: $TSFixMe = 0;
                while (retry || retryCount > 2) {
                    const { res, resp, rawResp }: $TSFixMe = await pingfetch(
                        monitor.data.url
                    );

                    logger.info(
                        `Monitor ID ${monitor._id}: Start saving data to ingestor.`
                    );
                    const response: $TSFixMe = await ApiService.ping(
                        monitor._id,
                        {
                            monitor,
                            res,
                            resp,
                            rawResp,
                            type: monitor.type,
                            retryCount,
                        }
                    );
                    logger.info(
                        `Monitor ID ${monitor._id}: End saving data to ingestor.`
                    );
                    if (response && !response.retry) {
                        retry = false;
                    } else {
                        retryCount++;
                    }
                }
            }
        }
    },
};
