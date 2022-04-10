import JWT from 'common-server/utils/JsonWebToken';

class WebToken {
    static generateWebToken(licenseKey: string, expiryTime: Date): string {
        return JWT.sign(licenseKey, expiryTime);
    }
}

export default WebToken;
