import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import StatusPage from './StatusPage';
import DomainVerificationToken from './DomainVerificationToken';

@Entity({
    name: "StatusPageDomains"
})
export default class StatusPageDomains extends BaseModel {

    @Column()
    statusPage!: StatusPage;

    @Column()
    domain!: string;

    @Column()
    certificate!: User;

    @Column()
    privateKey!: User;

    @Column()
    autoProvisioning!: boolean;

    @Column()
    domainVerificationToken!: DomainVerificationToken;
}








