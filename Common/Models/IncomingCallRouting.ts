import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';
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
    public deletedByUser!: User;

    @Column()
    public phoneNumber!: string;

    @Column()
    public locality!: string;

    @Column()
    public region!: string;

    @Column()
    public mmsCapabilities!: boolean;

    @Column()
    public smsCapabilities!: boolean;

    @Column()
    public voiceCapabilities!: boolean;

    @Column()
    public sid!: string;

    @Column()
    public price!: string;

    @Column()
    public priceUnit!: string;

    @Column()
    public countryCode!: string;

    @Column()
    public numberType!: string;

    @Column()
    public stripeSubscriptionId!: string;
}
