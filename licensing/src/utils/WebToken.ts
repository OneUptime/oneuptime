
import jwt from 'jsonwebtoken';

import { tokenSecret } from '../config/token';

const _this = {
    generateWebToken: ({ licenseKey, presentTime, expiryTime }: $TSFixMe) => {
        const tokenExpiryTime = expiryTime - presentTime;

        return jwt.sign({ licenseKey }, tokenSecret, {
            expiresIn: String(tokenExpiryTime),
        });
    },
};

export default _this;
