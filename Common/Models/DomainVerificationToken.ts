import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';

@Entity({
    name: 'DomainVerificationToken',
})
export default class Model extends BaseModel {
    @Index()
    @Column()
    public domain?: string = undefined; // The main or base domain eg oneuptime.com

    @Column()
    public verificationToken?: string = undefined;

    @Column()
    public verified?: boolean = undefined;

    @Column()
    public verifiedAt?: Date = undefined;

    @Column()
    public project?: Project;
}
