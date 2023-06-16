import BadDataException from 'Common/Types/Exception/BadDataException';
import {
    TwilioAccountSid,
    TwilioAuthToken,
    TwilioPhoneNumber,
} from '../Config';

export default class TwilioUtil {
    public static checkEnvironmentVariables(): void {
        if (!TwilioAccountSid) {
            throw new BadDataException('TwilioAccountSid is not configured');
        }

        if (!TwilioAuthToken) {
            throw new BadDataException('TwilioAuthToken is not configured');
        }

        if (!TwilioPhoneNumber) {
            throw new BadDataException('TwilioPhoneNumber is not configured');
        }
    }
}