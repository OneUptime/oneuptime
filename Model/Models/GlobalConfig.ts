import { Column, Entity } from 'typeorm';
import GlobalConfigModel from 'Common/Models/GlobalConfig';
import TableMetadata from 'Common/Types/Database/TableMetadata';
import IconProp from 'Common/Types/Icon/IconProp';
import Route from 'Common/Types/API/Route';
import CrudApiEndpoint from 'Common/Types/Database/CrudApiEndpoint';
import TableAccessControl from 'Common/Types/Database/AccessControl/TableAccessControl';
import ColumnAccessControl from 'Common/Types/Database/AccessControl/ColumnAccessControl';
import TableColumn from 'Common/Types/Database/TableColumn';
import TableColumnType from 'Common/Types/Database/TableColumnType';
import ColumnLength from 'Common/Types/Database/ColumnLength';
import ColumnType from 'Common/Types/Database/ColumnType';
import Email from 'Common/Types/Email';
import Phone from 'Common/Types/Phone';
import Port from 'Common/Types/Port';
import Hostname from 'Common/Types/API/Hostname';
import ObjectID from 'Common/Types/ObjectID';

export enum EmailServerType {
    Internal = 'Internal',
    Sendgrid = 'Sendgrid',
    CustomSMTP = 'Custom SMTP',
}

@TableMetadata({
    tableName: 'GlobalConfig',
    singularName: 'Global Config',
    pluralName: 'Global Configs',
    icon: IconProp.Settings,
    tableDescription: 'Settings for OneUptime Server',
})
@Entity({
    name: 'GlobalConfig',
})
@CrudApiEndpoint(new Route('/global-config'))
@TableAccessControl({
    create: [],
    read: [],
    delete: [],
    update: [],
})
export default class GlobalConfig extends GlobalConfigModel {
    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Disable Signup',
        description: 'Should we disable new user sign up to this server?',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: true,
        default: false,
        unique: true,
    })
    public disableSignup?: boolean = undefined;

    // SMTP Settings.

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Is SMTP Secure',
        description: 'Is this SMTP server hosted with SSL/TLS?',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: true,
        unique: true,
    })
    public isSMTPSecure?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'SMTP Username',
        description: 'Username for your SMTP Server',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
    })
    public smtpUsername?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'SMTP Password',
        description: 'Password for your SMTP Server',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
    })
    public smtpPassword?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Number,
        title: 'SMTP Port',
        description: 'Port for your SMTP Server',
    })
    @Column({
        type: ColumnType.Number,
        nullable: true,
        unique: true,
        transformer: Port.getDatabaseTransformer(),
    })
    public smtpPort?: Port = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'SMTP Host',
        description: 'Host for your SMTP Server',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
        transformer: Hostname.getDatabaseTransformer(),
    })
    public smtpHost?: Hostname = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Email,
        title: 'SMTP From Email',
        description: 'Which email should we send mail from?',
    })
    @Column({
        type: ColumnType.Email,
        length: ColumnLength.Email,
        nullable: true,
        unique: true,
        transformer: Email.getDatabaseTransformer(),
    })
    public smtpFromEmail?: Email = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'SMTP From Name',
        description: 'Which name should we send emails from?',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
    })
    public smtpFromName?: string = undefined;

    // Twilio config.

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Twilio Account SID',
        description: 'Account SID for your Twilio Account',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
    })
    public twilioAccountSID?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Twilio Auth Token',
        description: 'Auth Token for your Twilio Account',
    })
    @Column({
        type: ColumnType.ShortText,
        length: ColumnLength.ShortText,
        nullable: true,
        unique: true,
    })
    public twilioAuthToken?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Phone,
        title: 'Twilio Phone Number',
        description: 'Phone Number for your Twilio account',
    })
    @Column({
        type: ColumnType.Phone,
        length: ColumnLength.Phone,
        nullable: true,
        unique: true,
        transformer: Phone.getDatabaseTransformer(),
    })
    public twilioPhoneNumber?: Phone = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Email Server Type',
        description: 'Email Server Type',
    })
    @Column({
        type: ColumnType.ShortText,
        nullable: true,
        unique: true,
    })
    public emailServerType?: EmailServerType = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Sendgrid API Key',
        description: 'Sendgrid API Key',
    })
    @Column({
        type: ColumnType.ShortText,
        nullable: true,
        unique: true,
    })
    public sendgridApiKey?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Email,
        title: 'Sendgrid From Email',
        description: 'Sendgrid From Email',
    })
    @Column({
        type: ColumnType.Email,
        nullable: true,
        unique: true,
    })
    public sendgridFromEmail?: Email = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ShortText,
        title: 'Sendgrid From Name',
        description: 'Sendgrid From Name',
    })
    @Column({
        type: ColumnType.ShortText,
        nullable: true,
        unique: true,
    })
    public sendgridFromName?: string = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.Boolean,
        title: 'Is Master API Key Enabled',
        description: 'Is Master API Key Enabled?',
    })
    @Column({
        type: ColumnType.Boolean,
        nullable: true,
        unique: true,
        default: false,
    })
    public isMasterApiKeyEnabled?: boolean = undefined;

    @ColumnAccessControl({
        create: [],
        read: [],
        update: [],
    })
    @TableColumn({
        type: TableColumnType.ObjectID,
        title: 'Master API Key',
        description:
            'This API key has root access to all the resources in all the projects on OneUptime.',
    })
    @Column({
        type: ColumnType.ObjectID,
        nullable: true,
        unique: true,
        transformer: ObjectID.getDatabaseTransformer(),
    })
    public masterApiKey?: ObjectID = undefined;
}
