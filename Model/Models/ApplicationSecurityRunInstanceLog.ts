import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import ApplicationSecurityRunInstance from './ApplicationSecurityRunInstance';
import SecuritySeverity from 'Common/Types/SecuritySeverity';

@Entity({
    name: 'ApplicationSecurityRunInstanceLog',
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {
    @Column()
    public applicationSeurityRunInstance?: ApplicationSecurityRunInstance;

    @Column()
    public severity?: SecuritySeverity;

    @Column()
    public log?: string = undefined;
}
