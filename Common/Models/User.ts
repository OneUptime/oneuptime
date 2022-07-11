import { Column, Entity, JoinTable, ManyToMany } from 'typeorm';
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
import TableColumn from '../Types/Database/TableColumn';
import CrudApiEndpoint from '../Types/Database/CrudApiEndpoint';
import Route from '../Types/API/Route';
import TableColumnType from '../Types/Database/TableColumnType';
import TableAccessControl from '../Types/Database/AccessControl/TableAccessControl';
import Permission from '../Types/Permission';
import ColumnAccessControl from '../Types/Database/AccessControl/ColumnAccessControl';
import Project from './Project';
import UserColumn from '../Types/Database/UserColumn';
import ProjectColumn from '../Types/Database/ProjectColumn';

@TableAccessControl({
    create: [Permission.Public],
    read: [Permission.CurrentUser, Permission.AnyMember],
    delete: [Permission.CurrentUser],
    update: [Permission.CurrentUser]
})
@CrudApiEndpoint(new Route('/user'))
@SlugifyColumn('name', 'slug')
@Entity({
    name: 'User',
})
@UserColumn("_id")
@ProjectColumn("projects")
class User extends BaseModel {

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.Name })
    @Column({
        type: ColumnType.Name,
        length: ColumnLength.Name,
        nullable: true,
        unique: false,
    })
    public name?: Name = undefined;

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
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
        transformer: Email.getDatabaseTransformer(),
    })
    public email?: Email = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.Email })
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        unique: false,
        nullable: true,
        transformer: Email.getDatabaseTransformer(),
    })
    public newUnverifiedTemporaryEmail?: string = undefined;


    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
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


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],

        update: []
    })
    @TableColumn({ isDefaultValueColumn: true, type: TableColumnType.Boolean })
    @Column({
        type: ColumnType.Boolean,
        default: false,
    })
    public isEmailVerified?: boolean = undefined;


    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public companyName?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jobRole?: JobRole = undefined;

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public companySize?: CompanySize = undefined;

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public referral?: string = undefined;

    @ColumnAccessControl({
        create: [Permission.Public],
        read: [Permission.CurrentUser],

        update: [Permission.CurrentUser]
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

    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public profilePicImageUrl?: URL = undefined;


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
    })
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


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public twoFactorSecretCode?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortURL })
    @Column({
        type: ColumnType.ShortURL,
        length: ColumnLength.ShortURL,
        nullable: true,
        unique: false,
        transformer: URL.getDatabaseTransformer(),
    })
    public twoFactorAuthUrl?: URL;


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser],

        update: []
    })
    @TableColumn({ type: TableColumnType.Array })
    @Column({
        type: ColumnType.Array,
        nullable: true,
        unique: false,
    })
    public backupCodes?: Array<string> = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public jwtRefreshToken?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public paymentProviderCustomerId?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public resetPasswordToken?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public resetPasswordExpires?: Date = undefined;


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public timezone?: Timezone = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public lastActive?: Date = undefined;


    @ColumnAccessControl({
        create: [Permission.Public],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.ShortText })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: false,
    })
    public promotionName?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [Permission.CustomerSupport],

        update: [Permission.CustomerSupport]
    })
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


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public paymentFailedDate?: Date = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
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


    @ColumnAccessControl({
        create: [],
        read: [Permission.CustomerSupport],

        update: [Permission.CustomerSupport]
    })
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


    @ColumnAccessControl({
        create: [],
        read: [Permission.CurrentUser, Permission.AnyMember],

        update: [Permission.CurrentUser]
    })
    @TableColumn({ type: TableColumnType.Phone })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public alertPhoneNumber?: Phone = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.OTP })
    @Column({
        type: ColumnType.OTP,
        length: ColumnLength.OTP,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCode?: string = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Date })
    @Column({
        type: ColumnType.Date,
        nullable: true,
        unique: false,
    })
    public alertPhoneVerificationCodeRequestTime?: Date = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Phone })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: false,
    })
    public tempAlertPhoneNumber?: Phone = undefined;


    @ColumnAccessControl({
        create: [],
        read: [],

        update: []
    })
    @TableColumn({ type: TableColumnType.Array })
    @ManyToMany(() => Project)
    @JoinTable()
    public projects?: Array<Project> = undefined;

}

export default User;
