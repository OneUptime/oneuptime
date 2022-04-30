import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import OperationResult from '../Types/Operation/OperationResult';
import AutomatedScript from './AutomatedScript';

@Entity({
    name: 'AutomatedScriptOnEvent',
})
export default class AutomatedScriptOnEvent extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public automatedScript!: AutomatedScript;
    @Column()
    public executeAutomatedScript!: AutomatedScript;
    @Column()
    public eventType!: OperationResult;
}
