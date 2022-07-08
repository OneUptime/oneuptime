import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import UserRole from 'Common/Types/UserRole';
import jwt from 'jsonwebtoken';
import { EncryptionSecret } from '../Config';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';

class JSONWebToken {
    public static sign(
        data: JSONWebTokenData | string,
        expiresInSeconds: number
    ): string {
        return jwt.sign(
            typeof data !== 'string'
                ? {
                      userId: data.userId.toString(),
                      email: data.email.toString(),
                      roles: data.roles.map((role: UserRole): JSONObject => {
                          return role.toJSON();
                      }),
                      isMasterAdmin: data.isMasterAdmin,
                  }
                : data,
            EncryptionSecret.toString(),
            {
                expiresIn: expiresInSeconds,
            }
        );
    }

    public static decode(token: string): JSONWebTokenData {
        try {
            const decodedToken: string = JSON.stringify(jwt.verify(token, EncryptionSecret.toString()) as string);
            const decoded: JSONObject = JSON.parse(
                decodedToken
            );

            return {
                userId: new ObjectID(decoded['userId'] as string),
                email: new Email(decoded['email'] as string),
                roles: (decoded['roles'] as JSONArray).map(
                    (obj: JSONObject): UserRole => {
                        return UserRole.fromJSON(obj);
                    }
                ),
                isMasterAdmin: Boolean(decoded['isMasterAdmin']),
            };
        } catch (e) {
            throw new BadDataException('AccessToken is invalid or expired');
        }
    }
}

export default JSONWebToken;
