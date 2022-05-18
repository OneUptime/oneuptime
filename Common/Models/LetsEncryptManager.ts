import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public store?: Object;

    @Column()
    public challenges?: Object;

    @Column()
    public renewOffset? : string = undefined;

    @Column()
    public renewStagger? : string = undefined;

    @Column()
    public accountKeyType? : string = undefined;

    @Column()
    public serverKeyType? : string = undefined;

    @Column()
    public subscriberEmail? : string = undefined;

    @Column()
    public agreeToTerms?: boolean = undefined;
}
