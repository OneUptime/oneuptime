import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import UserRole from 'Common/Types/UserRole';
import jwt from 'jsonwebtoken';
import { EncryptionSecret } from '../Config';

export interface JSONWebTokenData {
    userId: ObjectID,
    email: Email,
    roles: Array<UserRole>,
    isMasterAdmin: boolean
}

class JSONWebToken {

    public static sign(data: JSONWebTokenData, expiresIn: Date): string {
        return jwt.sign({
            userId: data.userId.toString(),
            email: data.email.toString(),
            roles: data.roles.map((role: UserRole): JSONObject => role.toJSON()),
            isMasterAdmin: data.isMasterAdmin
        }, EncryptionSecret, {
            expiresIn: String(expiresIn),
        });
    }

    public static decode(token: string): JSONWebTokenData {
        try {
        
            const decoded: JSONObject = JSON.parse(jwt.verify(token, EncryptionSecret) as string);

            return {
                userId: new ObjectID(decoded["userId"] as string),
                email: new Email(decoded["email"] as string),
                roles: (decoded["roles"] as JSONArray).map((obj: JSONObject): UserRole => {
                    return UserRole.fromJSON(obj);
                }),
                isMasterAdmin: !!decoded["isMasterAdmin"]
            }
        } catch (e) {
            throw new BadDataException("AccessToken is invalid or expired");
        }
    }
}

export default JSONWebToken;
