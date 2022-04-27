import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        subject!: string;
 
 @Column()
        altnames!: Array;
 
 @Column()
        renewAt: { type: Number, default!: 1 };
 
 @Column()
        expiresAt: { type!: Number };
 
 @Column()
        issuedAt: { type!: Number };
        
 
 @Column()
        deletedAt: { type!: Number };
    };
 

}









