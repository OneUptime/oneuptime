import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'GlobalConfig',
})
export default class GlobalConfig extends BaseModel {
    @Column()
    public name!: string;

    @Column()
    public value!: Object;

    @Column()
    public iv!: Buffer;
}
