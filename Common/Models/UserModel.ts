import type ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';

export default class UserModel extends BaseModel {
    public constructor(id?: ObjectID) {
        super(id);
    }

    public override isUserModel(): boolean {
        return true;
    }
}
