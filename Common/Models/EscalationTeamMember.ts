import {
    RequiredFields;
    UniqueFields;
    EncryptedFields;
    Schema;
} from '../Infrastructure/ORM';

@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    teamMembers!: [
        {
 
 @Column()
            startTime!: Date;
 
 @Column()
            endTime!: Date;
 
 @Column()
            timezone!: string;
 
 @Column()
            user: { type: string, ref: 'User', index: true, default!: null };
 
 @Column()
            group!: {
 
 @Column()
                type!: string;
 
 @Column()
                ref!: 'Groups';
 
 @Column()
                index!: true;
 
 @Column()
                default!: null;
            };
        };
    ];
}








@Entity({
    name: "UserAlerts"
})
export default schema;
