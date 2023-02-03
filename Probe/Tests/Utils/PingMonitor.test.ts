import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import PositiveNumber from 'Common/Types/PositiveNumber';
import type { PingResponse } from '../../Utils/PingMonitor';
import Ping from '../../Utils/PingMonitor';

describe('Ping', () => {
    jest.setTimeout(10000);
    test('Ping.fetch should return appropriate object if the valid hostname is given', async () => {
        let result: PingResponse = await Ping.fetch(
            new Hostname('google.com', 80)
        );
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        expect(result.isAlive).toBe(true);
        result = await Ping.fetch(new Hostname('www.google.com', 80), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isAlive).toBe(true);
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        result = await Ping.fetch(new Hostname('www.google.com', 65000), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isAlive).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
        result = await Ping.fetch(new Hostname('www.a.com', 65000), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isAlive).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
    });
    test('Ping.fetch should return appropriate object if the valid IPV4 or IPV6 is given', async () => {
        let result: PingResponse;
        result = await Ping.fetch(new IPv4('172.217.170.206'), {
            timeout: new PositiveNumber(5000),
        }); // One of the google ip
        expect(result.isAlive).toBe(true);
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        result = await Ping.fetch(new IPv4('192.0.2.200')); //
        expect(result.isAlive).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
        result = await Ping.fetch(new IPv4('0.42.52.42')); // ip can't start 0
        expect(result.responseTimeInMS).toBeUndefined();
        expect(result.isAlive).toBe(false);
    });
});
