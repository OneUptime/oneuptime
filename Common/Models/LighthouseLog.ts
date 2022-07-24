import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import Monitor from './Monitor';

@Entity({
    name: 'LighthouseLog',
})
export default class LighthouseLog extends BaseModel {
    @Column()
    public monitor?: Monitor;

    @Column()
    public data?: Object;

    @Column()
    public url?: URL;

    @Column()
    public performance?: number;

    @Column()
    public accessibility?: number;

    @Column()
    public bestPractices?: number;

    @Column()
    public seo?: number;

    @Column()
    public pwa?: number;

    @Column()
    public scanning?: boolean = undefined;
}
