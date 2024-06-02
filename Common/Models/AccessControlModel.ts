import ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';

export default class AccessControlModel extends BaseModel {
    // Please override this property in the child class
    public name?: string = undefined;

    public constructor(id?: ObjectID) {
        super(id);
    }

    public override isAccessControlModel(): boolean {
        return true;
    }
}
