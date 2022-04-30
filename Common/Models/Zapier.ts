import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Project from './Project';

@Entity({
    name: 'Zapier',
})
export default class Zapier extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public project!: Project;

    @Column()
    public url!: URL;

    @Column()
    public type!: string;

    @Column()
    public monitors!: [String];
}
