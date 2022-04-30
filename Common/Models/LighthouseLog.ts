import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'LighthouseLog',
})
export default class LighthouseLog extends BaseModel {
    @Column()
    public monitor!: Monitor;

    @Column()
    public data!: Object;

    @Column()
    public url!: URL;

    @Column()
    public performance!: Number;

    @Column()
    public accessibility!: Number;

    @Column()
    public bestPractices!: Number;

    @Column()
    public seo!: Number;

    @Column()
    public pwa!: Number;

    @Column()
    public scanning!: Boolean;
}
