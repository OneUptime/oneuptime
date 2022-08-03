import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';

@Entity({
    name: 'UserAlerts',
})
export default class NotificationUserStatus extends BaseModel {
    @Column()
    public notification?: Notification;

    @Column()
    public user?: User;

    @Column()
    public read?: boolean = undefined;
}
