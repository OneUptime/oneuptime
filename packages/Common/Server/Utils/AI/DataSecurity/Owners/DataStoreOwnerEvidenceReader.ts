import DataStore from "../../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../../Models/DatabaseModels/DataStoreAccess";
import Label from "../../../../../Models/DatabaseModels/Label";
import Service from "../../../../../Models/DatabaseModels/Service";
import ServiceOwnerTeam from "../../../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../../../Models/DatabaseModels/ServiceOwnerUser";
import Team from "../../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../../../Models/DatabaseModels/TeamPermission";
import AnalyticsTableName from "../../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import TableColumnType from "../../../../../Types/AnalyticsDatabase/TableColumnType";
import { readCloudTags } from "../../../../../Types/Cloud/CloudInventory";
import { LIMIT_PER_PROJECT } from "../../../../../Types/Database/LimitMax";
import RecordActorType from "../../../../../Types/Database/RecordActor";
import { DataStorePrincipalType } from "../../../../../Types/DataSecurity/DataStoreAccess";
import OneUptimeDate from "../../../../../Types/Date";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DeclaredCode,
  DeclaredCodeOwnerReason,
  isDeclaredCodePath,
  isPathNamedAfter,
  readDeclaredCode,
} from "../../../../../Utils/AiRemediation/DeclaredCodeChange";
import {
  CodeOwnersFile,
  getCodeOwnersOfPath,
  GITHUB_CODE_OWNERS_PATHS,
  GITLAB_CODE_OWNERS_PATHS,
  parseCodeOwners,
} from "../../../../../Utils/CodeRepository/CodeOwners";
import {
  assembleDataStoreOwnerEvidence,
  DataStoreOwnerChangeFact,
  DataStoreOwnerCodeFact,
  DataStoreOwnerDirectory,
  DataStoreOwnerEvidenceSet,
  DataStoreOwnerFacts,
  DataStoreOwnerPerson,
  DataStoreOwnerServiceFact,
  DataStoreReadGrant,
  MAX_OWNER_SERVICES,
} from "../../../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import {
  ChangeEventAttribute,
  ChangeEventSource,
} from "../../../../../Utils/Telemetry/ChangeEventFields";
import { Results } from "../../../../Services/AnalyticsDatabaseService";
import ChangeEventService from "../../../../Services/ChangeEventService";
import { Service as CodeRepositoryServiceClass } from "../../../../Services/CodeRepositoryService";
import DataStoreAccessService from "../../../../Services/DataStoreAccessService";
import ServiceOwnerTeamService from "../../../../Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../../Services/ServiceOwnerUserService";
import ServiceService from "../../../../Services/ServiceService";
import TeamMemberService from "../../../../Services/TeamMemberService";
import TeamPermissionService from "../../../../Services/TeamPermissionService";
import TeamService from "../../../../Services/TeamService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import DeclaredCodeOwner, {
  DeclaredCodeOwnerCandidate,
  getRepositoryFullName,
} from "../../Remediation/DeclaredCodeOwner";
import CloudAiTargets from "../../ResourceAccess/CloudAiTargets";
import { getClickhouseDatabaseName } from "../../../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../../../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../../../AnalyticsDatabase/Statement";
import { ResolvableRepository } from "../../../CodeRepository/StackTraceRepoResolver";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import { ResponseJSON } from "@clickhouse/client";
import { DataStoreForOwnerEvidence } from "./DataStoreOwnerSelects";

/*
 * WHAT POINTS TO A STORE'S OWNERS, READ BY PLAIN CODE (#10374).
 *
 * For one store with no owners, this reads every place OneUptime already
 * knows who owns it, and hands the facts to DataStoreOwnerEvidence to map
 * to the project's people and teams:
 *
 *   - its cloud tags (DataStore.cloudTags);
 *   - the services seen using it in traces (DataStoreAccess rows of
 *     DataSecurityTracedAccess), and the service whose telemetry it is
 *     (DataStore.serviceId) - each with its owners (ServiceOwnerUser,
 *     ServiceOwnerTeam);
 *   - the file that declares it, in a repository OneUptime AI can work in
 *     (DeclaredCodeOwner, from the tags that say it is declared as code),
 *     and that file's code owners in the repository (GitHub's CODEOWNERS,
 *     GitLab's code owners: Utils/CodeRepository/CodeOwners);
 *   - who changed it, as the cloud's change log names them
 *     (ChangeEventAttribute.CloudActor, the last 90 days);
 *   - the person who added it to OneUptime, when a person did (#10290).
 *
 * The project's people, teams and who of them can read data stores are
 * read once for a run (readDirectory). Each source that cannot be read is
 * left out - a repository's host down, the change log unreachable - and
 * the rest still count: evidence that could not be read is no evidence.
 * Read as OneUptime (root), with the project scoped explicitly: the work
 * is OneUptime's own, and a person approves what it proposes.
 */

