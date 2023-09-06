import DataMigrationBase from './DataMigrationBase';
import GlobalConfig from 'Model/Models/GlobalConfig';
import ObjectID from 'Common/Types/ObjectID';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';

export default class AddDefaultGlobalConfig extends DataMigrationBase {
    public constructor() {
        super('AddDefaultGlobalConfig');
    }

    public override async migrate(): Promise<void> {
        // get all the users with email isVerified true.

        const globalConfig: GlobalConfig = new GlobalConfig();
        globalConfig.id = ObjectID.getZeroObjectID();
        globalConfig.host = 'localhost';
        globalConfig.useHttps = false; 

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
