import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
@Entity({
    name: 'LoginHistory',
})
export default class LoginHistory extends BaseModel {
    @Column()
    public user!: User;

    @Column()
    public ipLocationCity!: string;

    @Column()
    public ipLocationNeighbourhood!: string;

    @Column()
    public ipLocationCountry!: string;

    @Column()
    public browserName!: string;

    @Column()
    public browserVersion!: string;

    @Column()
    public deviceName!: string;

    @Column()
    public loginStatus!: string;
}
