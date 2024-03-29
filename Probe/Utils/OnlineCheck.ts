import URL from 'Common/Types/API/URL';
import WebsiteMonitor from './Monitors/MonitorTypes/WebsiteMonitor';

export default class OnlineCheck {
    // burn domain names into the code to see if this probe is online.
    public static async isProbeOnline(): Promise<boolean> {
        const websiteNames: Array<string> = [
            'https://google.com',
            'https://facebook.com',
            'https://microsoft.com',
            'https://youtube.com',
            'https://apple.com',
        ];

        for (const websiteName of websiteNames) {
            if (
                (
                    await WebsiteMonitor.ping(URL.fromString(websiteName), {
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
