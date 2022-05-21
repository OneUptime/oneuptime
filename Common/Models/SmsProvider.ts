import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

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
    @Column()
    public project?: Project;

    @Column()
    public enabled?: boolean = undefined;

    @Column()
    public provider?: SMSProviderType;

    @Column()
    public credentials?: JSONObject;

    @Column()
    public deletedByUser?: User;

    @Column()
    public createdByUser?: User;
}
