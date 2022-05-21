import { Column, Entity } from 'typeorm';
import { JSONObject } from '../Types/JSON';
import BaseModel from './BaseModel';

@Entity({
    name: 'GlobalConfig',
})
export default class GlobalConfig extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public value?: JSONObject;

    @Column()
    public iv?: Buffer;
}
