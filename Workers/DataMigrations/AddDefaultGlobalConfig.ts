import DataMigrationBase from './DataMigrationBase';
import GlobalConfig, { EmailServerType } from 'Model/Models/GlobalConfig';
import ObjectID from 'Common/Types/ObjectID';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import Hostname from 'Common/Types/API/Hostname';

export default class AddDefaultGlobalConfig extends DataMigrationBase {
    public constructor() {
        super('AddDefaultGlobalConfig');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const globalConfig: GlobalConfig = new GlobalConfig();
        globalConfig.id = ObjectID.getZeroObjectID();
        globalConfig.host = new Hostname('localhost');
        globalConfig.useHttps = false;
        globalConfig.emailServerType = EmailServerType.Internal;
        globalConfig.sendgridFromName = 'OneUptime';
        globalConfig.smtpFromName = 'OneUptime';


        await GlobalConfigService.create({
            data: globalConfig,
            props: {
                isRoot: true,
            },
        });
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
