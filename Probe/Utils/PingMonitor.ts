import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import Port from 'Common/Types/Port';
import PositiveNumber from 'Common/Types/PositiveNumber';
import net, { Socket } from 'net';
export interface PingResponse {
    isAlive: boolean;
    responseTimeInMS?: PositiveNumber;
    remoteAddressIP: IPv4 | IPv6;
    remoteAddressPort: Port;
}
export interface PingOptions {
    port?: PositiveNumber;
    timeout?: PositiveNumber;
}
export default class Ping {
    public static async fetch(
        _host: Hostname | IPv4 | IPv6,
        pingOptions?: PingOptions
    ): Promise<PingResponse> {
        return new Promise<PingResponse>(
            (resolve: Function, _reject: Function) => {
                const timeout: number =
                    pingOptions?.timeout?.toNumber() || 4000;
                const startTime: [number, number] = process.hrtime();
                let responseTimeInMS: PositiveNumber;
                let connectionOptions: net.NetConnectOpts;
                if (_host instanceof Hostname) {
                    connectionOptions = {
                        host: _host.hostname,
                        port: _host.port.toNumber(),
                        timeout,
                    };
                } else {
                    connectionOptions = {
                        host: _host.toString(),
                        port: pingOptions?.port?.toNumber() || 80,
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
                        isAlive: false,
                    });
                });
                socket.on('connect', (data: any) => {
                    // eslint-disable-next-line no-console
                    console.log(data?.toString());
                    const remoteAddressIP: undefined | IPv4 | IPv6 | '' =
                        socket.remoteAddress &&
                        (net.isIPv4(socket.remoteAddress)
                            ? new IPv4(socket.remoteAddress)
                            : new IPv6(socket.remoteAddress));

                    socket.end(() => {
                        resolve({
                            isAlive: true,
                            responseTimeInMS,
                            remoteAddressIP,
                            remoteAddressPort:
                                socket.remotePort &&
                                new Port(socket.remotePort),
                            bytesReceived: new PositiveNumber(socket.bytesRead),
                            bytesSent: new PositiveNumber(socket.bytesRead),
                        });
                    });
                });
                socket.on('error', () => {
                    resolve({
                        isAlive: false,
                    });
                });
            }
        );
    }
}
