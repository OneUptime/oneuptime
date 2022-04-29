import logger from 'CommonServer/Utils/Logger';
import ProbeAPI from '../Utils/ProbeAPI';
import ApiMonitors from './ApiMonitors';
import UrlMonitors from './UrlMonitors';
import IPMonitors from './IpMonitors';
import ServerMonitors from './ServerMonitors';
import sleep from 'sleep-promise';
import IncomingHttpRequestMonitors from './incomingHttpRequestMonitors';
import KubernetesMonitors from './kubernetesMonitors';
import { ResourcesLimit } from '../Config';

const _this: $TSFixMe = {
    runJob: async function (): void {
        logger.info(`Getting a list of ${ResourcesLimit.toString()} monitors`);

        let monitors: $TSFixMe = await ProbeAPI.get(
            'probe/monitors',
            ResourcesLimit.toNumber()
        );
        monitors = JSON.parse(monitors.data); // Parse the stringified data

        logger.info(`Number of Monitors fetched - ${monitors.length} monitors`);

        if (monitors.length === 0) {
            // There are no monitors to monitor. Sleep for 30 seconds and then wake up.
            logger.info('No monitors to monitor. Sleeping for 30 seconds.');
            await sleep(30 * 1000);
        }

        // Loop over the monitor
        for (const monitor of monitors) {
            logger.info(`Monitor ID ${monitor._id}: Currently monitoring`);
            if (monitor.type === 'api') {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring API monitor`
                );
                await ApiMonitors.ping({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring API monitor`
                );
            } else if (monitor.type === 'url') {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring URL monitor`
                );
                await UrlMonitors.ping({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring URL monitor`
                );
            } else if (monitor.type === 'ip') {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring IP monitor`
                );
                await IPMonitors.ping({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring IP monitor`
                );
            } else if (
                monitor.type === 'server-monitor' &&
                monitor.agentlessConfig
            ) {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring Server monitor`
                );
                await ServerMonitors.run({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring Server monitor`
                );
            } else if (monitor.type === 'incomingHttpRequest') {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring Incoming HTTP Request monitor`
                );
                await IncomingHttpRequestMonitors.run({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring Incoming HTTP Request monitor`
                );
            } else if (monitor.type === 'kubernetes') {
                logger.info(
                    `Monitor ID ${monitor._id}: Start monitoring Kubernetes monitor`
                );
                await KubernetesMonitors.run({ monitor });
                logger.info(
                    `Monitor ID ${monitor._id}: End monitoring Kubernetes monitor`
                );
            }
        }
    },
};

export default _this;
