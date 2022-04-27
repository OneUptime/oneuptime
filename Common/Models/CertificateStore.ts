import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        id!: Schema.Types.Mixed;
 
 @Column()
        privateKeyPem!: Schema.Types.Mixed;
 
 @Column()
        privateKeyJwk!: Schema.Types.Mixed;
 
 @Column()
        publicKeyPem!: Schema.Types.Mixed;
 
 @Column()
        publicKeyJwk!: Schema.Types.Mixed;
 
 @Column()
        key!: Schema.Types.Mixed;
        
 

    };
 

}









