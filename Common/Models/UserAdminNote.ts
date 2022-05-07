import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';

@Entity({
    name: 'UserAdminNote',
})
export default class UserAdminNotes extends BaseModel {
    @Column({ nullable: false })
    public forUser!: User;

    @Column({ type: 'varchar', nullable: false })
    public note!: string;

    @Column({ nullable: false })
    public postedByUser!: User;
}
