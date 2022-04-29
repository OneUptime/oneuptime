import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'LighthouseLog',
})
export default class LighthouseLog extends BaseModel {
    @Column()
    monitor!: Monitor;

    @Column()
    data!: Object;

    @Column()
    url!: URL;

    @Column()
    performance!: Number;

    @Column()
    accessibility!: Number;

    @Column()
    bestPractices!: Number;

    @Column()
    seo!: Number;

    @Column()
    pwa!: Number;

    @Column()
    scanning!: Boolean;
}
