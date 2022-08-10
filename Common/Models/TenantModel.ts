import ObjectID from '../Types/ObjectID';
import BaseModel from './BaseModel';

export default class TenantModel extends BaseModel {
    public constructor(id?: ObjectID) {
        super(id);
    }
}
