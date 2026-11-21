import AIInsightService from "../../Services/AIInsightService";
import AlertService from "../../Services/AlertService";
import ApiKeyPermissionService from "../../Services/ApiKeyPermissionService";
import IncidentService from "../../Services/IncidentService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import QueryHelper from "../../Types/Database/QueryHelper";
import type { OwnerTablePair } from "../../Types/Database/Permissions/OwnerTableRegistry";
import ReadAudiencePermission from "../../Types/Database/Permissions/ReadAudiencePermission";
import TablePermission from "../../Types/Database/Permissions/TablePermission";
import LinkedAffectedResources, {
  LinkedAffectedResource,
} from "../AffectedResources/LinkedAffectedResources";
import DataAlertLineageReader from "../DataObservability/DataAlertLineage";
import { DataLineageNamed } from "../DataObservability/DataTableLineage";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import UserPermissionUtil from "../UserPermission/UserPermission";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../Models/DatabaseModels/Alert";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseFeed from "../../../Models/DatabaseModels/SecurityCaseFeed";
import Service from "../../../Models/DatabaseModels/Service";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import ReadAudience from "../../../Types/BaseDatabase/ReadAudience";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * WHO READS WHAT A RUN ABOUT A SUBJECT POSTS, worked out once per run
 * (Types/BaseDatabase/ReadAudience, #9576, #9612): an incident's or an
 * alert's investigation and its fixes, a security case's triage, an AI
 * insight's triage - what narrows somebody's reads in the project, what
 * the subject names itself, and the telemetry-owning resources set apart.
 * The run then reads with ReadAudiencePermission.getReadProps(audience),
 * and the permission layer narrows each of its reads by it.
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
 *
 * A RUN THAT POSTS ONLY WHERE ITS SUBJECT IS READ (#9632) - a security
 * case's triage, on the case and its timeline - is read by nobody but who
 * may read the subject there. A row that reaches none of them narrows none
 * of its readers, so only the rows that reach one count
 * (readRowsReachingReaders): a team of developers limited to what they own,
 * none of whom may read security cases, no longer leaves out of a case's
 * triage every host an owner set apart. Every other run posts where its
 * readers cannot be told from the project's rows - an incident's or an
 * alert's Slack and Microsoft Teams channels - or is read again by other
 * runs (an insight's triage, by an investigation's query_ai_insights), so
 * every row counts for it, as above.
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

/*
 * One permission row that narrows somebody's reads, and whom it reaches: a
 * team's - or a custom role's copy on a team - narrows the team's members,
 * an API key's narrows the key. Ids are lower case. A row read with neither
 * reaches somebody nobody can tell, and counts for every run.
 */
export interface ReadNarrowingRow {
  permission: string;
  // Scoped to Owned: it narrows by owners. Otherwise it narrows by labels.
  isOwnedOnly: boolean;
  teamId?: string | undefined;
  apiKeyId?: string | undefined;
}

export interface ReadAudienceOptions {
  /*
   * False for a decision that reads no telemetry (whether an alert is one
   * its readers may read): the telemetry-owning resources set apart are not
   * looked up.
   */
  withTelemetry?: boolean | undefined;
  /*
   * The run posts only where its subject is read (#9632): what it writes
   * is read through OneUptime's own permission checks on the subject's
   * records, and nowhere else - no Slack or Microsoft Teams channel, email
   * or other notice, and no other run reads it again. Then a row that
   * reaches nobody who may read the subject narrows none of the run's
   * readers, and is not counted. Only a security case's readers are known
   * (getSubjectReadingPermissions); for any other subject every row counts
   * as before. A runner says so only when every place it writes is weighed
   * (SubjectReadersOnlyGuard).
   */
  postsOnlyWhereTheSubjectIsRead?: boolean | undefined;
}

/*
 * What a run is about - an incident or an alert, a security case or an AI
 * insight, one of them - and what it acts on beside it.
 */
export interface ReadAudienceSubject {
  projectId: ObjectID;
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  /*
   * A security case (#9612): everyone who may see the case reads its
   * triage, on its page and in its timeline.
   */
  securityCaseId?: ObjectID | undefined;
  /*
   * An AI insight (#9612): everyone who may see the insight reads its
   * triage - who may read the service it is about, or the whole project
   * for an insight about none (AIInsight's @OwnedThrough).
   */
  aiInsightId?: ObjectID | undefined;
  /*
   * What a run about the subject acts on, by model name ("KubernetesCluster",
   * "Runner", "Runbook" ...): a fix's cluster or resource, and the Runners
   * and runbooks its AI rule names (RemediationReadAudience). Read like
   * what the subject names itself, whoever owns them and whatever labels
   * they carry: the fix acts on them, and says so where it posts.
   */
  targets?: Dictionary<Array<string | ObjectID>> | undefined;
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

/*
 * The permissions every signed-in person and every API key holds on no row
 * of the project's: the global ones (AccessTokenService,
 * APIKeyAccessPermission) and the ones a member's set holds on no team's
 * behalf (UserPermissionUtil.TEAMLESS_PERMISSIONS). One among the reading
 * permissions makes everybody a reader.
 */
function getPermissionsEverybodyHolds(): Set<string> {
  return new Set<string>([
    Permission.Public,
    Permission.User,
    Permission.CurrentUser,
    Permission.AuthenticatedRequest,
    ...UserPermissionUtil.TEAMLESS_PERMISSIONS,
  ]);
}

// An id as rows are matched by: lower case, empty for none.
function idOf(id: ObjectID | string | null | undefined): string {
  return id ? id.toString().toLowerCase() : "";
}

function distinctIds(ids: Array<string | undefined>): Array<string> {
  return Array.from(
    new Set<string>(
      ids.filter((id: string | undefined): id is string => {
        return Boolean(id);
      }),
    ),
  ).sort();
}

export default class ReadAudienceReader {
  /*
   * The audience of a subject's readers: an incident's or an alert's, a
   * security case's or an AI insight's. `withTelemetry` false leaves out
   * the telemetry-owning resources it sets apart, for a decision that reads
   * no telemetry (whether an alert is one they may read): those are looked
   * up only when some read is narrowed. `postsOnlyWhereTheSubjectIsRead`
   * counts only the narrowing that reaches somebody who may read the
   * subject (ReadAudienceOptions, #9632).
   */
  @CaptureSpan()
  public static async forSubject(
    subject: ReadAudienceSubject,
    options?: ReadAudienceOptions,
  ): Promise<ReadAudience> {
    const [narrowing, named]: [
      ReadNarrowingPermissions,
      Dictionary<Array<string>>,
    ] = await Promise.all([
      options?.postsOnlyWhereTheSubjectIsRead
        ? ReadAudienceReader.readNarrowingPermissionsOfReaders(subject)
        : ReadAudienceReader.readNarrowingPermissions(subject.projectId),
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
    return ReadAudienceReader.getNarrowingPermissions(
      await ReadAudienceReader.readNarrowingRows(projectId),
    );
  }

  /*
   * THE PERMISSIONS THAT NARROW THE READS OF SOMEBODY WHO MAY READ THE
   * SUBJECT (#9632), for a run that posts only where its subject is read:
   * of the rows readNarrowingPermissions weighs, those that reach one of
   * the subject's readers (readRowsReachingReaders). Every row, for a
   * subject whose readers cannot be told (getSubjectReadingPermissions).
   */
  @CaptureSpan()
  public static async readNarrowingPermissionsOfReaders(
    subject: ReadAudienceSubject,
  ): Promise<ReadNarrowingPermissions> {
    const rows: Array<ReadNarrowingRow> =
      await ReadAudienceReader.readNarrowingRows(subject.projectId);
    const readingPermissions: Array<string> | null =
      ReadAudienceReader.getSubjectReadingPermissions(subject);

    // A project that narrows nobody looks nobody up.
    if (rows.length === 0 || !readingPermissions) {
      return ReadAudienceReader.getNarrowingPermissions(rows);
    }

    const reaching: Array<ReadNarrowingRow> =
      await ReadAudienceReader.readRowsReachingReaders({
        projectId: subject.projectId,
        rows,
        readingPermissions,
      });

    if (reaching.length < rows.length) {
      logger.debug(
        `AI: a run about a subject of project ${subject.projectId.toString()} counts ${reaching.length} of the ${rows.length} permission rows that narrow somebody's reads: the others reach nobody who may read the subject.`,
      );
    }

    return ReadAudienceReader.getNarrowingPermissions(reaching);
  }

  /*
   * The project's permission rows that narrow somebody's reads, each with
   * whom it reaches: the rows a team or a custom role on a team holds
   * scoped to Owned - a block takes a permission away, whatever its scope:
   * it narrows by labels, or not at all - and those a team, a custom role
   * or an API key holds limited to some labels, or blocks for some labels.
   */
  @CaptureSpan()
  public static async readNarrowingRows(
    projectId: ObjectID,
  ): Promise<Array<ReadNarrowingRow>> {
    const [ownedRows, labelledTeamRows, labelledKeyRows]: [
      Array<TeamPermission>,
      Array<TeamPermission>,
      Array<ApiKeyPermission>,
    ] = await Promise.all([
      TeamPermissionService.findAllBy({
        query: { projectId, scope: PermissionScope.Owned },
        select: { permission: true, isBlockPermission: true, teamId: true },
        props: { isRoot: true },
      }),
      TeamPermissionService.findAllBy({
        query: {
          projectId,
          _id: QueryHelper.anyEntitiesInManyToMany(TEAM_PERMISSION_LABELS),
        },
        select: { permission: true, teamId: true },
        props: { isRoot: true },
      }),
      ApiKeyPermissionService.findAllBy({
        query: {
          projectId,
          _id: QueryHelper.anyEntitiesInManyToMany(API_KEY_PERMISSION_LABELS),
        },
        select: { permission: true, apiKeyId: true },
        props: { isRoot: true },
      }),
    ]);

    const rows: Array<ReadNarrowingRow> = [
      ...ownedRows
        .filter((row: TeamPermission): boolean => {
          return !row.isBlockPermission;
        })
        .map((row: TeamPermission): ReadNarrowingRow => {
          return {
            permission: row.permission ? String(row.permission) : "",
            isOwnedOnly: true,
            teamId: idOf(row.teamId) || undefined,
          };
        }),
      ...labelledTeamRows.map((row: TeamPermission): ReadNarrowingRow => {
        return {
          permission: row.permission ? String(row.permission) : "",
          isOwnedOnly: false,
          teamId: idOf(row.teamId) || undefined,
        };
      }),
      ...labelledKeyRows.map((row: ApiKeyPermission): ReadNarrowingRow => {
        return {
          permission: row.permission ? String(row.permission) : "",
          isOwnedOnly: false,
          apiKeyId: idOf(row.apiKeyId) || undefined,
        };
      }),
    ];

    return rows.filter((row: ReadNarrowingRow): boolean => {
      return Boolean(row.permission);
    });
  }

  // The permissions some of `rows` narrow by owners, and by labels, each once.
  public static getNarrowingPermissions(
    rows: Array<ReadNarrowingRow>,
  ): ReadNarrowingPermissions {
    return {
      ownedOnlyPermissions: distinctPermissions(
        rows.filter((row: ReadNarrowingRow): boolean => {
          return row.isOwnedOnly;
        }),
      ),
      labelledPermissions: distinctPermissions(
        rows.filter((row: ReadNarrowingRow): boolean => {
          return !row.isOwnedOnly;
        }),
      ),
    };
  }

  /*
   * WHERE A RUN THAT POSTS ONLY ON ITS SUBJECT IS READ (#9632), as the
   * permissions that read it: each model's own read list, with the levels
   * of the product whose records they are (TableAccessControl), and the
   * operational-resource wildcard where its read takes one. Null when the
   * subject's readers cannot be told from the project's permission rows:
   * every row counts then.
   *
   * Only a security case's are known. Its triage is written
   *
   *   - on the case: the verdict, priority and playbook it suggests and the
   *     report it wrote, columns of the case's own that no relation reads,
   *     shown on the case's AI card to whoever may read the case
   *     (SecurityCaseAPI) - and its suggested next steps, which the case's
   *     Response Plan lists, OneUptime never checks and so never tells;
   *   - on the case's timeline (SecurityCaseFeed);
   *   - in the project's audit log, as a change OneUptime made to the case,
   *     where the project keeps OneUptime's own changes: the part of the
   *     report around where it changed (AuditLog).
   *
   * Whoever may read one of them holds one of these, whatever its scope or
   * its labels. SubjectReadersOnlyGuard holds the triage to these places.
   */
  public static getSubjectReadingPermissions(
    subject: ReadAudienceSubject,
  ): Array<string> | null {
    // A case's run alone: readNamed reads an incident or an alert first.
    if (!subject.securityCaseId || subject.incidentId || subject.alertId) {
      return null;
    }

    const reading: Set<string> = new Set<string>();
    const readOn: Array<DatabaseBaseModelType> = [
      SecurityCase,
      SecurityCaseFeed,
    ];

    for (const modelType of readOn) {
      for (const permission of TablePermission.getTablePermission(
        modelType,
        DatabaseRequestType.Read,
      )) {
        reading.add(String(permission));
      }

      const wildcard: Permission | null = TablePermission.getModelWildcard(
        modelType,
        DatabaseRequestType.Read,
      );

      if (wildcard) {
        reading.add(String(wildcard));
      }
    }

    for (const permission of new AuditLog().accessControl?.read || []) {
      reading.add(String(permission));
    }

    return Array.from(reading).sort();
  }

  /*
   * OF THE ROWS THAT NARROW SOMEBODY'S READS, THOSE THAT REACH SOMEBODY WHO
   * MAY READ WHERE THE RUN POSTS (#9632): who holds one of
   * `readingPermissions`. A row counts when
   *
   *   - it is an API key's, and the key holds one itself;
   *   - it is a team's, and the team holds one itself - whoever is on it,
   *     now or once they join, reads the run - or somebody on the team holds
   *     one through any team of theirs: the row narrows them, and they read
   *     the run;
   *   - nobody can tell whom it reaches: a row read with no team or key.
   *
   * So a row is left out only when nobody it reaches may read the run, and
   * none of the run's readers is narrowed by it. Weighed so that a doubt
   * keeps the row:
   *
   *   - every member counts, an invitation not yet accepted included: they
   *     read the run the moment they accept;
   *   - holding one is enough, whatever its scope or its labels: a Security
   *     Viewer limited to some labels still reads some cases. Only a block
   *     grants nothing: a team blocked from cases reads none through it;
   *   - one that every member and key holds (getPermissionsEverybodyHolds)
   *     among them makes every row count.
   *
   * Who may read the subject is read as the run starts, as every row is: a
   * run reads for its readers then (Types/BaseDatabase/ReadAudience). A
   * team that comes to read cases later - a member joins the Security team,
   * the team is given Security Viewer - then reads what earlier runs wrote,
   * as anybody reads what was written before their access changed.
   *
   * Four reads of the project's own rows at most - the teams' and the keys'
   * rows that grant a reading permission, who is on the teams that narrow,
   * and which of them is on a team that reads - and none when no row names
   * a team or a key.
   */
  @CaptureSpan()
  public static async readRowsReachingReaders(data: {
    projectId: ObjectID;
    rows: Array<ReadNarrowingRow>;
    readingPermissions: Array<string>;
  }): Promise<Array<ReadNarrowingRow>> {
    const everybodyHolds: Set<string> = getPermissionsEverybodyHolds();

    // No permission said to read the run is a doubt, not "nobody reads it".
    if (
      data.readingPermissions.length === 0 ||
      data.readingPermissions.some((permission: string): boolean => {
        return everybodyHolds.has(permission);
      })
    ) {
      return data.rows;
    }

    const teamIds: Array<string> = distinctIds(
      data.rows.map((row: ReadNarrowingRow): string | undefined => {
        return row.teamId;
      }),
    );
    const apiKeyIds: Array<string> = distinctIds(
      data.rows.map((row: ReadNarrowingRow): string | undefined => {
        return row.apiKeyId;
      }),
    );

    if (teamIds.length === 0 && apiKeyIds.length === 0) {
      return data.rows;
    }

    const [readingTeamRows, readingKeyRows, narrowedMembers]: [
      Array<TeamPermission>,
      Array<ApiKeyPermission>,
      Array<TeamMember>,
    ] = await Promise.all([
      teamIds.length > 0
        ? TeamPermissionService.findAllBy({
            query: {
              projectId: data.projectId,
              permission: QueryHelper.any(data.readingPermissions),
            },
            select: { teamId: true, isBlockPermission: true },
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      apiKeyIds.length > 0
        ? ApiKeyPermissionService.findAllBy({
            query: {
              projectId: data.projectId,
              apiKeyId: QueryHelper.any(apiKeyIds),
              permission: QueryHelper.any(data.readingPermissions),
            },
            select: { apiKeyId: true, isBlockPermission: true },
            props: { isRoot: true },
          })
        : Promise.resolve([]),
      teamIds.length > 0
        ? TeamMemberService.findAllBy({
            query: {
              projectId: data.projectId,
              teamId: QueryHelper.any(teamIds),
            },
            select: { teamId: true, userId: true },
            props: { isRoot: true },
          })
        : Promise.resolve([]),
    ]);

    // A block grants nothing: only an allow row makes a reader.
    const readingTeamIds: Set<string> = new Set<string>(
      readingTeamRows
        .filter((row: TeamPermission): boolean => {
          return row.isBlockPermission !== true;
        })
        .map((row: TeamPermission): string => {
          return idOf(row.teamId);
        })
        .filter(Boolean),
    );
    const readingApiKeyIds: Set<string> = new Set<string>(
      readingKeyRows
        .filter((row: ApiKeyPermission): boolean => {
          return row.isBlockPermission !== true;
        })
        .map((row: ApiKeyPermission): string => {
          return idOf(row.apiKeyId);
        })
        .filter(Boolean),
    );

    // Who is on each team that narrows, by team.
    const membersByTeam: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const member of narrowedMembers) {
      const teamId: string = idOf(member.teamId);
      const userId: string = idOf(member.userId);

      if (!teamId || !userId) {
        continue;
      }

      membersByTeam.set(
        teamId,
        (membersByTeam.get(teamId) || new Set<string>()).add(userId),
      );
    }

    // Of them, who is also on a team that reads where the run posts.
    const memberIds: Array<string> = distinctIds(
      narrowedMembers.map((member: TeamMember): string => {
        return idOf(member.userId);
      }),
    );
    const readerIds: Set<string> = new Set<string>();

    if (memberIds.length > 0 && readingTeamIds.size > 0) {
      const memberships: Array<TeamMember> = await TeamMemberService.findAllBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(memberIds),
          teamId: QueryHelper.any(Array.from(readingTeamIds)),
        },
        select: { userId: true },
        props: { isRoot: true },
      });

      for (const membership of memberships) {
        const userId: string = idOf(membership.userId);

        if (userId) {
          readerIds.add(userId);
        }
      }
    }

    return data.rows.filter((row: ReadNarrowingRow): boolean => {
      if (row.apiKeyId) {
        return readingApiKeyIds.has(row.apiKeyId);
      }

      if (!row.teamId) {
        return true;
      }

      if (readingTeamIds.has(row.teamId)) {
        return true;
      }

      return Array.from(membersByTeam.get(row.teamId) || []).some(
        (userId: string): boolean => {
          return readerIds.has(userId);
        },
      );
    });
  }

  /*
   * WHAT THE SUBJECT NAMES ITSELF, by model name: its own record, and
   *
   *   - for an incident or an alert, the records its Affected Resources
   *     list (LinkedAffectedResources - the monitors, hosts, clusters,
   *     databases, services and SLOs its feed, emails and channels name
   *     already), and for a data alert its table or pipeline
   *     (DataAlertLineageReader.readNamed);
   *   - for a security case, the incident it declared, which its header
   *     and timeline name - unless that incident is private: its owners
   *     alone read it, whoever may see the case;
   *   - for an AI insight, the service it is about;
   *
   * and what a run about it acts on (ReadAudienceSubject.targets).
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

      const dataNamed: DataLineageNamed =
        await DataAlertLineageReader.readNamed(
          subject.projectId,
          subject.alertId,
        );

      for (const id of dataNamed.dataAssetIds) {
        add(ReadAudiencePermission.getKindName(DataAsset), id);
      }

      for (const id of dataNamed.dataPipelineIds) {
        add(ReadAudiencePermission.getKindName(DataPipeline), id);
      }
    } else if (subject.securityCaseId) {
      add(
        ReadAudiencePermission.getKindName(SecurityCase),
        subject.securityCaseId,
      );

      const declaredIncidentId: ObjectID | null =
        await ReadAudienceReader.readDeclaredIncidentId({
          projectId: subject.projectId,
          securityCaseId: subject.securityCaseId,
        });

      if (declaredIncidentId) {
        add(ReadAudiencePermission.getKindName(Incident), declaredIncidentId);
      }
    } else if (subject.aiInsightId) {
      add(ReadAudiencePermission.getKindName(AIInsight), subject.aiInsightId);

      const serviceId: ObjectID | null =
        await ReadAudienceReader.readInsightServiceId({
          projectId: subject.projectId,
          aiInsightId: subject.aiInsightId,
        });

      if (serviceId) {
        add(ReadAudiencePermission.getKindName(Service), serviceId);
      }
    }

    // A linked resource's type is its model's name (LinkedAffectedResourceType).
    for (const resource of resources) {
      add(resource.type, resource.id);
    }

    for (const kind of Object.keys(subject.targets || {})) {
      for (const id of subject.targets![kind] || []) {
        add(kind, id);
      }
    }

    const result: Dictionary<Array<string>> = {};

    for (const kind of Object.keys(named).sort()) {
      result[kind] = Array.from(named[kind]!).sort();
    }

    return result;
  }

  /*
   * The incident a security case declared, when it is not private: the
   * case's header and timeline name it to everyone who may see the case.
   * A private one is read by its owners alone, so it is never named for
   * the case's readers. Null when the case declared none.
   */
  public static async readDeclaredIncidentId(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<ObjectID | null> {
    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, incidentId: true },
        props: { isRoot: true },
      });

    if (!securityCase?.incidentId) {
      return null;
    }

    const incident: Incident | null = await IncidentService.findOneBy({
      query: { _id: securityCase.incidentId, projectId: data.projectId },
      select: { _id: true, isPrivate: true },
      props: { isRoot: true },
    });

    if (!incident?.id || incident.isPrivate === true) {
      return null;
    }

    return incident.id;
  }

  // The service an AI insight is about; null for one about none.
  public static async readInsightServiceId(data: {
    projectId: ObjectID;
    aiInsightId: ObjectID;
  }): Promise<ObjectID | null> {
    const insight: AIInsight | null = await AIInsightService.findOneBy({
      query: { _id: data.aiInsightId, projectId: data.projectId },
      select: { _id: true, telemetryServiceId: true },
      props: { isRoot: true },
    });

    return insight?.telemetryServiceId || null;
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

    const registry: Map<string, OwnerTablePair> =
      ReadAudienceReader.getOwnerTableRegistry();

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
        `AI: a run of project ${audience.projectId} leaves out the telemetry of ${blocked.size} resources set apart by an owner or a label.`,
      );
    }

    return Array.from(blocked).sort();
  }

  /*
   * The owner table registry, read when first needed rather than imported,
   * as OwnedScopePermission and ModelPermission read it: the registry
   * imports every kind's services, which reach this module again. Imported
   * while one of them was still loading, it would hold that kind's service
   * as undefined, and readTelemetryBlockedIds would skip the kind - its
   * resources set apart would keep their telemetry (#9612).
   */
  private static getOwnerTableRegistry(): Map<string, OwnerTablePair> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("../../Types/Database/Permissions/OwnerTableRegistry")
      .default;
  }
}
