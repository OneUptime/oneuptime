import API from 'Common/Utils/API';
import { PROBE_API_URL } from '../../Config';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Monitor from 'Model/Models/Monitor';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import ProbeAPIRequest from '../../Utils/ProbeAPIRequest';
import MonitorUtil from '../../Utils/Monitors/Monitor';
import logger from 'CommonServer/Utils/Logger';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { JSONArray } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';
import Sleep from 'Common/Types/Sleep';

export default class FetchListAndProbe {
    private workerName: string = '';

    public constructor(workerName: string) {
        this.workerName = workerName;
    }

    public async run(): Promise<void> {
        logger.info(`Running worker ${this.workerName}`);

        const runTIme: Date = OneUptimeDate.getCurrentDate();

        // eslint-disable-next-line no-constant-condition
        while (true) {
            logger.info(`Probing monitors ${this.workerName}`);

            await this.fetchListAndProbe();

            logger.info(`Probing monitors ${this.workerName} complete`);

            // if rumTime  + 5 seconds is in the future, then this fetchLst either errored out or had no monitors in the list. Either way, wait for 5 seconds and proceed.

            const fiveSecondsAdded: Date = OneUptimeDate.addRemoveSeconds(
                runTIme,
                5
            );

            if (OneUptimeDate.isInTheFuture(fiveSecondsAdded)) {
                logger.info(
                    `Worker ${this.workerName} is waiting for 5 seconds`
                );
                await Sleep.sleep(5000);
            }
        }
    }

    private async fetchListAndProbe(): Promise<void> {
        try {
            logger.info('Fetching monitor list');

            const monitorListUrl: URL = URL.fromString(
                PROBE_API_URL.toString()
            ).addRoute('/monitor/list');

            const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
                await API.fetch<JSONArray>(
                    HTTPMethod.POST,
                    monitorListUrl,
                    ProbeAPIRequest.getDefaultRequestBody(),
                    {},
                    {}
                );

            logger.info('Fetched monitor list');
            logger.info(result);

            const monitors: Array<Monitor> = JSONFunctions.fromJSONArray(
                result.data as JSONArray,
                Monitor
            );

            for (const monitor of monitors) {
                try {
                    await MonitorUtil.probeMonitor(monitor);
                } catch (err) {
                    logger.error('Error in probing monitor');
                    logger.error('Monitor:');
                    logger.error(monitor);
                    logger.error('Error:');
                    logger.error(err);
                }
            }
        } catch (err) {
            logger.error('Error in fetching monitor list');
            logger.error(err);
        }
    }
}
