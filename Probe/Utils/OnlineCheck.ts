import Hostname from 'Common/Types/API/Hostname';
import PingMonitor from './Monitors/MonitorTypes/PingMonitor';

export default class OnlineCheck {
    // burn domain names into the code to see if this probe is online.
    public static async isProbeOnline(): Promise<boolean> {
        const domainNames: Array<string> = [
            'google.com',
            'facebook.com',
            'microsoft.com',
            'youtube.com',
            'apple.com',
        ];

        for (const domainName of domainNames) {
            if (
                (
                    await PingMonitor.ping(new Hostname(domainName), {
                        isOnlineCheckRequest: true,
                    })
                )?.isOnline
            ) {
                return true;
            }
        }

        return false;
    }
}
