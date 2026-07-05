import DataMigrationBase from "./DataMigrationBase";
import ObjectID from "Common/Types/ObjectID";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";

export default class AddInstanceIdToGlobalConfig extends DataMigrationBase {
  public constructor() {
    super("AddInstanceIdToGlobalConfig");
  }

  public override async migrate(): Promise<void> {
    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneById({
        id: ObjectID.getZeroObjectID(),
        select: {
          instanceId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!globalConfig) {
      return;
    }

    if (globalConfig.instanceId) {
      return; // instance id already generated for this install.
    }

    await GlobalConfigService.updateOneById({
      id: ObjectID.getZeroObjectID(),
      data: {
        instanceId: ObjectID.generate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
