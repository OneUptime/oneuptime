import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import IPv6 from 'Common/Types/IP/IPv6';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Ping, {
    PingResponse,
} from '../../Utils/Monitors/MonitorTypes/PingMonitor';
import ping from 'ping';

jest.mock('ping');

type HostResponses = {
    [key: string]: { alive: boolean; time?: number } | Error;
};

const hostResponses: HostResponses = {
    'google.com': { alive: true, time: 50 },
    'facebook.com': { alive: true, time: 50 },
    'microsoft.com': { alive: true, time: 50 },
    'youtube.com': { alive: true, time: 50 },
    'apple.com': { alive: true, time: 50 },
    '8.8.8.8': { alive: true, time: 50 },
    '2001:4860:4860::8888': { alive: true, time: 50 },
    'invalid.hostname': { alive: false },
    'other.hostname': new Error('some error'),
};

const mockProbe: jest.Mock = jest.fn((host: string) => {
    const response: { alive: boolean; time?: number } | Error | undefined =
        hostResponses[host];
    if (response) {
        if (response instanceof Error) {
            return Promise.reject(response);
        }
        return Promise.resolve(response);
    }
    return Promise.reject(
        response ?? new Error('some error including timeout and exceeded words')
    );
});

describe('Ping', () => {
    describe('ping()', () => {
        afterAll(() => {
            jest.restoreAllMocks();
            jest.mock('ping');
        });

        jest.setTimeout(20000);

        // @ts-ignore
        ping.promise.probe = mockProbe;
        it('should succeed with a valid and reachable hostname', async () => {
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
            expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(
                5000
            );
        });

        it('should succeed with a valid IPV4 address', async () => {
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
            expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(
                5000
            );
        });

        it('should succeed with a valid and reachable IPv6 address', async () => {
            const ipv6Address: IPv6 = new IPv6('2001:4860:4860::8888');
            const result: PingResponse | null = await Ping.ping(ipv6Address);

            expect(result).not.toBeNull();
            expect(result!.isOnline).toBe(true);
            expect(result!.responseTimeInMS).toBeDefined();
            expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
            expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(
                5000
            );
        });

        it('should fail with an invalid hostname', async () => {
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

        it('should fail with an unreachable IPv6 address', async () => {
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

        it('should return failureCause as Timeout exceeded on timeout', async () => {
            const unreachableHost: Hostname = new Hostname('10.255.255.1');
            const timeout: PositiveNumber = new PositiveNumber(1); // very low to force timeout

            const result: PingResponse | null = await Ping.ping(
                unreachableHost,
                { timeout }
            );

            expect(result).not.toBeNull();
            expect(result!.isOnline).toBe(false);
            expect(result!.failureCause).toBe('Timeout exceeded');
        });

        it('should return null when the probe is offline and it is not an online check request', async () => {
            jest.spyOn(Ping, 'isProbeOnline').mockResolvedValue(false);

            const offlineHost: Hostname = new Hostname('other.hostname');
            const result: PingResponse | null = await Ping.ping(offlineHost, {
                isOnlineCheckRequest: false,
            });

            expect(result).toBeNull();
            expect(Ping.isProbeOnline).toHaveBeenCalled();
        });
    });

    describe('isProbeOnline', () => {
        it('should return true if any ping is successful', async () => {
            Ping.ping = jest
                .fn()
                .mockResolvedValueOnce({ isOnline: false })
                .mockResolvedValueOnce({ isOnline: true });

            const result: boolean = await Ping.isProbeOnline();
            expect(result).toBe(true);
        });

        it('should return false if all pings fail', async () => {
            Ping.ping = jest.fn().mockResolvedValueOnce({ isOnline: false });

            const result: boolean = await Ping.isProbeOnline();
            expect(result).toBe(false);
        });
    });
});
