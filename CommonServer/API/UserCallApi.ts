import UserCall from 'Model/Models/UserCall';
import UserCallService, {
    Service as UserCallServiceType,
} from '../Services/UserCallService';
import BaseAPI from './BaseAPI';

export default class UserCallAPI extends BaseAPI<
    UserCall,
    UserCallServiceType
> {
    public constructor() {
        super(UserCall, UserCallService);
    }
}
