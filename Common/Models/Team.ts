import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import Route from '../Types/API/Route';

@CrudApiEndpoint(new Route('/team'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'Team',
})
export default class Team extends BaseModel {
    @Column()
    @Index()
    public project?: Project;

    @Column()
    public name?: string = undefined;

    @Column()
    public createdByUser?: User;

    @Column()
    public deletedByUser?: User;
}
