import CryptoJS from 'crypto-js';
import { EncryptionSecret } from '../EnvironmentConfig';

export default class Encryption {
    public static async encrypt(text: string): Promise<string> {

        if(!text) {
            return '';
        }

        const secret = await this.getEncryptionSecret();
        const encryptedText = CryptoJS.AES.encrypt(text, secret).toString();
        return encryptedText;
    }

    public static async decrypt(encryptedText: string): Promise<string> {

        if(!encryptedText) {
            return '';
        }

        const secret = await this.getEncryptionSecret();
        const decryptedText = CryptoJS.AES.decrypt(encryptedText, secret).toString();
        return decryptedText;
    }

    private static async getEncryptionSecret(): Promise<string> {
        const encryptionKey = EncryptionSecret.toString();
        return CryptoJS.SHA256(encryptionKey).toString();
    }
}
