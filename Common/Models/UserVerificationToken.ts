import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';


@Entity({
       name: "UserVerificationToken"
})
export default class UserVerificationToken extends BaseModel {

       @Column({nullable: false})
       user!: User

       @Index()
       @Column({nullable: false})
       token!: string

       @Column({nullable: false})
       expires!: Date
}








