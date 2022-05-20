import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'Lead',
})
export default class Lead extends BaseModel {
    @Column()
    public name?: string = undefined;

    @Column()
    public email?: string = undefined;

    @Column()
    public website?: string = undefined;

    @Column()
    public phone?: string = undefined;

    @Column()
    public nameOfInterestedResource?: string = undefined;

    @Column()
    public country?: string = undefined;

    @Column()
    public companySize?: string = undefined;

    @Column()
    public message?: string = undefined;

    @Column()
    public source?: string = undefined;
}
