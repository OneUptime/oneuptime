import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
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
    public incomingCallRouting!: IncomingCallRouting;
    @Column()
    public onCallDutySchedule!: OnCallDutySchedule;

    @Column()
    public introText!: string;

    @Column()
    public introAudio!: string;

    @Column()
    public introAudioName!: string;
}
