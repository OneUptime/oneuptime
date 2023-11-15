import ping from 'ping';
import logger from 'CommonServer/Utils/Logger';
import Sleep from 'Common/Types/Sleep';
import UnableToReachServer from 'Common/Types/Exception/UnableToReachServer';

import Hostname from 'Common/Types/API/Hostname';
import URL from 'Common/Types/API/URL';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';

export interface PingResponse {
    isOnline: boolean;
    responseTimeInMS?: PositiveNumber | undefined;
    failureCause: string;
}

export interface PingOptions {
    timeout?: PositiveNumber;
    retry?: number;
    currentRetryCount?: number;
    monitorId?: ObjectID;
    isOnlineCheckRequest?: boolean;
    deadline?: number;
}

export default class PingMonitor {
    private static checkHosts = [
        'google.com',
        'facebook.com',
        'microsoft.com',
        'youtube.com',
        'apple.com',
    ];

    public static async isProbeOnline(): Promise<boolean> {
        for (const host of PingMonitor.checkHosts) {
            const response: PingResponse | null = await PingMonitor.ping(
                new Hostname(host),
                {
                    isOnlineCheckRequest: true,
                }
            );
            if (response?.isOnline) {
                return true;
            }
        }
        return false;
    }

    public static async ping(
        host: Hostname | IPv4 | IPv6 | URL,
        pingOptions: PingOptions = {}
    ): Promise<PingResponse | null> {
        const hostAddress: string =
            host instanceof URL ? host.hostname.hostname : host.toString();
        const isIPv6: boolean = host instanceof IPv6;

        const { monitorId, currentRetryCount = 0, retry = 5 } = pingOptions;

        let timeout: PositiveNumber | false | undefined = pingOptions.timeout;
        // if undefined or null, set default timeout (5 seconds)
        if (timeout === undefined || timeout === null) {
            timeout = new PositiveNumber(5000);
        } else if (isIPv6) {
            // for IPv6, since node-ping does not support timeout (see https://github.com/danielzzz/node-ping/issues/145#issuecomment-1140529228), we set it to false
            timeout = false;
        } else if (timeout) {
            timeout = new PositiveNumber(Math.ceil(timeout.toNumber() / 1000));
        }

        logger.info(
            `Pinging host ${monitorId?.toString()} at ${hostAddress}, Retry: ${currentRetryCount}`
        );

        try {
            const res: ping.PingResponse = await ping.promise.probe(
                hostAddress,
                {
                    v6: isIPv6,
                    // @ts-ignore (probe expects timeout to be number | undefined but at the same time they say we should set to false if we want to disable an argument -> https://github.com/danielzzz/node-ping/blob/842a04247856abfab6667919d682ec064ece3f2c/README.md?plain=1#L181)
                    timeout: timeout,
                    deadline: pingOptions.deadline,
                }
            );

            if (!res.alive) {
                throw new UnableToReachServer(
                    `Unable to reach host ${hostAddress}. Monitor ID: ${monitorId?.toString()}`
                );
            }

            return {
                isOnline: true,
                responseTimeInMS: res.time
                    ? new PositiveNumber(Math.ceil(res.time as any))
                    : undefined,
                failureCause: '',
            };
        } catch (err) {
            logger.error(
                `Error pinging host ${monitorId?.toString()} at ${hostAddress}:`,
                err
            );

            if (currentRetryCount < retry) {
                await Sleep.sleep(1000);
                return this.ping(host, {
                    ...pingOptions,
                    currentRetryCount: currentRetryCount + 1,
                });
            }

            if (this.hasTimedOut(err)) {
                return { isOnline: false, failureCause: 'Timeout exceeded' };
            }

            if (
                !pingOptions.isOnlineCheckRequest &&
                !(await PingMonitor.isProbeOnline())
            ) {
                return null;
            }

            return {
                isOnline: false,
                failureCause: err instanceof Error ? err.message : String(err),
            };
        }
    }

    private static hasTimedOut(err: any): boolean {
        let strError: string = '';
        if (typeof err === 'object') {
            strError = err.toString();
        }
        return strError.includes('timeout') && strError.includes('exceeded');
    }
}
