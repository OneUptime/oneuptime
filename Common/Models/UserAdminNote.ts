import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';

@Entity({
    name: "UserAdminNote"
})
export default class UserAdminNotes extends BaseModel { 
    @Column({ nullable: false })
    forUser!: User;
    
    @Column({ type: "text", nullable: false })
    note!: string

    @Column({ nullable: false })
    postedByUser!: User
}