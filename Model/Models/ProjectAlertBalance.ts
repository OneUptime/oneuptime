import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

@Entity({
    name: 'ProjectAlertBalance',
})
export default class ProjectAlertBalance extends BaseModel {
    @Column({ nullable: false })
    public minimumBalance?: number;

    @Column({ type: 'varchar', nullable: false })
    public rechargeToBalance?: number;

    @Column({ nullable: false })
    public sendAlertsToUS?: boolean = undefined;

    @Column({ nullable: false })
    public sendAlertsToNonUS?: boolean = undefined;

    @Column({ nullable: false })
    public sendAlertsToHighRisk?: boolean = undefined;
}
