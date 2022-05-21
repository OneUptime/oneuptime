import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
@Entity({
    name: 'LoginHistory',
})
export default class LoginHistory extends BaseModel {
    @Column()
    public user?: User;

    @Column()
    public ipLocationCity?: string = undefined;

    @Column()
    public ipLocationNeighbourhood?: string = undefined;

    @Column()
    public ipLocationCountry?: string = undefined;

    @Column()
    public browserName?: string = undefined;

    @Column()
    public browserVersion?: string = undefined;

    @Column()
    public deviceName?: string = undefined;

    @Column()
    public loginStatus?: string = undefined;
}
