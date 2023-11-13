import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Ping, {
    PingResponse,
} from '../../Utils/Monitors/MonitorTypes/PingMonitor';

describe('Ping', () => {
    jest.setTimeout(10000);

    test('should succeed with a valid and reachable hostname', async () => {
        const result: PingResponse | null = await Ping.ping(
            new Hostname('google.com'),
            {
                timeout: new PositiveNumber(5000),
            }
        );

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(true);
        expect(result!.responseTimeInMS).toBeDefined();
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
    });

    test('should fail with an invalid hostname', async () => {
        const result: PingResponse | null = await Ping.ping(
            new Hostname('invalid.hostname'),
            {
                timeout: new PositiveNumber(5000),
            }
        );

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(false);
        expect(result!.responseTimeInMS).toBeUndefined();
    });

    test('should succeed with a valid IPV4 address', async () => {
        const result: PingResponse | null = await Ping.ping(
            new IPv4('8.8.8.8'),
            {
                timeout: new PositiveNumber(5000),
            }
        );

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(true);
        expect(result!.responseTimeInMS).toBeDefined();
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
    });

    test('should succeed with a valid and reachable IPv6 address', async () => {
        const ipv6Address: IPv6 = new IPv6('2001:4860:4860::8888');
        const result: PingResponse | null = await Ping.ping(ipv6Address);

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(true);
        expect(result!.responseTimeInMS).toBeDefined();
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
    });

    test('should fail with an unreachable IPv6 address', async () => {
        const ipv6Address: IPv6 = new IPv6(
            'abcd:ef01:2345:6789:abcd:ef01:2345:6789'
        );
        // since ping does not support timeouts on IPv6, we set the deadline to 1 second to avoid exceeding jest's timeout
        const result: PingResponse | null = await Ping.ping(ipv6Address, {
            deadline: 1,
        });

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(false);
        expect(result!.responseTimeInMS).toBeUndefined();
    });
});
