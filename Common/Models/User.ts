import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import ColumnType from '../Types/Database/ColumnType';
import ColumnLength from '../Types/Database/ColumnLength';
import RequiredColumn from '../Types/Database/RequiredColumn';
import UniqueColumn from '../Types/Database/UniqueColumn';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import Phone from '../Types/Phone';
import Email from '../Types/Email';
import Name from '../Types/Name';
import URL from '../Types/API/URL';
import Timezone from '../Types/Timezone';
import CompanySize from '../Types/Company/CompanySize';
import JobRole from '../Types/Company/JobRole';
import HashedColumn from '../Types/Database/HashedColumn';
import HashedString from '../Types/HashedString';
import PublicRecordPermissions from '../Types/Database/AccessControls/Public/PublicRecordPermissions';
import TableColumn from '../Types/Database/TableColumn';


@PublicRecordPermissions({
    create: true,
    readAsList: false,
    readAsItem: false,
    update: false,
    delete: false
})
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'User',
})
class User extends BaseModel {

    @TableColumn()
    @Column({
        type: ColumnType.Name,
        length: ColumnLength.Name,
        nullable: true,
        unique: false
    })
    public name!: Name;

    @TableColumn()
    @UniqueColumn()
    @RequiredColumn()
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        unique: true,
        nullable: false,
    })
    public email!: Email;

    @TableColumn()
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        unique: false,
        nullable: true,
    })
    public newUnverifiedTemporaryEmail?: string;

    @TableColumn()
    @HashedColumn()
    @Column({
        type: ColumnType.HashedString,
        length: ColumnLength.HashedString,
        unique: false,
        nullable: true,
    })
    public password?: HashedString;

    @TableColumn()
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isEmailVerified!: boolean;

    @TableColumn()
    @Column({
        type: ColumnType.Name,
        length: ColumnLength.Name,
        nullable: true,
        unique: false,
    })
    public companyName!: string;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jobRole!: JobRole;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public companySize!: CompanySize;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public referral?: string;


    @TableColumn()
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
        transformer: Phone.getDatabaseTransformer(),
    })
    public companyPhoneNumber!: Phone;


    @TableColumn()
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public profilePicImageUrl?: URL;

    @RequiredColumn()
    @TableColumn()
    @Column({
        type: ColumnType.Boolean,
        default: false,
        nullable: false,
        unique: false,
    })
    public twoFactorAuthEnabled!: boolean;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public twoFactorSecretCode?: string;


    @TableColumn()
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public twoFactorAuthUrl?: URL;


    @TableColumn()
    @Column({
        type: ColumnType.Array,
        nullable: true,
        unique: false,
    })
    public backupCodes?: Array<string>;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jwtRefreshToken?: string;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderCustomerId?: string;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public resetPasswordToken!: string;


    @TableColumn()
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public resetPasswordExpires?: Date;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public timezone?: Timezone;


    @TableColumn()
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public lastActive!: Date;


    @TableColumn()
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public promotionName!: string;

    @RequiredColumn()
    @TableColumn()
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isDisabled!: boolean;


    @TableColumn()
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate!: Date;

    @RequiredColumn()
    @TableColumn()
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isMasterAdmin!: boolean;

    @RequiredColumn()
    @TableColumn()
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isBlocked!: boolean;


    @TableColumn()
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public alertPhoneNumber?: Phone;


    @TableColumn()
    @Column({
        type: ColumnType.OTP,
        length: ColumnLength.OTP,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCode?: string;


    @TableColumn()
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCodeRequestTime?: Date;


    @TableColumn()
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public tempAlertPhoneNumber!: Phone;

    /*
     * @Column()
     * public sso!: SSO;
     */

    /*
     * @Column({
     *     nullable: true,
     * })
     * public createdBy!: User;
     */

    /*
     * @Column()
     * public isBlockedByUser!: User;
     */

    /*
     * @Column()
     * public deletedByUser!: User;
     */
}

export default User;
