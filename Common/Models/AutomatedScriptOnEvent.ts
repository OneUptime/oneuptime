import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import OperationResult from '../Types/Operation/OperationResult';
import AutomatedScript from './AutomatedScript';

@Entity({
    name: 'AutomatedScriptOnEvent',
})
export default class AutomatedScriptOnEvent extends BaseModel {
    @Column()
    automatedScript!: AutomatedScript;
    @Column()
    executeAutomatedScript!: AutomatedScript;
    @Column()
    eventType!: OperationResult;
}
