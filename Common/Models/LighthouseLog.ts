import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import Monitor from './Monitor';

@Entity({
    name: 'LighthouseLog',
})
export default class LighthouseLog extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
