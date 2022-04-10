import jwt from 'jsonwebtoken';
import { TokenSecret } from '../Config';

class JSONWebToken {
    static sign(data: string, expiresIn: Date): string {
        return jwt.sign({ data }, TokenSecret, {
            expiresIn: String(expiresIn),
        });
    }
}

export default JSONWebToken;
