import type ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';

export default class AccessControlModel extends BaseModel {
    public constructor(id?: ObjectID) {
        super(id);
    }

    public override isAccessControlModel(): boolean {
        return true;
    }
}
