import UserSMS from 'Model/Models/UserSMS';
import UserSMSService, {
    Service as UserSMSServiceType,
} from '../Services/UserSmsService';
import BaseAPI from './BaseAPI';

export default class UserSMSAPI extends BaseAPI<UserSMS, UserSMSServiceType> {
    public constructor() {
        super(UserSMS, UserSMSService);
    }
}
