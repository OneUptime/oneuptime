import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import IncomingCallRouting from './IncomingCallRouting';
import OnCallDutySchedule from './OnCallDutySchedule';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel {

    @Column()
    incomingCallRouting!: IncomingCallRouting;
    @Column()
    onCallDutySchedule!: OnCallDutySchedule;

    @Column()
    introText!: string;

    @Column()
    introAudio!: string;

    @Column()
    introAudioName!: string;

}
