import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'GlobalConfig',
})
export default class GlobalConfig extends BaseModel {
    @Column()
    name!: string;

    @Column()
    value!: Object;

    @Column()
    iv!: Buffer;
}
