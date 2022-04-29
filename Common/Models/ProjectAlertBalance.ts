import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'ProjectAlertBalance',
})
export default class ProjectAlertBalance extends BaseModel {
    @Column({ nullable: false })
    minimumBalance!: number;

    @Column({ type: 'text', nullable: false })
    rechargeToBalance!: number;

    @Column({ nullable: false })
    sendAlertsToUS!: boolean;

    @Column({ nullable: false })
    sendAlertsToNonUS!: boolean;

    @Column({ nullable: false })
    sendAlertsToHighRisk!: boolean;
}