// How far back the change log is read for who changed a store.
export const OWNER_CHANGE_LOOKBACK_IN_DAYS: number = 90;

// The most actors the change log read returns.
const MAX_CHANGE_ACTORS_READ: number = 10;

// How long the change log read may take before it stops.
const CHANGE_LOG_READ_TIMEOUT_IN_SECONDS: number = 30;

/*
 * A run's memory of the code owners files it read: each repository's
 * once, however many of its stores are read.
 */
export type CodeOwnersFileCache = Map<
  string,
  Promise<{ path: string; file: CodeOwnersFile } | null>
>;

function idOf(value: { id?: ObjectID | null; _id?: unknown } | null): string {
  if (!value) {
    return "";
  }

  return (value.id?.toString() || String(value._id || "")).toLowerCase();
}

function labelIdsOf(labels: Array<Label> | undefined): Array<string> {
  return (labels || [])
    .map((label: Label): string => {
      return idOf(label);
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

export default class DataStoreOwnerEvidenceReader {
  /*
   * The project's people (members who accepted their invitation), its
   * teams, and each team's permissions that read data stores - the store's
   * own read list, which holds the project roles, the Security roles and
   * every product level that reaches a store (#10289).
   */
  @CaptureSpan()
  public static async readDirectory(
    projectId: ObjectID,
  ): Promise<DataStoreOwnerDirectory> {
    const [members, teams, permissions]: [
      Array<TeamMember>,
      Array<Team>,
      Array<TeamPermission>,
    ] = await Promise.all([
      TeamMemberService.findBy({
        query: { projectId, hasAcceptedInvitation: true },
        select: {
          _id: true,
          teamId: true,
          userId: true,
          user: { _id: true, name: true, email: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      TeamService.findBy({
        query: { projectId },
        select: { _id: true, name: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      TeamPermissionService.findBy({
        query: {
          projectId,
          permission: QueryHelper.any(
            new DataStore().readRecordPermissions as Array<string>,
          ),
        },
        select: {
          _id: true,
          teamId: true,
          permission: true,
          isBlockPermission: true,
          labels: { _id: true },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ]);

    const people: Map<string, DataStoreOwnerPerson> = new Map();

    for (const member of members) {
      const userId: string = member.userId?.toString().toLowerCase() || "";
      const teamId: string = member.teamId?.toString().toLowerCase() || "";

      if (!userId) {
        continue;
      }

      const email: string = member.user?.email?.toString().toLowerCase() || "";
      const person: DataStoreOwnerPerson = people.get(userId) || {
        id: userId,
        name: member.user?.name?.toString() || email,
        email,
        teamIds: [],
      };

      if (teamId && !person.teamIds.includes(teamId)) {
        person.teamIds.push(teamId);
      }

      people.set(userId, person);
    }

    const grantsByTeam: Map<string, Array<DataStoreReadGrant>> = new Map();

    for (const row of permissions) {
      const teamId: string = row.teamId?.toString().toLowerCase() || "";

      if (!teamId) {
        continue;
      }

      grantsByTeam.set(teamId, [
        ...(grantsByTeam.get(teamId) || []),
        {
          labelIds: labelIdsOf(row.labels),
          isBlock: row.isBlockPermission === true,
        },
      ]);
    }

    return new DataStoreOwnerDirectory({
      people: Array.from(people.values()),
      teams: teams
        .filter((teamRow: Team): boolean => {
          return Boolean(teamRow.id && teamRow.name);
        })
        .map((teamRow: Team): { id: string; name: string } => {
          return {
            id: teamRow.id!.toString().toLowerCase(),
            name: teamRow.name || "",
          };
        }),
      grantsByTeam,
    });
  }

  // The evidence of who owns one store, and the candidates it names.
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerEvidence;
    directory: DataStoreOwnerDirectory;
    codeOwnersCache?: CodeOwnersFileCache | undefined;
  }): Promise<DataStoreOwnerEvidenceSet> {
    const facts: DataStoreOwnerFacts =
      await DataStoreOwnerEvidenceReader.readFacts(data);

    return assembleDataStoreOwnerEvidence({
      facts,
      directory: data.directory,
      storeLabelIds: labelIdsOf(data.store.labels),
    });
  }

  // Everything that points to the store's owners, each source read apart.
  public static async readFacts(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerEvidence;
    codeOwnersCache?: CodeOwnersFileCache | undefined;
  }): Promise<DataStoreOwnerFacts> {
    const tags: Record<string, string> = readCloudTags(data.store.cloudTags);
    const [services, codeOwners, changes]: [
      { services: Array<DataStoreOwnerServiceFact>; servicesUsingIt: number },
      Array<DataStoreOwnerCodeFact>,
      Array<DataStoreOwnerChangeFact>,
    ] = await Promise.all([
      DataStoreOwnerEvidenceReader.readServices(data).catch(
        (error: unknown) => {
          logger.error(
            `DataSecurity owners: could not read the services of store ${idOf(data.store)}: ${error}`,
          );
          return { services: [], servicesUsingIt: 0 };
        },
      ),
      DataStoreOwnerEvidenceReader.readCodeOwners({
        projectId: data.projectId,
        store: data.store,
        tags,
        cache: data.codeOwnersCache || new Map(),
      }).catch((error: unknown) => {
        logger.error(
          `DataSecurity owners: could not read the code owners of store ${idOf(data.store)}: ${error}`,
        );
        return [];
      }),
      DataStoreOwnerEvidenceReader.readChanges({
        projectId: data.projectId,
        store: data.store,
      }).catch((error: unknown) => {
        logger.error(
          `DataSecurity owners: could not read who changed store ${idOf(data.store)}: ${error}`,
        );
        return [];
      }),
    ]);

    return {
      cloudTags: tags,
      services: services.services,
      servicesUsingIt: services.servicesUsingIt,
      codeOwners,
      changes,
      addedByUserId:
        data.store.createdByActorType === RecordActorType.User &&
        data.store.createdByUserId
          ? data.store.createdByUserId.toString().toLowerCase()
          : null,
    };
  }

  /*
   * The services seen using the store in traces, the most recently first,
   * and the service whose telemetry it is - each with its owners.
   */
  public static async readServices(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerEvidence;
  }): Promise<{
    services: Array<DataStoreOwnerServiceFact>;
    servicesUsingIt: number;
  }> {
    const storeId: string = idOf(data.store);

    if (!storeId) {
      return { services: [], servicesUsingIt: 0 };
    }

    const traced: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: {
        projectId: data.projectId,
        dataStoreId: new ObjectID(storeId),
        isSeenInTraces: true,
        principalType: DataStorePrincipalType.Service,
      },
      select: {
        _id: true,
        principal: true,
        principalName: true,
        lastUsedAt: true,
      },
      sort: { lastUsedAt: SortOrder.Descending },
      skip: 0,
      limit: 50,
      props: { isRoot: true },
    });

    const serviceIds: Array<string> = [];
    const names: Map<string, string> = new Map();
    const telemetryServiceId: string =
      data.store.serviceId?.toString().toLowerCase() || "";

    if (telemetryServiceId) {
      serviceIds.push(telemetryServiceId);
    }

    const usedBy: Set<string> = new Set();

    for (const row of traced) {
      const principal: string = (row.principal || "").trim().toLowerCase();

      if (!principal) {
        continue;
      }

      usedBy.add(principal);

      // A service OneUptime holds no record of goes by its name: no owners to read.
      if (!ObjectID.isValidUUID(principal)) {
        continue;
      }

      if (!serviceIds.includes(principal)) {
        serviceIds.push(principal);
      }

      if (row.principalName) {
        names.set(principal, row.principalName);
      }
    }

    const read: Array<string> = serviceIds.slice(0, MAX_OWNER_SERVICES);

    if (read.length === 0) {
      return { services: [], servicesUsingIt: usedBy.size };
    }

    const ids: Array<ObjectID> = read.map((id: string): ObjectID => {
      return new ObjectID(id);
    });
    const [services, ownerUsers, ownerTeams]: [
      Array<Service>,
      Array<ServiceOwnerUser>,
      Array<ServiceOwnerTeam>,
    ] = await Promise.all([
      ServiceService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
        select: { _id: true, name: true },
        skip: 0,
        limit: read.length,
        props: { isRoot: true },
      }),
      ServiceOwnerUserService.findBy({
        query: { projectId: data.projectId, serviceId: QueryHelper.any(ids) },
        select: { _id: true, serviceId: true, userId: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
      ServiceOwnerTeamService.findBy({
        query: { projectId: data.projectId, serviceId: QueryHelper.any(ids) },
        select: { _id: true, serviceId: true, teamId: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      }),
    ]);

    const known: Map<string, string> = new Map(
      services.map((service: Service): [string, string] => {
        return [idOf(service), service.name || ""];
      }),
    );

    const facts: Array<DataStoreOwnerServiceFact> = read
      .filter((id: string): boolean => {
        return known.has(id);
      })
      .map((id: string): DataStoreOwnerServiceFact => {
        return {
          serviceId: id,
          serviceName: known.get(id) || names.get(id) || "",
          isTelemetry: id === telemetryServiceId,
          ownerUserIds: ownerUsers
            .filter((row: ServiceOwnerUser): boolean => {
              return row.serviceId?.toString().toLowerCase() === id;
            })
            .map((row: ServiceOwnerUser): string => {
              return row.userId?.toString().toLowerCase() || "";
            })
            .filter((userId: string): boolean => {
              return userId.length > 0;
            }),
          ownerTeamIds: ownerTeams
            .filter((row: ServiceOwnerTeam): boolean => {
              return row.serviceId?.toString().toLowerCase() === id;
            })
            .map((row: ServiceOwnerTeam): string => {
              return row.teamId?.toString().toLowerCase() || "";
            })
            .filter((teamId: string): boolean => {
              return teamId.length > 0;
            }),
        };
      });

    return { services: facts, servicesUsingIt: usedBy.size };
  }

  /*
   * The code owners of the file that declares the store: the repository
   * DeclaredCodeOwner finds from the tags that say it is declared as code,
   * the file in it named after the store, and that file's owners in the
   * repository's code owners file. Nothing for a store no tag says is
   * declared as code, or a repository with no such file.
   */
  public static async readCodeOwners(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerEvidence;
    tags: Record<string, string>;
    cache: CodeOwnersFileCache;
  }): Promise<Array<DataStoreOwnerCodeFact>> {
    const declared: DeclaredCode | null = readDeclaredCode(
      CloudAiTargets.getManagedAsCode(data.tags as Dictionary<string>),
    );
    const name: string = (data.store.name || "").trim();

    if (!declared || !name) {
      return [];
    }

    const candidates: Array<DeclaredCodeOwnerCandidate> =
      await DeclaredCodeOwner.findCandidates({
        projectId: data.projectId,
        declaredCode: declared,
        resource: { name, tags: data.tags as Dictionary<string> },
      });
    const best: DeclaredCodeOwnerCandidate | null =
      DeclaredCodeOwner.getBest(candidates);

    if (!best) {
      return [];
    }

    let filePath: string | undefined = best.matchedPaths[0];

    // A tag names the repository: its file is the one named after the store.
    if (!filePath && best.reason === DeclaredCodeOwnerReason.NamedByTag) {
      const paths: Array<string> =
        await CodeRepositoryServiceClass.getRepositoryTreePaths(
          best.repository,
        );

      filePath = paths.find((path: string): boolean => {
        return (
          isDeclaredCodePath(path, declared.kind) &&
          [declared.stackName || "", name].some((resourceName: string) => {
            return (
              resourceName.length > 0 && isPathNamedAfter(path, resourceName)
            );
          })
        );
      });
    }

    if (!filePath) {
      return [];
    }

    const codeOwners: { path: string; file: CodeOwnersFile } | null =
      await DataStoreOwnerEvidenceReader.readCodeOwnersFile(
        best.repository,
        data.cache,
      );

    if (!codeOwners) {
      return [];
    }

    const owners: Array<string> = getCodeOwnersOfPath(
      codeOwners.file,
      filePath,
    );

    return owners.length > 0
      ? [
          {
            repositoryName: getRepositoryFullName(best.repository),
            filePath,
            codeOwnersPath: codeOwners.path,
            owners,
          },
        ]
      : [];
  }

  /*
   * A repository's code owners file, where its host looks for one - each
   * repository's read once a run.
   */
  public static readCodeOwnersFile(
    repository: ResolvableRepository,
    cache: CodeOwnersFileCache,
  ): Promise<{ path: string; file: CodeOwnersFile } | null> {
    const cached:
      | Promise<{ path: string; file: CodeOwnersFile } | null>
      | undefined = cache.get(repository.id);

    if (cached) {
      return cached;
    }

    const reading: Promise<{ path: string; file: CodeOwnersFile } | null> =
      (async (): Promise<{ path: string; file: CodeOwnersFile } | null> => {
        const paths: ReadonlyArray<string> =
          repository.repositoryHostedAt === CodeRepositoryType.GitLab
            ? GITLAB_CODE_OWNERS_PATHS
            : GITHUB_CODE_OWNERS_PATHS;

        for (const path of paths) {
          const text: string | null =
            await CodeRepositoryServiceClass.getRepositoryFileText(
              repository,
              path,
            );

          if (text !== null) {
            return { path, file: parseCodeOwners(text) };
          }
        }

        return null;
      })().catch((error: unknown) => {
        logger.debug(
          `DataSecurity owners: the code owners of repository ${repository.id} could not be read: ${error}`,
        );
        return null;
      });

    cache.set(repository.id, reading);

    return reading;
  }

  /*
   * Who changed the store, as the cloud's change log names them: each
   * actor once, with how many changes, the last operation and when, the
   * most changes first. The store's Cloud Resource names it where the
   * connection holds one, else its id at the provider.
   */
  public static async readChanges(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerEvidence;
  }): Promise<Array<DataStoreOwnerChangeFact>> {
    const cloudResourceId: string =
      data.store.cloudResourceId?.toString() || "";
    const providerResourceId: string = (
      data.store.providerResourceId || ""
    ).trim();

    if (!cloudResourceId && !providerResourceId) {
      return [];
    }

    const result: Results = await ChangeEventService.executeQuery(
      DataStoreOwnerEvidenceReader.buildChangesStatement({
        projectId: data.projectId,
        cloudResourceId,
        providerResourceId,
        since: OneUptimeDate.addRemoveDays(
          OneUptimeDate.getCurrentDate(),
          -OWNER_CHANGE_LOOKBACK_IN_DAYS,
        ),
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return ((response.data || []) as Array<JSONObject>)
      .map((row: JSONObject): DataStoreOwnerChangeFact | null => {
        const actor: string =
          typeof row["actor"] === "string" ? row["actor"] : "";
        const lastAt: number = Number(row["lastChangedAtInMs"]);

        if (!actor.trim()) {
          return null;
        }

        return {
          actor: actor.slice(0, 300),
          operation:
            typeof row["operation"] === "string"
              ? row["operation"].slice(0, 200)
              : "",
          changeCount: Math.max(0, Math.floor(Number(row["changes"]) || 0)),
          lastChangedAt: Number.isFinite(lastAt)
            ? new Date(lastAt).toISOString()
            : "",
        };
      })
      .filter(
        (
          change: DataStoreOwnerChangeFact | null,
        ): change is DataStoreOwnerChangeFact => {
          return change !== null;
        },
      );
  }

  // The change log read: every value a parameter, the attribute keys too.
  public static buildChangesStatement(data: {
    projectId: ObjectID;
    cloudResourceId: string;
    providerResourceId: string;
    since: Date;
  }): Statement {
    const text: (value: string) => { type: TableColumnType; value: string } = (
      value: string,
    ): { type: TableColumnType; value: string } => {
      return { type: TableColumnType.Text, value };
    };
    const ids: Array<string> = [data.providerResourceId];
    const lastSegment: string =
      data.providerResourceId.split(/[/:]/).pop()?.trim() || "";

    if (lastSegment && lastSegment !== data.providerResourceId) {
      ids.push(lastSegment);
    }

    const statement: Statement = SQL`SELECT attributes[${text(
      ChangeEventAttribute.CloudActor,
    )}] AS actor, argMax(attributes[${text(
      ChangeEventAttribute.CloudOperation,
    )}], time) AS operation, count() AS changes, toUnixTimestamp64Milli(max(time)) AS lastChangedAtInMs FROM `;
    statement.append(
      `${getClickhouseDatabaseName()}.${AnalyticsTableName.ChangeEvent}`,
    );
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.since,
      }} AND attributes[${text(ChangeEventAttribute.Source)}] = ${text(
        ChangeEventSource.Cloud,
      )} AND attributes[${text(ChangeEventAttribute.CloudActor)}] != '' AND (`,
    );

    if (data.cloudResourceId) {
      statement.append(
        SQL`attributes[${text(ChangeEventAttribute.ResourceId)}] = ${text(
          data.cloudResourceId,
        )}`,
      );
    }

    if (data.providerResourceId) {
      if (data.cloudResourceId) {
        statement.append(SQL` OR `);
      }

      statement.append(
        SQL`attributes[${text(ChangeEventAttribute.CloudResourceId)}] IN ${{
          type: TableColumnType.ArrayText,
          value: ids,
        }}`,
      );
    }

    statement.append(
      SQL`) AND retentionDate >= now() GROUP BY actor ORDER BY changes DESC, lastChangedAtInMs DESC LIMIT ${{
        type: TableColumnType.Number,
        value: MAX_CHANGE_ACTORS_READ,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: CHANGE_LOG_READ_TIMEOUT_IN_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }
}
