import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
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
