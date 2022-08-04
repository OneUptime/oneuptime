import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import AutomatedScriptRunInstance from './AutomatedScriptRunInstance';

@Entity({
    name: 'ApplicationSecurityRunInstanceLog',
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {
    @Column()
    public automatedScriptRunInstance?: AutomatedScriptRunInstance;

    @Column()
    public log?: string = undefined;
}
