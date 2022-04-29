import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Incident from './Incident';
import SubscriberAlert from './SubscriberAlert';
import Monitor from './Monitor';
import UserAlert from './UserAlert';
import Project from './Project';

@Entity({
    name: 'AlertCharge',
})
export default class Model extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    chargeAmount!: number;

    @Column()
    closingAccountBalance!: number;

    @Column()
    userAlert!: UserAlert;

    @Column()
    subscriberAlert!: SubscriberAlert;

    @Column()
    monitor!: Monitor;

    @Column()
    incident!: Incident;

    @Column()
    sentTo!: string;
}
