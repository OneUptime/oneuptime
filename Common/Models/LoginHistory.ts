import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
@Entity({
    name: 'LoginHistory',
})
export default class LoginHistory extends BaseModel {
    @Column()
    user!: User;

    @Column()
    ipLocationCity!: string;

    @Column()
    ipLocationNeighbourhood!: string;

    @Column()
    ipLocationCountry!: string;

    @Column()
    browserName!: string;

    @Column()
    browserVersion!: string;

    @Column()
    deviceName!: string;

    @Column()
    loginStatus!: string;
}
