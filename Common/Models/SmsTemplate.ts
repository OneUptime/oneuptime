import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
import SmsTemplateType from '../Types/SMS/SmsTemplateType';

@Entity({
    name: 'SmsTemplate',
})
export default class SmsTemplate extends BaseModel {
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
