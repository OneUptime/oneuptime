import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import StatusPage from './StatusPage';
import DomainVerificationToken from './DomainVerificationToken';

@Entity({
    name: 'StatusPageDomains',
})
export default class StatusPageDomains extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public statusPage!: StatusPage;

    @Column()
    public domain!: string;

    @Column()
    public certificate!: User;

    @Column()
    public privateKey!: User;

    @Column()
    public autoProvisioning!: boolean;

    @Column()
    public domainVerificationToken!: DomainVerificationToken;
}
