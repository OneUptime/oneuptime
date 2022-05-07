import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public store!: Object;

    @Column()
    public challenges!: Object;

    @Column()
    public renewOffset!: string;

    @Column()
    public renewStagger!: string;

    @Column()
    public accountKeyType!: string;

    @Column()
    public serverKeyType!: string;

    @Column()
    public subscriberEmail!: string;

    @Column()
    public agreeToTerms!: boolean;
}
