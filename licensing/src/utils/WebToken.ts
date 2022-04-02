import JWT from 'common-server/utils/json-web-token';

class WebToken {
    static generateWebToken(licenseKey: string, expiryTime: Date): string {
        return JWT.sign(licenseKey, expiryTime);
    }
}

export default WebToken;
