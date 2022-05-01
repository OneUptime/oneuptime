import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import ApplicationLogContainer from './ApplicationLogContainer';
import ApplicationLogType from '../Types/ApplicationLog/ApplicationLogType';
import Tags from '../Types/Tags';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    
    @Column()
    public applicationLogContainer!: ApplicationLogContainer;

    @Column()
    public content!: string;

    @Column()
    public type!: ApplicationLogType;

    @Column()
    public tags!: Tags;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;
}
