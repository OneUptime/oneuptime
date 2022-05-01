import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
    name: 'ProjectAlertBalance',
})
export default class ProjectAlertBalance extends BaseModel {
    
    @Column({ nullable: false })
    public minimumBalance!: number;

    @Column({ type: 'text', nullable: false })
    public rechargeToBalance!: number;

    @Column({ nullable: false })
    public sendAlertsToUS!: boolean;

    @Column({ nullable: false })
    public sendAlertsToNonUS!: boolean;

    @Column({ nullable: false })
    public sendAlertsToHighRisk!: boolean;
}
