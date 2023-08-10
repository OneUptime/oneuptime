import Hostname from 'Common/Types/API/Hostname';
import URL from 'Common/Types/API/URL';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import logger from 'CommonServer/Utils/Logger';
import ping from 'ping';

// TODO - make sure it  work for the IPV6
export interface PingResponse {
    isOnline: boolean;
    responseTimeInMS?: PositiveNumber | undefined;
    failureCause: string;
}

export interface PingOptions {
    timeout?: PositiveNumber;
    retry?: number | undefined;
    currentRetryCount?: number | undefined;
    monitorId?: ObjectID | undefined;
    isOnlineCheckRequest?: boolean | undefined;
}

export default class PingMonitor {
    // burn domain names into the code to see if this probe is online.
    public static async isProbeOnline(): Promise<boolean> {
        if (
            (
                await PingMonitor.ping(new Hostname('google.com'), {
                    isOnlineCheckRequest: true,
                })
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PingMonitor.ping(new Hostname('facebook.com'), {
                    isOnlineCheckRequest: true,
                })
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PingMonitor.ping(new Hostname('microsoft.com'), {
                    isOnlineCheckRequest: true,
                })
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PingMonitor.ping(new Hostname('youtube.com'), {
                    isOnlineCheckRequest: true,
                })
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PingMonitor.ping(new Hostname('apple.com'), {
                    isOnlineCheckRequest: true,
                })
            )?.isOnline
        ) {
            return true;
        }

        return false;
    }

    public static async ping(
        host: Hostname | IPv4 | IPv6 | URL,
        pingOptions?: PingOptions
    ): Promise<PingResponse | null> {
        let hostAddress: string = '';
        if (host instanceof Hostname) {
            hostAddress = host.hostname;
        } else if (host instanceof URL) {
            hostAddress = host.hostname.hostname;
        } else {
            hostAddress = host.toString();
        }

        logger.info(
            `Pinging host: ${pingOptions?.monitorId?.toString()}  ${hostAddress}`
        );

        try {
            const res: ping.PingResponse = await ping.promise.probe(
                hostAddress,
                {
                    timeout: Math.ceil(
                        (pingOptions?.timeout?.toNumber() || 5000) / 1000
                    ),
                }
            );

            logger.info(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress} success: `
            );
            logger.info(res);

            return {
                isOnline: res.alive,
                responseTimeInMS: res.time
                    ? new PositiveNumber(Math.ceil(res.time as any))
                    : undefined,
                failureCause: '',
            };
        } catch (err: unknown) {
            logger.info(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress} error: `
            );
            logger.info(err);

            if (!pingOptions) {
                pingOptions = {};
            }

            if (!pingOptions.currentRetryCount) {
                pingOptions.currentRetryCount = 0;
            }

            if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
                pingOptions.currentRetryCount++;
                return await this.ping(host, pingOptions);
            }

            // check if timeout exceeded and if yes, return null
            if (
                (err as any).toString().includes('timeout') &&
                (err as any).toString().includes('exceeded')
            ) {
                logger.info(
                    `Ping Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`
                );
                return null;
            }

            // check if the probe is online.
            if (!pingOptions.isOnlineCheckRequest) {
                if (!(await PingMonitor.isProbeOnline())) {
                    logger.error(
                        `PingMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`
                    );
                    return null;
                }
            }

            return {
                isOnline: false,
                failureCause: (err as any).toString(),
            };
        }
    }
}
