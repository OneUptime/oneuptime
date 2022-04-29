import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import StatusPage from './StatusPage';

@Entity({
       name: "UserAlerts"
})
export default class Model extends BaseModel {

       @Column()
       statusPage!: StatusPage

       @Column()
       name!: string;

       @Column()
       createdByUser!: User
       
       @Column()
       deletedByUser!: User

}








