import { Column, Entity } from 'typeorm';
import Role from '../Types/Role';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import SSO from './SsoConfig';

@Entity({
    name: 'User',
})
export default class User extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column({ type: 'text', length: 100 })
    public name!: string;

    @Column({ type: 'text', length: 200, unique: true })
    public email!: string;

    @Column({ type: 'text', length: 200 })
    public temporaryEmail!: string;

    @Column({ type: 'text', length: 200 })
    public password!: string;

    @Column({ type: 'boolean' })
    public isEmailVerified!: boolean;

    @Column()
    public sso!: SSO;

    @Column({ type: 'text', length: 200 })
    public companyName!: string;

    @Column({ type: 'text', length: 100 })
    public companyRole!: string;

    @Column({ type: 'text', length: 100 })
    public companySize!: string;

    @Column({ type: 'text', length: 100 })
    public referral!: string;

    @Column({ type: 'text', length: 200 })
    public companyPhoneNumber!: string;

    @Column({ type: 'text', length: 200 })
    public profilePic!: string;

    @Column()
    public twoFactorAuthEnabled!: boolean;

    @Column()
    public twoFactorSecretCode!: string;

    @Column()
    public otpAuthUrl!: URL;

    @Column()
    public backupCodes!: Array<string>;

    @Column()
    public jwtRefreshToken!: string;

    @Column()
    public stripeCustomer!: string;

    @Column()
    public resetPasswordToken!: string;

    @Column()
    public resetPasswordExpires!: string;

    @Column()
    public timezone!: string;

    @Column()
    public lastActive!: Date;

    @Column()
    public coupon!: string;

    @Column()
    public disabled!: boolean;

    @Column()
    public paymentFailedDate!: Date;

    @Column()
    public role!: Role;

    @Column()
    public isBlocked!: boolean;

    @Column()
    public deletedByUser!: User;

    @Column()
    public alertPhoneNumber!: string;

    @Column()
    public alertPhoneVerificationCode!: string;

    @Column()
    public alertPhoneVerificationCodeRequestTime!: Date;

    @Column()
    public tempAlertPhoneNumber!: string;

    @Column()
    public createdBy!: User;
}
