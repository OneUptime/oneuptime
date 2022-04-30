import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';

@Entity({
    name: 'Lead',
})
export default class Lead extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
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
