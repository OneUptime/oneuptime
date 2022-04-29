import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import ApplicationSecurityRunInstance from './ApplicationSecurityRunInstance';
import SecuritySeverity from '../Types/SecuritySeverity';

@Entity({
    name: "ApplicationSecurityRunInstanceLog"
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {

    @Column()
    applicationSeurityRunInstance!: ApplicationSecurityRunInstance

    @Column()
    severity!: SecuritySeverity

    @Column()
    log!: string
}