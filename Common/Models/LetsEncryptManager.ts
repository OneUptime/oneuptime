import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';


@Entity({
       name: "UserAlerts"
})
export default class Model extends BaseModel {

       @Column()
       store!: Object

       @Column()
       challenges!: Object

       @Column()
       renewOffset!: string;

       @Column()
       renewStagger!: string;

       @Column()
       accountKeyType!: string;

       @Column()
       serverKeyType!: string;

       @Column()
       subscriberEmail!: string;

       @Column()
       agreeToTerms!: boolean;
}









