import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorService from "CommonServer/Services/MonitorService";
import Monitor from "Model/Models/Monitor";

export default class AddSecretKeyToIncomingRequestMonitor extends DataMigrationBase {
  public constructor() {
    super("AddSecretKeyToIncomingRequestMonitor");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        monitorType: MonitorType.IncomingRequest,
      },
      select: {
        _id: true,
        incomingRequestSecretKey: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const monitor of monitors) {
      if (!monitor.incomingRequestSecretKey) {
        await MonitorService.updateOneById({
          id: monitor.id!,
          data: {
            incomingRequestSecretKey: monitor.id!, //same as id for backward compatibility
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
