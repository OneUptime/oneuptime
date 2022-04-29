import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import AutomatedScriptRunInstance from './AutomatedScriptRunInstance';

@Entity({
    name: "ApplicationSecurityRunInstanceLog"
})
export default class ApplicationSecurityRunInstanceLog extends BaseModel {

    @Column()
    automatedScriptRunInstance!: AutomatedScriptRunInstance

    @Column()
    log!: string
}