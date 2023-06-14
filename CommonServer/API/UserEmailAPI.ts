import UserEmail from 'Model/Models/UserEmail';
import UserEmailService, {
    Service as UserEmailServiceType,
} from '../Services/UserEmailService';
import BaseAPI from './BaseAPI';

export default class UserEmailAPI extends BaseAPI<UserEmail, UserEmailServiceType> {
    public constructor() {
        super(UserEmail, UserEmailService);
    }
}
