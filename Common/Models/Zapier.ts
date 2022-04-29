import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import Project from './Project';

@Entity({
    name: 'Zapier',
})
export default class Zapier extends BaseModel {
    @Column()
    project!: Project;

    @Column()
    url!: URL;

    @Column()
    type!: string;

    @Column()
    monitors!: [String];
}
