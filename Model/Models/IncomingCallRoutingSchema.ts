import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public incomingCallRouting?: IncomingCallRouting;
    @Column()
    public onCallDutySchedule?: OnCallDutySchedule;

    @Column()
    public introText?: string = undefined;

    @Column()
    public introAudio?: string = undefined;

    @Column()
    public introAudioName?: string = undefined;
}
