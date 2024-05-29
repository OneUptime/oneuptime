import UserService, {
    Service as UserServiceType,
} from '../Services/UserService';
import BaseAPI from './BaseAPI';
import User from 'Model/Models/User';

export default class UserAPI extends BaseAPI<User, UserServiceType> {
    public constructor() {
        super(User, UserService);
    }
}
