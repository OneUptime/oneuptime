import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

@Entity({
    name: 'ProjectAlertBalance',
})
export default class ProjectAlertBalance extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
