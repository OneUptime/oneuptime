import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
