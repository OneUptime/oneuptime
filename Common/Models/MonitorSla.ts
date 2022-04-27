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
        project: { ref: 'Project', type: Schema.Types.ObjectId, index!: true };
 
 @Column()
        isDefault!: boolean;
 
 @Column()
        frequency: { type: string, default!: '30' }; // Measured in days
 
 @Column()
        monitorUptime!: string;
        
 

    };
 
 //Automatically adds createdAt and updatedAt to the collection
}








