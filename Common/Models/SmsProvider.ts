import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: Project; //Which project does this belong to.

 
 @Column()
    enabled!: boolean;

 
 @Column()
    iv!: Buffer;

    ;

    



 
 @Column()
    provider!: {
 
 @Column()
        type!: string;
 
 @Column()
        enum!: ['twilio'];
 
 @Column()
        required!: true;
    };

 
 @Column()
    providerCredentials!: {
 
 @Column()
        twilio!: {
 
 @Column()
            accountSid!: string;
 
 @Column()
            authToken!: string;
 
 @Column()
            phoneNumber!: string;
        };
    };

 
 @Column()
    deletedByUser!: User;
}




 
 @Column()
export const encryptedFields!: EncryptedFields = [
    'providerCredentials.twilio.accountSid';
    'providerCredentials.twilio.authToken';
];




