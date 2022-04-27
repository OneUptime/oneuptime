import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        securityId!: {
 
 @Column()
            type!: Schema.Types.ObjectId;
 
 @Column()
            ref!: 'ApplicationSecurity';
 
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
        data!: Object;
        
 
 @Column()
        deleteAt!: Date;
    };
 

}









