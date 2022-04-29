import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';


@Entity({
       name: "ExternalStatusPage"
})
export default class ExternalStatusPage extends BaseModel {

       @Column()
       name!: string;

       @Column()
       url!: URL;

       @Column()
       description!: string;

       @Column()
       statusPage!: StatusPage
       @Column()
       project!: Project

       @Column()
       deletedByUser!: User

       @Column()
       createdByUser!: User
};











