import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

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
    public performance?: Number;

    @Column()
    public accessibility?: Number;

    @Column()
    public bestPractices?: Number;

    @Column()
    public seo?: Number;

    @Column()
    public pwa?: Number;

    @Column()
    public scanning?: boolean = undefined;
}
