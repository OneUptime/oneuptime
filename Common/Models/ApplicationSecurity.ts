import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        name!: string;
 
 @Column()
        slug!: string;
 
 @Column()
        gitRepositoryurl!: URL;
 
 @Column()
        gitCredential!: {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'GitCredential';
 
 @Column()
            index!: true;
        };
 
 @Column()
        componentId!: {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'Component';
 
 @Column()
            index!: true;
        };
 
 @Column()
        resourceCategory!: {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'ResourceCategory';
 
 @Column()
            index!: true;
        };
        
 

 
 @Column()
        lastScan!: Date;
 
 @Column()
        scanned!: boolean;
 
 @Column()
        scanning!: boolean;
    };
 
 //Automatically adds createdAt and updatedAt to the schema
}








