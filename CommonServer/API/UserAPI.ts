import User from 'Common/Models/User';
import UserService from '../Services/UserService';
import BaseAPI from './BaseAPI';
import Service from '../Services/Index';

export default class UserAPI extends BaseAPI<User, UserService> {
    public constructor() {
        super(User, Service.UserService);
    }
}
