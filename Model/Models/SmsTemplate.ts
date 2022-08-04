import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
import SmsTemplateType from 'Common/Types/SMS/SmsTemplateType';

@Entity({
    name: 'SmsTemplate',
})
export default class SmsTemplate extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public content?: string = undefined;

    @Column()
    public smsType?: SmsTemplateType;

    @Column({
        array: true,
        type: 'varchar',
    })
    public allowedVariables?: Array<string>;

    @Column()
    public deletedByUser?: User;
}
