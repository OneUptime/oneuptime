import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        statusPageId!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'StatusPage';
 
 @Column()
            index!: true;
        };
 
 @Column()
        name!: string;
 
 @Column()
        createdByUser!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'User';
 
 @Column()
            index!: true;
        };
        
 
 
 
 @Column()
        deletedByUser!: {
 
 @Column()
            type!: string;
 
 @Column()
            ref!: 'User';
 
 @Column()
            index!: true;
        };
    };
 

}








