import Hostname from 'Common/Types/API/Hostname';
import URL from 'Common/Types/API/URL';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import logger from 'CommonServer/Utils/Logger';
import ping from 'ping';

// TODO - make sure it  work for the IPV6
export interface PingResponse {
    isOnline: boolean;
    responseTimeInMS?: PositiveNumber | undefined;
}

export interface PingOptions {
    timeout?: PositiveNumber;
}

export default class PingMonitor {
    public static async ping(
        host: Hostname | IPv4 | IPv6 | URL,
        pingOptions?: PingOptions,
        retry?: number | undefined
    ): Promise<PingResponse> {
        let hostAddress: string = '';
        if (host instanceof Hostname) {
            hostAddress = host.hostname;
        } else if (host instanceof URL) {
            hostAddress = host.hostname.hostname;
        } else {
            hostAddress = host.toString();
        }

        logger.info("Pinging host: " + hostAddress);

        try {
            const res: ping.PingResponse = await ping.promise.probe(
                hostAddress,
                {
                    timeout: Math.ceil(
                        (pingOptions?.timeout?.toNumber() || 5000) / 1000
                    ),
                }
            );

            logger.info("Pinging host "+hostAddress+" success: ");
            logger.info(res);

            return {
                isOnline: res.alive,
                responseTimeInMS: res.time
                    ? new PositiveNumber(Math.ceil(res.time as any))
                    : undefined,
            };
        } catch (err) {

            logger.info("Pinging host "+hostAddress+" error: ");
            logger.info(err);

            if (!retry) {
                retry = 0; // default value
            }

            if (retry < 5) {
                retry++;
                return await this.ping(host, pingOptions, retry);
            }

            return {
                isOnline: false,
            };
        }
    }
}
