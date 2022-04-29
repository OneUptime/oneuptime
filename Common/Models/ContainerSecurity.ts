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
        dockerCredential!: {
 
 @Column()
            type!: Schema.Types.Object;
 
 @Column()
            ref!: 'DockerCredential';
 
 @Column()
            index!: true;
        };
 
 @Column()
        imagePath!: string;
 
 @Column()
        imageTags!: string;
 
 @Column()
        component!: Component
 
 @Column()
        resourceCategory!: {
 
 @Column()
            type!: Schema.Types.Object;
 
 @Column()
            ref!: 'ResourceCategory';
 
 @Column()
            index!: true;
        };
        
 
 @Column()
        deleteAt!: Date;
 
 @Column()
        lastScan!: Date;
 
 @Column()
        scanned!: boolean;
 
 @Column()
        scanning!: boolean;
    };
 
 //Automatically adds createdAt and updatedAt to the schema
}








