import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import jwt from 'jsonwebtoken';
import { EncryptionSecret } from '../Config';
import JSONWebTokenData from 'Common/Types/JsonWebTokenData';
import Name from 'Common/Types/Name';
import User from 'Common/Models/User';

class JSONWebToken {
    public static sign(
        data: JSONWebTokenData | User | string,
        expiresInSeconds: number
    ): string {
        let jsonObj: JSONObject;

        if (typeof data === "string") {
            jsonObj = {
                data: data.toString(),
            };
        } else if (!(data instanceof User)) {
            jsonObj = {
                userId: data.userId.toString(),
                email: data.email.toString(),
                name: data.name.toString(),
                isMasterAdmin: data.isMasterAdmin,
            };
        } else {
            jsonObj = {
                userId: data.id!.toString(),
                email: data.email!.toString(),
                name: data.name!.toString(),
                isMasterAdmin: data.isMasterAdmin!,
            };
        }

        return jwt.sign(jsonObj, EncryptionSecret.toString(), {
            expiresIn: expiresInSeconds,
        });
    }

    public static decode(token: string): JSONWebTokenData {
        try {
            const decodedToken: string = JSON.stringify(
                jwt.verify(token, EncryptionSecret.toString()) as string
            );
            const decoded: JSONObject = JSON.parse(decodedToken);

            return {
                userId: new ObjectID(decoded['userId'] as string),
                email: new Email(decoded['email'] as string),
                name: new Name(decoded['name'] as string),
                isMasterAdmin: Boolean(decoded['isMasterAdmin']),
            };
        } catch (e) {
            throw new BadDataException('AccessToken is invalid or expired');
        }
    }
}

export default JSONWebToken;
