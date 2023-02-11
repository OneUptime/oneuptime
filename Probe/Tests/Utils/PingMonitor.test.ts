import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Ping, { PingResponse } from '../../Utils/PingMonitor';

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
        result = await Ping.fetch(new Hostname('www.a.com', 65000), {
            timeout: new PositiveNumber(5000),
        });
        expect(result.isAlive).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();
    });
    test('Ping.fetch should return appropriate object if the valid IPV4 or IPV6 is given', async () => {
        let result: PingResponse;
        //fetch the oneuptime first
        result = await Ping.fetch(new Hostname('oneuptime.com', 80));

        result = await Ping.fetch(result.remoteAddressIP, {
            timeout: new PositiveNumber(5000),
        }); // One of the google ip
        expect(result.isAlive).toBe(true);
        expect(result.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        result = await Ping.fetch(new IPv4('240.1.2.200')); //reserved for the future usee
        expect(result.isAlive).toBe(false);
        expect(result.responseTimeInMS).toBeUndefined();

        result = await Ping.fetch(new IPv6('2001:4860:4860::8888')); //IPV6 google dns resolver
        expect(result.isAlive).toBe(true);
        expect(result.responseTimeInMS).toBeDefined();
    });
});
