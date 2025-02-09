import DataMigrationBase from "./DataMigrationBase";
import { Green } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";

export default class AddDowntimeMonitorStatusToStatusPage extends DataMigrationBase {
  public constructor() {
    super("AddDowntimeMonitorStatusToStatusPage");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {},
      select: {
        _id: true,
        projectId: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const statusPage of statusPages) {
      // add ended scheduled maintenance state for each of these projects.
      // first fetch resolved state. Ended state order is -1 of resolved state.

      if (!statusPage.projectId) {
        continue;
      }

      const monitorStatuses: Array<MonitorStatus> =
        await MonitorStatusService.findBy({
          query: {
            projectId: statusPage.projectId,
          },
          select: {
            _id: true,
            isOperationalState: true,
          },
          props: {
            isRoot: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      const getNonOperationStatuses: Array<MonitorStatus> =
        monitorStatuses.filter((monitorStatus: MonitorStatus) => {
          return !monitorStatus.isOperationalState;
        });

      await StatusPageService.updateOneById({
        id: statusPage.id!,
        data: {
          downtimeMonitorStatuses: getNonOperationStatuses as any,
          defaultBarColor: new Color(Green.toString()) as any,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
