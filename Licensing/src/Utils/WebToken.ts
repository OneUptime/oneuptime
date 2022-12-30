import JWT from 'CommonServer/Utils/JsonWebToken';
import OneUptimeDate from 'Common/Types/Date';

class WebToken {
    public static generateWebToken(
        licenseKey: string,
        expiryTime: Date
    ): string {
        return JWT.sign(licenseKey, OneUptimeDate.getSecondsTo(expiryTime));
    }
}

export default WebToken;
