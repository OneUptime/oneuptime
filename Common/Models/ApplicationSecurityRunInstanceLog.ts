import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import ApplicationSecurityRunInstance from './ApplicationSecurityRunInstance';
import SecuritySeverity from '../Types/SecuritySeverity';

@Entity({
    name: 'ApplicationSecurityRunInstanceLog',
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {
    
    @Column()
    public applicationSeurityRunInstance!: ApplicationSecurityRunInstance;

    @Column()
    public severity!: SecuritySeverity;

    @Column()
    public log!: string;
}
