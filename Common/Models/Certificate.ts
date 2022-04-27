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
        cert!: Schema.Types.Mixed;
 
 @Column()
        chain!: Schema.Types.Mixed;
 
 @Column()
        privKey!: Schema.Types.Mixed;
 
 @Column()
        subject!: Schema.Types.Mixed;
 
 @Column()
        altnames!: Schema.Types.Mixed;
 
 @Column()
        issuedAt!: Schema.Types.Mixed;
 
 @Column()
        expiresAt!: Schema.Types.Mixed;
        
 

    };
 

}









