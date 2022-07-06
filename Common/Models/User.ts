import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import ColumnType from '../Types/Database/ColumnType';
import ColumnLength from '../Types/Database/ColumnLength';
import SlugifyColumn from '../Types/Database/SlugifyColumn';
import Phone from '../Types/Phone';
import Email from '../Types/Email';
import Name from '../Types/Name';
import URL from '../Types/API/URL';
import Timezone from '../Types/Timezone';
import CompanySize from '../Types/Company/CompanySize';
import JobRole from '../Types/Company/JobRole';
import HashedString from '../Types/HashedString';
import PublicRecordPermissions from '../Types/Database/AccessControls/Public/PublicRecordPermissions';
import TableColumn from '../Types/Database/TableColumn';
import PublicColumnPermissions from '../Types/Database/AccessControls/Public/PublicColumnPermissions';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';

@CrudApiEndpoint(new Route('/user'))
@PublicRecordPermissions({
    create: true,
    readAsList: false,
    readAsItem: false,
    update: false,
    delete: false,
})
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'User',
})
class User extends BaseModel {
    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.Name })
    @Column({
        type: ColumnType.Name,
        length: ColumnLength.Name,
        nullable: true,
        unique: false,
    })
    public name?: Name = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({
        title: 'Email',
        required: true,
        unique: true,
        type: TableColumnType.Email,
    })
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        unique: true,
        nullable: false,
        transformer: Email.getDatabaseTransformer()
    })
    public email?: Email = undefined;

    @TableColumn({ type: TableColumnType.Email })
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        unique: false,
        nullable: true,
        transformer: Email.getDatabaseTransformer()
    })
    public newUnverifiedTemporaryEmail?: string = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({
        title: 'Password',
        hashed: true,
        type: TableColumnType.HashedString,
    })
    @Column({
        type: ColumnType.HashedString,
        length: ColumnLength.HashedString,
        unique: false,
        nullable: true,
        transformer: HashedString.getDatabaseTransformer(),
    })
    public password?: HashedString = undefined;

    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isEmailVerified?: boolean = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public companyName?: string = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jobRole?: JobRole = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public companySize?: CompanySize = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public referral?: string = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.Phone })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
        transformer: Phone.getDatabaseTransformer(),
    })
    public companyPhoneNumber?: Phone = undefined;

    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public profilePicImageUrl?: URL = undefined;

    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        default: false,
        nullable: false,
        unique: false,
    })
    public twoFactorAuthEnabled?: boolean = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public twoFactorSecretCode?: string = undefined;

    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public twoFactorAuthUrl?: URL;

    @TableColumn({ type: TableColumnType.Array })
    @Column({
        type: ColumnType.Array,
        nullable: true,
        unique: false,
    })
    public backupCodes?: Array<string> = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jwtRefreshToken?: string = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderCustomerId?: string = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public resetPasswordToken?: string = undefined;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public resetPasswordExpires?: Date = undefined;

    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public timezone?: Timezone = undefined;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public lastActive?: Date = undefined;

    @PublicColumnPermissions({
        create: true,
        readAsList: false,
        readAsItem: false,
        update: false,
        delete: false,
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public promotionName?: string = undefined;

    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isDisabled?: boolean = undefined;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate?: Date = undefined;

    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isMasterAdmin?: boolean = undefined;

    @TableColumn({
        isDefaultValueColumn: true,
        required: true,
        type: TableColumnType.Boolean,
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: false,
        unique: false,
        default: false,
    })
    public isBlocked?: boolean = undefined;

    @TableColumn({ type: TableColumnType.Phone })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public alertPhoneNumber?: Phone = undefined;

    @TableColumn({ type: TableColumnType.OTP })
    @Column({
        type: ColumnType.OTP,
        length: ColumnLength.OTP,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCode?: string = undefined;

    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCodeRequestTime?: Date = undefined;

    @TableColumn({ type: TableColumnType.Phone })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public tempAlertPhoneNumber?: Phone = undefined;

    /*
     * @Column()
     * public sso?: SSO;
     */

    /*
     * @Column({
     *     nullable: true,
     * })
     * public createdBy?: User;
     */

    /*
     * @Column()
     * public isBlockedByUser?: User;
     */

    /*
     * @Column()
     * public deletedByUser?: User;
     */
}

export default User;
