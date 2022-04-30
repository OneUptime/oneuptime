import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import { JSONObject } from '../Types/JSON';

export enum SMSProviderType {
    Twilio = 'twilio',
}

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public project!: Project;

    @Column()
    public enabled!: boolean;

    @Column()
    public provider!: SMSProviderType;

    @Column()
    public credentials!: JSONObject;

    @Column()
    public deletedByUser!: User;

    @Column()
    public createdByUser!: User;
}
