import Hostname from 'Common/Types/API/Hostname';
import URL from 'Common/Types/API/URL';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import net, { Socket } from 'net';

// TODO - make sure it  work for the IPV6
export interface PingResponse {
    isOnline: boolean;
    responseTimeInMS?: PositiveNumber;
}

export interface PingOptions {
    timeout?: PositiveNumber;
}

export default class PingMonitor {
    public static async ping(
        host: Hostname | IPv4 | IPv6 | URL,
        pingOptions?: PingOptions
    ): Promise<PingResponse> {
        return new Promise<PingResponse>(
            (resolve: Function, _reject: Function) => {
                const timeout: number =
                    pingOptions?.timeout?.toNumber() || 5000;
                const startTime: [number, number] = process.hrtime();
                let responseTimeInMS: PositiveNumber;
                let connectionOptions: net.NetConnectOpts;
                if (host instanceof Hostname) {
                    connectionOptions = {
                        host: host.hostname,
                        port: host.port.toNumber(),
                        timeout,
                    };
                } else if (host instanceof URL) {
                    connectionOptions = {
                        host: host.hostname.hostname,
                        port:
                            host.hostname.port?.toNumber() ||
                            (host.isHttps() ? 443 : 80),
                        timeout,
                    };
                } else {
                    connectionOptions = {
                        host: host.toString(),
                        port: 80,
                        timeout,
                    };
                }
                const socket: Socket = net.connect(connectionOptions);
                socket.on('connect', () => {
                    const endTime: [number, number] = process.hrtime(startTime);
                    responseTimeInMS = new PositiveNumber(
                        (endTime[0] * 1000000000 + endTime[1]) / 1000000
                    );
                });
                socket.on('timeout', () => {
                    resolve({
                        isOnline: false,
                    });
                });
                socket.on('connect', () => {
                    socket.end(() => {
                        resolve({
                            isOnline: true,
                            responseTimeInMS,
                        });
                    });
                });
                socket.on('error', () => {
                    resolve({
                        isOnline: false,
                    });
                });
            }
        );
    }
}
