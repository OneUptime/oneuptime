import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import jwt from 'jsonwebtoken';
import { EncryptionSecret } from '../Config';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import Name from 'Common/Types/Name';
import User from 'Model/Models/User';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import JSONFunctions from 'Common/Types/JSONFunctions';

class JSONWebToken {
    public static sign(
        data: JSONWebTokenData | User | StatusPagePrivateUser | string,
        expiresInSeconds: number
    ): string {
        let jsonObj: JSONObject;

        if (typeof data === 'string') {
            jsonObj = {
                data: data.toString(),
            };
        } else if (data instanceof User) {
            jsonObj = {
                userId: data.id!.toString(),
                email: data.email!.toString(),
                name: data.name?.toString() || '',
                isMasterAdmin: data.isMasterAdmin!,
            };
        } else if (data instanceof StatusPagePrivateUser) {
            jsonObj = {
                userId: data.id!.toString(),
                email: data.email!.toString(),
                statusPageId: data.statusPageId?.toString(),
            };
        } else {
            jsonObj = {
                userId: data.userId.toString(),
                email: data.email.toString(),
                name: data.name?.toString() || '',
                projectId: data.projectId?.toString() || '',
                isMasterAdmin: data.isMasterAdmin,
            };
        }

        return JSONWebToken.signJsonPayload(jsonObj, expiresInSeconds);
    }

    public static signJsonPayload(
        payload: JSONObject,
        expiresInSeconds: number
    ): string {
        return jwt.sign(payload, EncryptionSecret.toString(), {
            expiresIn: expiresInSeconds,
        });
    }

    public static decodeJsonPayload(token: string): JSONObject {
        const decodedToken: string = JSON.stringify(
            jwt.verify(token, EncryptionSecret.toString()) as string
        );
        const decoded: JSONObject = JSONFunctions.parse(decodedToken);

        return decoded;
    }

    public static decode(token: string): JSONWebTokenData {
        try {
            const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

            if (decoded['statusPageId']) {
                return {
                    userId: new ObjectID(decoded['userId'] as string),
                    email: new Email(decoded['email'] as string),
                    statusPageId: new ObjectID(
                        decoded['statusPageId'] as string
                    ),
                    isMasterAdmin: false,
                    name: new Name('User'),
                };
            }

            return {
                userId: new ObjectID(decoded['userId'] as string),
                email: new Email(decoded['email'] as string),
                name: new Name(decoded['name'] as string),
                projectId: decoded['projectId']
                    ? new ObjectID(decoded['projectId'] as string)
                    : undefined,
                isMasterAdmin: Boolean(decoded['isMasterAdmin']),
            };
        } catch (e) {
            throw new BadDataException('AccessToken is invalid or expired');
        }
    }
}

export default JSONWebToken;
