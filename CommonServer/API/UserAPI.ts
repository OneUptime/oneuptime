import User from 'Model/Models/User';
import type { Service as UserServiceType } from '../Services/UserService';
import UserService from '../Services/UserService';
import BaseAPI from './BaseAPI';

export default class UserAPI extends BaseAPI<User, UserServiceType> {
    public constructor() {
        super(User, UserService);
    }
}
