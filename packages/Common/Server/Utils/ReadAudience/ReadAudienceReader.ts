import AlertService from "../../Services/AlertService";
import ApiKeyPermissionService from "../../Services/ApiKeyPermissionService";
import IncidentService from "../../Services/IncidentService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../Types/Database/Permissions/OwnerTableRegistry";
import ReadAudiencePermission from "../../Types/Database/Permissions/ReadAudiencePermission";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "../AffectedResources/LinkedAffectedResources";
import DataAlertLineageReader from "../DataObservability/DataAlertLineage";
import { DataLineageNamed } from "../DataObservability/DataTableLineage";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import Alert from "../../../Models/DatabaseModels/Alert";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ReadAudience from "../../../Types/BaseDatabase/ReadAudience";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHO READS AN INCIDENT'S OR AN ALERT'S REPORT, worked out once per run
 * (Types/BaseDatabase/ReadAudience, #9576): what narrows somebody's reads
 * in the project, what the subject names itself, and the telemetry-owning
 * resources set apart. The run then reads with
 * ReadAudiencePermission.getReadProps(audience), and the permission layer
 * narrows each of its reads by it.
 *
 * What narrows somebody's reads is read off the project's permission rows
 * - each team's, each custom role's copy on a team, each API key's: a row
 * scoped to Owned, or limited to some labels, or blocking some labels. A
 * row counts whoever it reaches: a team's row narrows its members though
 * another team of theirs grants the same permission over the whole
 * project, so a project is held to be narrowed on a kind as soon as one
 * such row reads it. Three reads of the project's own rows, per run: cheap
 * enough that nothing is cached, and a role changed a moment ago counts at
 * once.
 */

// The join tables the permission rows' labels are kept in.
const TEAM_PERMISSION_LABELS: {
  joinTableName: string;
  ownerColumnName: string;
} = {
  joinTableName: "TeamPermissionLabel",
  ownerColumnName: "teamPermissionId",
};
const API_KEY_PERMISSION_LABELS: {
  joinTableName: string;
  ownerColumnName: string;
} = {
  joinTableName: "ApiKeyPermissionLabel",
  ownerColumnName: "apiKeyPermissionId",
};

// The permissions that narrow somebody's reads, each once.
export interface ReadNarrowingPermissions {
  ownedOnlyPermissions: Array<string>;
  labelledPermissions: Array<string>;
}

// The incident or alert a run is about.
export interface ReadAudienceSubject {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

function distinctPermissions(
  rows: Array<{ permission?: unknown }>,
): Array<string> {
  return Array.from(
    new Set<string>(
      rows
        .map((row: { permission?: unknown }): string => {
          return row.permission ? String(row.permission) : "";
        })
        .filter(Boolean),
    ),
  ).sort();
}

export default class ReadAudienceReader {
  /*
   * The audience of an incident's or an alert's readers. `withTelemetry`
   * false leaves out the telemetry-owning resources it sets apart, for a
   * decision that reads no telemetry (whether an alert is one they may
   * read): those are looked up only when some read is narrowed.
   */
  @CaptureSpan()
  public static async forSubject(
    subject: ReadAudienceSubject,
    options?: { withTelemetry?: boolean | undefined },
  ): Promise<ReadAudience> {
    const [narrowing, named]: [
      ReadNarrowingPermissions,
      Dictionary<Array<string>>,
    ] = await Promise.all([
      ReadAudienceReader.readNarrowingPermissions(subject.projectId),
      ReadAudienceReader.readNamed(subject),
    ]);

    const audience: ReadAudience = {
      _type: "ReadAudience",
      projectId: subject.projectId.toString(),
      ownedOnlyPermissions: narrowing.ownedOnlyPermissions,
      labelledPermissions: narrowing.labelledPermissions,
      named,
      telemetryBlockedIds: [],
    };

    // A project that narrows nobody sets no resource apart: nothing to look up.
    if (
      options?.withTelemetry !== false &&
      !ReadAudiencePermission.narrowsNobody(audience)
    ) {
      audience.telemetryBlockedIds =
        await ReadAudienceReader.readTelemetryBlockedIds(audience);
    }

    return audience;
  }

  /*
   * THE PERMISSIONS THAT NARROW SOMEBODY'S READS in the project: those a
   * team or a custom role on a team holds scoped to Owned, and those a
   * team, a custom role or an API key holds limited to some labels or
   * blocks for some labels. ReadAudiencePermission works out from them,
   * kind by kind, which reads are narrowed for anybody.
   */
  @CaptureSpan()
  public static async readNarrowingPermissions(
    projectId: ObjectID,
  ): Promise<ReadNarrowingPermissions> {
    const [ownedRows, labelledTeamRows, labelledKeyRows]: [
      Array<TeamPermission>,
      Array<TeamPermission>,
      Array<ApiKeyPermission>,
    ] = await Promise.all([
      TeamPermissionService.findAllBy({
        query: { projectId, scope: PermissionScope.Owned },
        select: { permission: true, isBlockPermission: true },
        props: { isRoot: true },
      }),
      TeamPermissionService.findAllBy({
        query: {
          projectId,
          _id: QueryHelper.anyEntitiesInManyToMany(TEAM_PERMISSION_LABELS),
        },
        select: { permission: true },
        props: { isRoot: true },
      }),
      ApiKeyPermissionService.findAllBy({
        query: {
          projectId,
          _id: QueryHelper.anyEntitiesInManyToMany(API_KEY_PERMISSION_LABELS),
        },
        select: { permission: true },
        props: { isRoot: true },
      }),
    ]);

    return {
      // A block takes a permission away, whatever its scope: it narrows by labels, or not at all.
      ownedOnlyPermissions: distinctPermissions(
        ownedRows.filter((row: TeamPermission): boolean => {
          return !row.isBlockPermission;
        }),
      ),
      labelledPermissions: distinctPermissions([
        ...labelledTeamRows,
        ...labelledKeyRows,
      ]),
    };
  }

  /*
   * WHAT THE SUBJECT NAMES ITSELF, by model name: its own record, the
   * records its Affected Resources list (LinkedAffectedResources - the
   * monitors, hosts, clusters, databases, services and SLOs its feed,
   * emails and channels name already), and for a data alert its table or
   * pipeline (DataAlertLineageReader.readNamed).
   */
  @CaptureSpan()
  public static async readNamed(
    subject: ReadAudienceSubject,
  ): Promise<Dictionary<Array<string>>> {
    const named: Dictionary<Set<string>> = {};

    const add: (kind: string, id: string | ObjectID) => void = (
      kind: string,
      id: string | ObjectID,
    ): void => {
      const value: string = id.toString().toLowerCase();

      if (!value) {
        return;
      }

      named[kind] = named[kind] || new Set<string>();
      named[kind]!.add(value);
    };

    let resources: Array<LinkedAffectedResource> = [];

    if (subject.incidentId) {
      add(ReadAudiencePermission.getKindName(Incident), subject.incidentId);
      resources = await LinkedAffectedResources.readForIncident({
        service: IncidentService,
        projectId: subject.projectId,
        incidentId: subject.incidentId,
      });
    } else if (subject.alertId) {
      add(ReadAudiencePermission.getKindName(Alert), subject.alertId);
      resources = await LinkedAffectedResources.readForAlert({
        service: AlertService,
        projectId: subject.projectId,
        alertId: subject.alertId,
      });

      const dataNamed: DataLineageNamed = await DataAlertLineageReader.readNamed(
        subject.projectId,
        subject.alertId,
      );

      for (const id of dataNamed.dataAssetIds) {
        add(ReadAudiencePermission.getKindName(DataAsset), id);
      }

      for (const id of dataNamed.dataPipelineIds) {
        add(ReadAudiencePermission.getKindName(DataPipeline), id);
      }
    }

    // A linked resource's type is its model's name (LinkedAffectedResourceType).
    for (const resource of resources) {
      add(resource.type, resource.id);
    }

    const result: Dictionary<Array<string>> = {};

    for (const kind of Object.keys(named).sort()) {
      result[kind] = Array.from(named[kind]!).sort();
    }

    return result;
  }

  /*
   * Of some records of one model, the ones the audience reads, by id (lower
   * case): a read of them with the audience's props, so the permission layer
   * keeps what the subject names and leaves out what is set apart. For a
   * record named by another one the audience reads (a monitor's services,
   * read through the monitor) before it is named in turn. No read at all
   * when the audience reads every record of the model.
   */
  public static async readReadableIds(data: {
    service: {
      modelType: { new (): BaseModel };
      findBy: (findBy: never) => Promise<Array<BaseModel>>;
    };
    ids: Array<ObjectID | string>;
    audience: ReadAudience;
  }): Promise<Set<string>> {
    const ids: Array<string> = Array.from(
      new Set<string>(
        data.ids
          .map((id: ObjectID | string): string => {
            return id.toString().toLowerCase();
          })
          .filter(Boolean),
      ),
    );

    if (ids.length === 0) {
      return new Set<string>();
    }

    if (
      ReadAudiencePermission.getConditions(
        data.service.modelType,
        data.audience,
      ).length === 0
    ) {
      return new Set<string>(ids);
    }

    const rows: Array<BaseModel> = await data.service.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: { _id: true },
      limit: ids.length,
      skip: 0,
      props: ReadAudiencePermission.getReadProps(data.audience),
    } as never);

    return new Set<string>(
      rows
        .map((row: BaseModel): string => {
          return row.id?.toString().toLowerCase() || "";
        })
        .filter(Boolean),
    );
  }

  /*
   * THE TELEMETRY-OWNING RESOURCES THE AUDIENCE LEAVES OUT: of each kind a
   * telemetry row can name (the owner table registry's kinds with a service
   * of their own - services, hosts, clusters, monitors, RUM applications,
   * SLOs ...), the ones set apart on a kind somebody is narrowed on, the
   * subject's own excepted (ReadAudiencePermission.getSetApartCondition).
   */
  @CaptureSpan()
  public static async readTelemetryBlockedIds(
    audience: ReadAudience,
  ): Promise<Array<string>> {
    const blocked: Set<string> = new Set<string>();

    const registry: Map<string, OwnerTablePair> = OwnerTableRegistry;

    for (const [, entry] of registry) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service: any = entry.modelService;

      if (!service || !service.modelType) {
        continue;
      }

      const setApart: FindWhereProperty<any> | null =
        ReadAudiencePermission.getSetApartCondition(
          service.modelType as { new (): BaseModel },
          audience,
        );

      if (!setApart) {
        continue;
      }

      const rows: Array<BaseModel> = await service.findAllBy({
        query: { _id: setApart },
        select: { _id: true },
        props: { isRoot: true },
      });

      for (const row of rows) {
        const id: string = row.id?.toString().toLowerCase() || "";

        if (id) {
          blocked.add(id);
        }
      }
    }

    if (blocked.size > 0) {
      logger.debug(
        `AI: an investigation of project ${audience.projectId} leaves out the telemetry of ${blocked.size} resources set apart by an owner or a label.`,
      );
    }

    return Array.from(blocked).sort();
  }
}
