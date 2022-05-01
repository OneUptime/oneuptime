import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';

@Entity({
    name: 'DomainVerificationToken',
})
export default class Model extends BaseModel {
    
    @Index()
    @Column()
    public domain!: string; // The main or base domain eg oneuptime.com

    @Column()
    public verificationToken!: string;

    @Column()
    public verified!: boolean;

    @Column()
    public verifiedAt!: Date;

    @Column()
    public project!: Project;
}
