import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import OperationResult from 'Common/Types/Operation/OperationResult';
import AutomatedScript from './AutomatedScript';

@Entity({
    name: 'AutomatedScriptOnEvent',
})
export default class AutomatedScriptOnEvent extends BaseModel {
    @Column()
    public automatedScript?: AutomatedScript;
    @Column()
    public executeAutomatedScript?: AutomatedScript;
    @Column()
    public eventType?: OperationResult;
}
