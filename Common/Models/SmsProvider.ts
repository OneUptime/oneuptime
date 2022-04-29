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
    project!: Project;

    @Column()
    enabled!: boolean;

    @Column()
    provider!: SMSProviderType;

    @Column()
    credentials!: JSONObject;

    @Column()
    deletedByUser!: User;

    @Column()
    createdByUser!: User;
}
