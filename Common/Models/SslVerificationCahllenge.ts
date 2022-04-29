import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
       name: "SslVerificationChallenge"
})
export default class SslVerificationChallenge extends BaseModel {    

       @Column()
       token!: string;

       @Column()
       keyAuthorization!: string;

       @Column()
       challengeUrl!: string;

};










