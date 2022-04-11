import jwt from 'jsonwebtoken';
import { EncryptionSecret } from '../Config';

class JSONWebToken {
    static sign(data: string, expiresIn: Date): string {
        return jwt.sign({ data }, EncryptionSecret, {
            expiresIn: String(expiresIn),
        });
    }
}

export default JSONWebToken;
