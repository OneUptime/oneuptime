const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const pingfetch = require('../utils/pingFetch');
const logger = require('../../common-server/utils/logger');

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async ({ monitor }) => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.url) {
                    const headers = await ApiService.headers(
                        monitor.headers,
                        monitor.bodyType
                    );
                    const body = await ApiService.body(
                        monitor && monitor.text && monitor.text.length
                            ? monitor.text
                            : monitor.formData,
                        monitor && monitor.text && monitor.text.length
                            ? 'text'
                            : 'formData'
                    );

                    let retry = true;
                    let retryCount = 0;
                    while (retry || retryCount > 2) {
                        logger.info(`Ping Fetch Start: ${monitor.method} ${monitor.data.url}`);

                        const { res, resp, rawResp } = await pingfetch(
                            monitor.data.url,
                            monitor.method,
                            body,
                            headers
                        );

                        logger.info(`Ping Fetch End: ${monitor.method} ${monitor.data.url}`);

                        logger.info(
                            `Monitor ID ${monitor._id}: Start saving data to ingestor.`
                        );

                        const response = await ApiService.ping(monitor._id, {
                            monitor,
                            res,
                            resp,
                            rawResp,
                            type: monitor.type,
                            retryCount,
                        });

                        logger.info(
                            `Monitor ID ${monitor._id}: End saving data to ingestor.`
                        );

                        if (response && !response.retry) {
                            logger.info(`No Retry: ${monitor.method} ${monitor.data.url}`);
                            retry = false;
                        } else {
                            logger.info(`Retry (${retryCount}): ${monitor.method} ${monitor.data.url}`);
                            retryCount++;
                        }
                    }
                }
            }
        } catch (error) {
            ErrorService.log('apiMonitors.ping', error);
            throw error;
        }
    },
};
