import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Ping, { PingResponse } from '../../Utils/Monitors/MonitorTypes/PingMonitor';

describe('Ping', () => {
    jest.setTimeout(10000);
    test('Ping.ping should return appropriate object if the valid hostname is given', async () => {
        let result: PingResponse = await Ping.ping(
            new Hostname('google.com', 80)
        );
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        expect(result.isOnline).toBe(true);
        result = await Ping.ping(new Hostname('www.google.com', 80), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isOnline).toBe(true);
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        result = await Ping.ping(new Hostname('www.google.com', 65000), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isOnline).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
        result = await Ping.ping(new Hostname('www.a.com', 65000), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isOnline).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
    });
    test('Ping.ping should return appropriate object if the valid IPV4 or IPV6 is given', async () => {
        let result: PingResponse;
        result = await Ping.ping(new IPv4('172.217.170.206'), {
            timeout: new PositiveNumber(5000),
        }); // One of the google ip
        expect(result.isOnline).toBe(true);
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        result = await Ping.ping(new IPv4('192.0.2.200')); //
        expect(result.isOnline).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
        result = await Ping.ping(new IPv4('0.42.52.42')); // ip can't start 0
        expect(result.responseTimeInMS).toBeUndefined();
        expect(result.isOnline).toBe(false);
    });
});
