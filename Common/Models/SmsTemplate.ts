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
    public project!: Project;

    @Column()
    public content!: string;

    @Column()
    public smsType!: SmsTemplateType;

    @Column({
        array: true,
        type: 'text',
    })
    public allowedVariables!: Array<string>;

    @Column()
    public deletedByUser!: User;
}
