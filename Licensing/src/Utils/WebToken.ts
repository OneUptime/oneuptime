import JWT from 'CommonServer/Utils/JsonWebToken';

class WebToken {
    public static generateWebToken(
        licenseKey: string,
        expiryTime: Date
    ): string {
        return JWT.sign(licenseKey, expiryTime);
    }
}

export default WebToken;
