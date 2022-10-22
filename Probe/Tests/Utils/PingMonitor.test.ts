import Hostname from 'Common/Types/API/Hostname';
import Ping, { PingResponse } from '../../Utils/PingMonitor';

describe('PingMonitor', () => {
    test('PingMonitor.fetch should', async () => {
        const result: PingResponse = await Ping.fetch(
            new Hostname('google.com/q', 443)
        );
        // eslint-disable-next-line no-console
        console.log(result);
    });
});
