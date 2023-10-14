import URL from 'Common/Types/API/URL';
import logger from 'CommonServer/Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';

if (!process.env['INGESTOR_URL']) {
    logger.error('INGESTOR_URL is not set');
    process.exit();
}

export let INGESTOR_URL: URL = URL.fromString(
    process.env['INGESTOR_URL'] || 'https://oneuptime.com'
);

// If probe api does not have the path. Add it.
if (
    !INGESTOR_URL.toString().endsWith('ingestor') &&
    !INGESTOR_URL.toString().endsWith('ingestor/')
) {
    INGESTOR_URL = URL.fromString(
        INGESTOR_URL.addRoute('/ingestor').toString()
    );
}

export const PROBE_NAME: string | null = process.env['PROBE_NAME'] || null;

export const PROBE_DESCRIPTION: string | null =
    process.env['PROBE_DESCRIPTION'] || null;

export const PROBE_ID: ObjectID | null = process.env['PROBE_ID']
    ? new ObjectID(process.env['PROBE_ID'])
    : null;

if (!process.env['PROBE_KEY']) {
    logger.error('PROBE_KEY is not set');
    process.exit();
}

export const PROBE_KEY: string = process.env['PROBE_KEY'];

let probeMonitoringWorkers: string | number =
    process.env['PROBE_MONITORING_WORKERS'] || 1;

if (typeof probeMonitoringWorkers === 'string') {
    probeMonitoringWorkers = parseInt(probeMonitoringWorkers);
}

export const PROBE_MONITORING_WORKERS: number = probeMonitoringWorkers;

let monitorFetchLimit: string | number =
    process.env['PROBE_MONITOR_FETCH_LIMIT'] || 1;

if (typeof monitorFetchLimit === 'string') {
    monitorFetchLimit = parseInt(monitorFetchLimit);
}

export const PROBE_MONITOR_FETCH_LIMIT: number = monitorFetchLimit;
