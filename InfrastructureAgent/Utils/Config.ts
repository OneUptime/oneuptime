import URL from 'Common/Types/API/URL';
import logger from 'CommonServer/Utils/Logger';

export const SecretKey: string | undefined = process.env['SECRET_KEY'];
export const OneUptimeURL: URL = process.env['ONEUPTIME_URL']
    ? URL.fromString(process.env['ONEUPTIME_URL'])
    : URL.fromString('https://oneuptime.com');

if (!SecretKey) {
    logger.error(
        'No SECRET_KEY environment variable found. You can find secret key for this monitor on OneUptime Dashboard'
    );
}

if (OneUptimeURL.toString() === 'https://oneuptime.com') {
    logger.error(
        'No ONEUPTIME_URL environment variable found. Using default OneUptime URL - https://oneuptime.com'
    );
}
