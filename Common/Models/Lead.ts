import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'Lead',
})
export default class Lead extends BaseModel {
    @Column()
    public name!: string;

    @Column()
    public email!: string;

    @Column()
    public website!: string;

    @Column()
    public phone!: string;

    @Column()
    public nameOfInterestedResource!: string;

    @Column()
    public country!: string;

    @Column()
    public companySize!: string;

    @Column()
    public message!: string;

    @Column()
    public source!: string;
}
