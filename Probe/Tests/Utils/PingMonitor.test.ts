import Hostname from 'Common/Types/API/Hostname';
import IPv4 from 'Common/Types/IP/IPv4';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Ping, {
    PingResponse,
} from '../../Utils/Monitors/MonitorTypes/PingMonitor';
import BadDataException from 'Common/Types/Exception/BadDataException';

describe('Ping', () => {
    jest.setTimeout(240000);
    test('Ping.ping should return appropriate object if the valid hostname is given', async () => {
        let result: PingResponse | null = await Ping.ping(
            new Hostname('google.com')
        );

        expect(result).not.toBeNull();
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);
        expect(result!.isOnline).toBe(true);
        result = await Ping.ping(new Hostname('www.apple.com'), {
            timeout: new PositiveNumber(5000),
        });

        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(true);
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);

        try {
            await Ping.ping(new Hostname('www.apple.com', 65000), {
                timeout: new PositiveNumber(5000),
            });
        } catch (err) {
            expect(err).toBeInstanceOf(BadDataException);
        }

        try {
            await Ping.ping(new Hostname('www.a.com', 65000), {
                timeout: new PositiveNumber(5000),
            });
        } catch (err) {
            expect(err).toBeInstanceOf(BadDataException);
        }
    });
    test('Ping.ping should return appropriate object if the valid IPV4 or IPV6 is given', async () => {
        // change test timeout to 2 minutes
        let result: PingResponse | null = null;

        result = await Ping.ping(new IPv4('1.1.1.1'), {
            timeout: new PositiveNumber(5000),
        });
        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(true);
        expect(result!.responseTimeInMS?.toNumber()).toBeGreaterThan(0);
        expect(result!.responseTimeInMS?.toNumber()).toBeLessThanOrEqual(5000);

        result = await Ping.ping(new IPv4('192.0.2.200')); //
        expect(result).not.toBeNull();
        expect(result!.isOnline).toBe(false);
        expect(result!.responseTimeInMS).toBeUndefined();

        result = await Ping.ping(new IPv4('0.42.52.42')); // ip can't start 0
        expect(result).not.toBeNull();
        expect(result!.responseTimeInMS).toBeUndefined();
        expect(result!.isOnline).toBe(false);
    });
});
