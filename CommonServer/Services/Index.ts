import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import ProbeService from './ProbeService';
import UserService from './UserService';
import GlobalConfigService from './GlobalConfigService';
import ProjectSmtpConfigService from './ProjectSmtpConfigService';
import EmailLogService from './EmailLogService';
import MonitorService from './MonitorService';
import ProjectService from './ProjectService';
import EmailVerificationTokenService from './EmailVerificationTokenService';
import MailService from './MailService';

const postgresDatabase: PostgresDatabase = new PostgresDatabase();
await postgresDatabase.connect(postgresDatabase.getDatasourceOptions());

export default {
    //Database Services 
    ProbeService: new ProbeService(postgresDatabase),
    UserService: new UserService(postgresDatabase),
    GlobalConfigService: new GlobalConfigService(postgresDatabase),
    ProjectSmtpConfigService: new ProjectSmtpConfigService(postgresDatabase),
    EmailLogService: new EmailLogService(postgresDatabase),
    MonitorService: new MonitorService(postgresDatabase),
    ProjectService: new ProjectService(postgresDatabase),
    EmailVerificationTokenService: new EmailVerificationTokenService(postgresDatabase),

    // Other Services.
    MailService: new MailService(),
};
