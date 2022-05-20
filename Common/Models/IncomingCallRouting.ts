import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public deletedByUser?: User;

    @Column()
    public phoneNumber?: string = undefined;

    @Column()
    public locality?: string = undefined;

    @Column()
    public region?: string = undefined;

    @Column()
    public mmsCapabilities?: boolean = undefined;

    @Column()
    public smsCapabilities?: boolean = undefined;

    @Column()
    public voiceCapabilities?: boolean = undefined;

    @Column()
    public sid?: string = undefined;

    @Column()
    public price?: string = undefined;

    @Column()
    public priceUnit?: string = undefined;

    @Column()
    public countryCode?: string = undefined;

    @Column()
    public numberType?: string = undefined;

    @Column()
    public stripeSubscriptionId?: string = undefined;
}
