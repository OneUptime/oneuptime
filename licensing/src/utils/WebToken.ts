// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'json... Remove this comment to see the full error message
import jwt from 'jsonwebtoken';
// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/token"' has no exported member ... Remove this comment to see the full error message
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
