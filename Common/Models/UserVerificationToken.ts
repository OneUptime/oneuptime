import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';

@Entity({
    name: 'UserVerificationToken',
})
export default class UserVerificationToken extends BaseModel {
    
    @Column({ nullable: false })
    public user!: User;

    @Index()
    @Column({ nullable: false })
    public token!: string;

    @Column({ nullable: false })
    public expires!: Date;
}
