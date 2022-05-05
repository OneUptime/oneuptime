import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import OperationResult from '../Types/Operation/OperationResult';
import AutomatedScript from './AutomatedScript';

@Entity({
    name: 'AutomatedScriptOnEvent',
})
export default class AutomatedScriptOnEvent extends BaseModel {
    @Column()
    public automatedScript!: AutomatedScript;
    @Column()
    public executeAutomatedScript!: AutomatedScript;
    @Column()
    public eventType!: OperationResult;
}
