import ProjectReferencesService from "./ProjectReferencesService";
import AlertStateService from "./AlertStateService";
import DataAlertService from "./DataAlertService";
import DataAssetLineageService from "./DataAssetLineageService";
import Alert from "../../Models/DatabaseModels/Alert";
import DataAlert from "../../Models/DatabaseModels/DataAlert";
import DataAssetLineage from "../../Models/DatabaseModels/DataAssetLineage";
import Model from "../../Models/DatabaseModels/DataIssueReport";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Whether OneUptime caught a reported problem first is decided here, by the
 * server: an alert open on the table, or on a table directly upstream of it.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (createBy.data.projectId && createBy.data.dataAssetId) {
      createBy.data.wasCaughtFirst = await this.isAlreadyRaised(
        createBy.data.projectId,
        createBy.data.dataAssetId,
      );
    }

    return { createBy, carryForward: undefined };
  }

  private async isAlreadyRaised(
    projectId: ObjectID,
    dataAssetId: ObjectID,
  ): Promise<boolean> {
    const upstream: Array<DataAssetLineage> =
      await DataAssetLineageService.findBy({
        query: {
          projectId,
          downstreamDataAssetId: dataAssetId,
          upstreamDataAssetId: QueryHelper.notNull(),
        },
        select: { upstreamDataAssetId: true },
        limit: 200,
        skip: 0,
        props: { isRoot: true },
      });
    const resolvedStateIds: Array<ObjectID> =
      await AlertStateService.getResolvedAlertStateIds(projectId);
    const alerts: Array<DataAlert> = await DataAlertService.findBy({
      query: {
        projectId,
        dataAssetId: QueryHelper.any([
          dataAssetId,
          ...upstream.map((edge: DataAssetLineage): ObjectID => {
            return edge.upstreamDataAssetId!;
          }),
        ]),
      },
      select: { alert: { currentAlertStateId: true } as never },
      limit: 200,
      skip: 0,
      props: { isRoot: true },
    });
    const resolved: Set<string> = new Set(
      resolvedStateIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    return alerts.some((row: DataAlert): boolean => {
      const alert: Alert | undefined = row.alert;

      return Boolean(
        alert?.currentAlertStateId &&
          !resolved.has(alert.currentAlertStateId.toString()),
      );
    });
  }
}

export default new Service();
