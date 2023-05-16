import User from 'Model/Models/User';
import UserService, {
    Service as UserServiceType,
} from '../Services/UserService';
import BaseAPI from './BaseAPI';

export default class UserAPI extends BaseAPI<User, UserServiceType> {
    public constructor() {
        super(User, UserService);
    }
    

    
}
