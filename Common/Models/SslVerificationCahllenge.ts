import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';


@Entity({
    name: 'SslVerificationChallenge',
})
export default class SslVerificationChallenge extends BaseModel {
    
    @Column()
    public token!: string;

    @Column()
    public keyAuthorization!: string;

    @Column()
    public challengeUrl!: string;
}
