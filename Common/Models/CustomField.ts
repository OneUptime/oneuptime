import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        fieldName!: string;
 
 @Column()
        fieldType: { type: string, enum!: ['text', 'number'] };
 
 @Column()
        project: Project;
 
 @Column()
        uniqueField!: boolean;
        
 

    };
 

}








