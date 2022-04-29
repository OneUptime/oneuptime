import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';


@Entity({
    name: "UserAlerts"
})
export default class NotificationUserStatus extends BaseModel{
 
 @Column()
    notification!: Notification;
 
 @Column()
    user!: User;

 @Column()
    read!: boolean
}









