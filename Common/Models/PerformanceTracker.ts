import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
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
        name!: string;
 
 @Column()
        slug!: string;
 
 @Column()
        key!: string;
 
 @Column()
        showQuickStart!: boolean;
 
 @Column()
        createdByUser!: User;
        
 
 
 
 @Column()
        deletedByUser!: User;
    };
 

}








