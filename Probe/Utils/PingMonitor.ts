import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import net, { Socket } from 'net';
export interface PingResponse {
    isAlive: boolean;
    responseTimeInMS?: PositiveNumber;
}
export interface PingOptions {
    port?: PositiveNumber;
    timeout?: PositiveNumber;
}
export default class Ping {
    public static async fetch(
        _host: Hostname | IPv4 | IPv6,
        options?: PingOptions
    ): Promise<PingResponse> {
        return new Promise((resolve: Function, _reject: Function) => {
            const timeout: number = options?.timeout?.toNumber() || 4000;
            const startTime: [number, number] = process.hrtime();
            let socket: Socket;
            if (_host instanceof Hostname) {
                socket = net.connect({
                    host: _host.hostname,
                    port: _host.port.toNumber(),
                    timeout,
                });
            } else {
                socket = net.connect({
                    host: _host.toString(),
                    port: options?.port?.toNumber() || 80,
                    timeout,
                });
            }
            socket.on('connect', () => {
                const endTime: [number, number] = process.hrtime(startTime);
                resolve({
                    isAlive: true,
                    responseTimeInMS: new PositiveNumber(
                        (endTime[0] * 1000000000 + endTime[1]) / 1000000
                    ),
                });
            });
            socket.on('timeout', () => {
                resolve({
                    isAlive: false,
                });
            });
            socket.on('data', () => {
                const endTime: [number, number] = process.hrtime(startTime);
                resolve({
                    isAlive: true,
                    responseTimeInMS: new PositiveNumber(
                        (endTime[0] * 1000000000 + endTime[1]) / 1000000
                    ),
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
