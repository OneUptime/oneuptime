import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
import StatusPage from './StatusPage';


@Entity({
       name: "Announcement"
})
export default class Announcement extends BaseModel {

       @Column()
       statusPage!: StatusPage

       @Column()
       project!: Project

       @Column()
       slug!: string;

       @Column()
       hideAnnouncement!: boolean;

       @Column()
       deletedByUser!: User

       @Column()
       createdByUser!: User

       @Column()
       name!: string;

       @Column()
       description!: string;

       @Column()
       resolved!: boolean;
}










