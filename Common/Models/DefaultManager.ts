import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
        store!: {
 
 @Column()
            type!: Object;
 
 @Column()
            default!: {
 
 @Column()
                module!: 'oneuptime-le-store';
            };
        };
 
 @Column()
        challenges!: {
 
 @Column()
            'http-01'!: {
 
 @Column()
                type!: Object;
 
 @Column()
                default!: {
 
 @Column()
                    module!: 'oneuptime-acme-http-01';
                };
            };
        };
 
 @Column()
        renewOffset: { type: string, default!: '-45d' };
 
 @Column()
        renewStagger: { type: string, default!: '3d' };
 
 @Column()
        accountKeyType!: string;
 
 @Column()
        serverKeyType!: string;
 
 @Column()
        subscriberEmail!: string;
 
 @Column()
        agreeToTerms!: boolean;
        
 

    };
 

}









