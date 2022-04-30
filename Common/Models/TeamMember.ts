import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Team from './Team';
import User from './User';

@Entity({
    name: 'TeamMember',
})
export default class TeamMember extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    @Index()
    public team!: Team;

    @Column()
    public user!: User;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
