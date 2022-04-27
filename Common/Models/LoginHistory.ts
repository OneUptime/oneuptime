import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    user!: {
 
 @Column()
        type!: string;
 
 @Column()
        ref!: 'User';
    };
 
 @Column()
    createdAt!: {
 
 @Column()
        type!: Date;
 
 @Column()
        default!: Date.now(}
    };
 
 @Column()
    ipLocation!: {
 
 @Column()
        type!: Object;
    };
 
 @Column()
    device!: {
 
 @Column()
        type!: Object;
    };
 
 @Column()
    status!: string;
}








