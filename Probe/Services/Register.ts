import API from 'Common/Utils/API';
import {
    INGESTOR_URL,
    PROBE_DESCRIPTION,
    PROBE_ID,
    PROBE_KEY,
    PROBE_NAME,
} from '../Config';
import URL from 'Common/Types/API/URL';
import { ClusterKey, HasClusterKey } from 'CommonServer/EnvironmentConfig';
import logger from 'CommonServer/Utils/Logger';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { JSONObject } from 'Common/Types/JSON';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import Sleep from 'Common/Types/Sleep';

export default class Register {
    public static async registerProbe(): Promise<void> {
        // register probe with 5 retry and 15 seocnd interval between each retry.

        let currentRetry: number = 0;

        const maxRetry: number = 10;

        const retryIntervalInSeconds: number = 30;

        while (currentRetry < maxRetry) {
            try {
                logger.info(`Registering probe. Attempt: ${currentRetry + 1}`);
                await Register._registerProbe();
                logger.info(`Probe registered successfully.`);
                break;
            } catch (error) {
                logger.error(
                    `Failed to register probe. Retrying after ${retryIntervalInSeconds} seconds...`
                );
                logger.error(error);
                currentRetry++;
                await Sleep.sleep(retryIntervalInSeconds * 1000);
            }
        }
    }

    private static async _registerProbe(): Promise<void> {
        if (HasClusterKey) {
            const probeRegistrationUrl: URL = URL.fromString(
                INGESTOR_URL.toString()
            ).addRoute('/register');

            logger.info('Registering Probe...');
            logger.info(
                'Sending request to: ' + probeRegistrationUrl.toString()
            );

            const result: HTTPResponse<JSONObject> = await API.post(
                probeRegistrationUrl,
                {
                    probeKey: PROBE_KEY,
                    probeName: PROBE_NAME,
                    probeDescription: PROBE_DESCRIPTION,
                    clusterKey: ClusterKey.toString(),
                }
            );

            if (result.isSuccess()) {
                logger.info('Probe Registered');

                const probeId: string = result.data['_id'] as string;

                LocalCache.setString('PROBE', 'PROBE_ID', probeId as string);
            }
        } else {
            // validate probe.
            if (!PROBE_ID) {
                logger.error('PROBE_ID or ONEUPTIME_SECRET should be set');
                return process.exit();
            }

            await API.post(
                URL.fromString(INGESTOR_URL.toString()).addRoute('/alive'),
                {
                    probeKey: PROBE_KEY.toString(),
                    probeId: PROBE_ID.toString(),
                }
            );

            LocalCache.setString(
                'PROBE',
                'PROBE_ID',
                PROBE_ID.toString() as string
            );
        }

        logger.info(
            `Probe ID: ${
                LocalCache.getString('PROBE', 'PROBE_ID') || 'Unknown'
            }`
        );
    }
}
