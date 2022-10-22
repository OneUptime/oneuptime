import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import net, { Socket } from 'net';
export interface PingResponse {
    isAlive: boolean;
    responseTimeInMS?: PositiveNumber;
    ipAddress: IPv4 | IPv6;
}
export interface PingOptions {
    port?: PositiveNumber;
}
export default class Ping {
    public static async fetch(
        _host: Hostname | IPv4 | IPv6,
        options?: PingOptions
    ): Promise<PingResponse> {
        return new Promise((resolve: Function, _reject: Function) => {
            const startTime: [number, number] = process.hrtime();
            let socket: Socket;
            if (_host instanceof Hostname) {
                socket = net.connect({
                    host: _host.hostname,
                    port: _host.port.toNumber(),
                });
            } else {
                socket = net.connect({
                    host: _host.toString(),
                    port: options?.port?.toNumber() || 80,
                });
            }
            socket.on('connect', () => {
                const endTime: [number, number] = process.hrtime(startTime);
                resolve({
                    isAlive: true,
                    responseTimeInMS: new PositiveNumber(endTime[1]),
                    ipAddress: socket.remoteAddress,
                });
            });
            socket.on('error', () => {
                resolve({
                    isAlive: false,
                });
            });
        });
    }
}
