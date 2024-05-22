import API from 'Common/Utils/API';
import { INGESTOR_URL, PROBE_MONITOR_FETCH_LIMIT } from '../../Config';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Monitor from 'Model/Models/Monitor';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import BaseModel from 'Common/Models/BaseModel';
import ProbeAPIRequest from '../../Utils/ProbeAPIRequest';
import MonitorUtil from '../../Utils/Monitors/Monitor';
import logger from 'CommonServer/Utils/Logger';
import { JSONArray } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';
import Sleep from 'Common/Types/Sleep';

export default class FetchListAndProbe {
    private workerName: string = '';

    public constructor(workerName: string) {
        this.workerName = workerName;
    }

    public async run(): Promise<void> {
        logger.debug(`Running worker ${this.workerName}`);

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const runTime: Date = OneUptimeDate.getCurrentDate();

            logger.debug(`Probing monitors ${this.workerName}`);

            await this.fetchListAndProbe();

            logger.debug(`Probing monitors ${this.workerName} complete`);

            // if rumTime  + 5 seconds is in the future, then this fetchLst either errored out or had no monitors in the list. Either way, wait for 5 seconds and proceed.

            const twoSecondsAdded: Date = OneUptimeDate.addRemoveSeconds(
                runTime,
                2
            );

            if (OneUptimeDate.isInTheFuture(twoSecondsAdded)) {
                logger.debug(
                    `Worker ${this.workerName} is waiting for 2 seconds`
                );
                await Sleep.sleep(2000);
            }
        }
    }

    private async fetchListAndProbe(): Promise<void> {
        try {
            debugger;

            logger.debug('Fetching monitor list');

            const monitorListUrl: URL = URL.fromString(
                INGESTOR_URL.toString()
            ).addRoute('/monitor/list');

            const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
                await API.fetch<JSONArray>(
                    HTTPMethod.POST,
                    monitorListUrl,
                    {
                        ...ProbeAPIRequest.getDefaultRequestBody(),
                        limit: PROBE_MONITOR_FETCH_LIMIT || 100,
                    },
                    {},
                    {}
                );

            logger.debug('Fetched monitor list');
            logger.debug(result);

            const monitors: Array<Monitor> = BaseModel.fromJSONArray(
                result.data as JSONArray,
                Monitor
            );

            for (const monitor of monitors) {
                debugger;
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
