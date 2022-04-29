import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import SmsTemplateType from '../Types/SMS/SmsTemplateType';

@Entity({
    name: 'SmsTemplate',
})
export default class SmsTemplate extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    content!: string;

    @Column()
    smsType!: SmsTemplateType;

    @Column({
        array: true,
        type: 'text',
    })
    allowedVariables!: Array<string>;

    @Column()
    deletedByUser!: User;
}
