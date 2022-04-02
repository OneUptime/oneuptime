import jwt from 'jsonwebtoken';
import { tokenSecret } from '../config';

class JSONWebToken {
    static sign(data: string, expiresIn: Date): string {
        return jwt.sign({ data }, tokenSecret, {
            expiresIn: String(expiresIn),
        });
    }
}

export default JSONWebToken;
