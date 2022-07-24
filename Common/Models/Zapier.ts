import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Project from './Project';

@Entity({
    name: 'Zapier',
})
export default class Zapier extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public url?: URL;

    @Column()
    public type?: string = undefined;

    @Column()
    public monitors?: [string];
}
