import Hostname from 'Common/Types/API/Hostname';
import URL from 'Common/Types/API/URL';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import logger from 'CommonServer/Utils/Logger';
import net from 'net';
import Sleep from 'Common/Types/Sleep';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Port from 'Common/Types/Port';

// TODO - make sure it  work for the IPV6
export interface PortMonitorResponse {
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

export default class PortMonitor {
    // burn domain names into the code to see if this probe is online.
    public static async isProbeOnline(): Promise<boolean> {
        if (
            (
                await PortMonitor.ping(
                    new Hostname('google.com'),
                    new Port(80),
                    {
                        isOnlineCheckRequest: true,
                    }
                )
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PortMonitor.ping(
                    new Hostname('facebook.com'),
                    new Port(80),
                    {
                        isOnlineCheckRequest: true,
                    }
                )
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PortMonitor.ping(
                    new Hostname('microsoft.com'),
                    new Port(80),
                    {
                        isOnlineCheckRequest: true,
                    }
                )
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PortMonitor.ping(
                    new Hostname('youtube.com'),
                    new Port(80),
                    {
                        isOnlineCheckRequest: true,
                    }
                )
            )?.isOnline
        ) {
            return true;
        } else if (
            (
                await PortMonitor.ping(
                    new Hostname('apple.com'),
                    new Port(80),
                    {
                        isOnlineCheckRequest: true,
                    }
                )
            )?.isOnline
        ) {
            return true;
        }

        return false;
    }

    public static async ping(
        host: Hostname | IPv4 | IPv6 | URL,
        port: Port,
        pingOptions?: PingOptions
    ): Promise<PortMonitorResponse | null> {

        if(!pingOptions){
            pingOptions = {};
        }

        if(pingOptions?.currentRetryCount === undefined){
            pingOptions.currentRetryCount = 1;
        }

        let hostAddress: string = '';
        if (host instanceof Hostname) {
            hostAddress = host.hostname;

            if (host.port) {
                port = host.port;
            }
        } else if (host instanceof URL) {
            hostAddress = host.hostname.hostname;

            if (host.hostname.port) {
                port = host.hostname.port;
            }
        } else {
            hostAddress = host.toString();
        }

        if (!port) {
            throw new BadDataException('Port is not specified');
        }

        logger.info(
            `Pinging host: ${pingOptions?.monitorId?.toString()}  ${hostAddress}:${port.toString()} - Retry: ${
                pingOptions?.currentRetryCount
            }`
        );

        try {
            // Ping a host with port

            const promiseResult = new Promise((resolve, reject) => {
                const startTime: [number, number] = process.hrtime();

                const socket = new net.Socket();

                socket.setTimeout(pingOptions?.timeout?.toNumber() || 5000);

                if (!port) {
                    throw new BadDataException('Port is not specified');
                }

                socket.connect(port.toNumber(), hostAddress, () => {
                    const endTime: [number, number] = process.hrtime(startTime);
                    const responseTimeInMS: PositiveNumber = new PositiveNumber(
                        (endTime[0] * 1000000000 + endTime[1]) / 1000000
                    );

                    logger.info(
                        `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress}:${port!.toString()} success: Response Time ${responseTimeInMS} ms`
                    );

                    socket.destroy(); // Close the connection after success
                    return resolve(responseTimeInMS);
                });

                socket.on('error', error => {
                    reject(error);
                    logger.info('Could not connect to: ' + host + ':' + port);
                });
            });

            const responseTimeInMS: PositiveNumber =
                (await promiseResult) as PositiveNumber;

            return {
                isOnline: true,
                responseTimeInMS: responseTimeInMS,
                failureCause: '',
            };
        } catch (err: unknown) {
            logger.info(
                `Pinging host ${pingOptions?.monitorId?.toString()} ${hostAddress}:${port.toString()} error: `
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
                await Sleep.sleep(1000);
                return await this.ping(host, port, pingOptions);
            }

            // check if the probe is online.
            if (!pingOptions.isOnlineCheckRequest) {
                if (!(await PortMonitor.isProbeOnline())) {
                    logger.error(
                        `PortMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${host.toString()} - ERROR: ${err}`
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
