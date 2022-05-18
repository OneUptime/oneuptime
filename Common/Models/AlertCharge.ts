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
    public project?: Project;

    @Column()
    public chargeAmount?: number;

    @Column()
    public closingAccountBalance?: number;

    @Column()
    public userAlert?: UserAlert;

    @Column()
    public subscriberAlert?: SubscriberAlert;

    @Column()
    public monitor?: Monitor;

    @Column()
    public incident?: Incident;

    @Column()
    public sentTo? : string = undefined;
}
