import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'SslVerificationChallenge',
})
export default class SslVerificationChallenge extends BaseModel {
    @Column()
    token!: string;

    @Column()
    keyAuthorization!: string;

    @Column()
    challengeUrl!: string;
}
