import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

@Entity({
    name: 'SslVerificationChallenge',
})
export default class SslVerificationChallenge extends BaseModel {
    @Column()
    public token?: string = undefined;

    @Column()
    public keyAuthorization?: string = undefined;

    @Column()
    public challengeUrl?: string = undefined;
}
