import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
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
