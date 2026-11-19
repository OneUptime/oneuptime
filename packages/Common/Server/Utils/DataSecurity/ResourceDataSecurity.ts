import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DataSecurityComplianceSetting from "../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ServiceModel from "../../../Models/DatabaseModels/Service";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ComplianceFramework, {
  ALL_COMPLIANCE_FRAMEWORKS,
  COMPLIANCE_FRAMEWORK_INFO,
} from "../../../Types/DataSecurity/ComplianceFramework";
import {
  ComplianceIssueInput,
  ComplianceStoreInput,
  scoreComplianceFramework,
} from "../../../Types/DataSecurity/ComplianceRequirementCatalog";
import {
  ComplianceScopeSetting,
  ComplianceScopeStore,
  ResourceFrameworkScope,
  getComplianceScopeExclusions,
  getResourceFrameworkScope,
  readComplianceScopeSetting,
} from "../../../Types/DataSecurity/ComplianceScope";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
  DataSecurityResourceComplianceFramework,
  DataSecurityResourceComplianceResponse,
  DataSecurityResourceRef,
  DataSecurityResourceScope,
  MAX_COMPLIANCE_TURNED_OFF,
  MAX_RESOURCE_SCOPE_STORES,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  DataStoreResourceKind,
  DataStoreResourceRef,
  getDataStoreComplianceOwner,
  getDatabasePlatform,
  isSameDataStoreResource,
} from "../../../Types/DataSecurity/DataStoreResource";
import CloudResourceService from "../../Services/CloudResourceService";
import DatabaseServerService from "../../Services/DatabaseServerService";
import DataSecurityComplianceSettingService from "../../Services/DataSecurityComplianceSettingService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreService from "../../Services/DataStoreService";
import DockerHostService from "../../Services/DockerHostService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
import PodmanHostService from "../../Services/PodmanHostService";
import ServiceService from "../../Services/ServiceService";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * DATA SECURITY ON A RESOURCE'S OWN PAGES (#9547, #9555).
 *
 * A Kubernetes cluster, a Docker or Podman host, a database, a cloud
 * resource and a service each show what Data Security says about the data
 * stores they hold (Types/DataSecurity/DataStoreResource): their Data
 * Security page lists those stores and their open issues, and their
 * Compliance page scores every framework over the stores whose compliance
 * they own, with what they turned off (Types/DataSecurity/ComplianceScope).
 *
 * The resource is read with the caller's own props, so a resource they may
 * not read is not found, and nothing about its stores is said; the stores,
 * their issues and the project's settings are then read as the project's
 * Compliance page reads them. Every read stays in the caller's project and
 * is bounded.
 */

// The most databases one cluster's or container host's stores are read for.
const MAX_PLATFORM_DATABASES: number = 1000;

// The most of a project's stores, issues and settings compliance reads.
const MAX_STORES: number = 10000;
const MAX_ISSUES: number = 20000;
const MAX_SETTINGS: number = 10000;

// A store as scoping and scoring read it.
export interface ScopedStore {
  id: string;
  owner: DataStoreResourceRef | null;
  input: ComplianceStoreInput;
}

// A setting that turns something off, with why and by whom, before its resource is named.
export interface TurnedOffSetting {
  id: string;
  resource: DataStoreResourceRef;
  framework: ComplianceFramework;
  requirement: string | null;
  note: string;
  turnedOffAt: string | null;
  turnedOffBy: string | null;
}

// One resource as a key: its kind and its id.
export function getResourceKey(resource: DataStoreResourceRef): string {
  return `${resource.kind}:${resource.id}`;
}

export default class ResourceDataSecurity {
  /*
   * The resource, as the caller may read it: its name, or null when it is
   * not this project's or not theirs to read.
   */
  @CaptureSpan()
  public static async readResourceName(data: {
    projectId: ObjectID;
    kind: DataStoreResourceKind;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<string | null> {
    const query: { _id: string; projectId: ObjectID } = {
      _id: data.id.toString(),
      projectId: data.projectId,
    };

    switch (data.kind) {
      case DataStoreResourceKind.KubernetesCluster: {
        const cluster: KubernetesCluster | null =
          await KubernetesClusterService.findOneBy({
            query,
            select: { _id: true, name: true, clusterIdentifier: true },
            props: data.props,
          });

        return cluster
          ? cluster.name || cluster.clusterIdentifier || data.id.toString()
          : null;
      }
      case DataStoreResourceKind.DockerHost: {
        const host: DockerHost | null = await DockerHostService.findOneBy({
          query,
          select: { _id: true, name: true, hostIdentifier: true },
          props: data.props,
        });

        return host
          ? host.name || host.hostIdentifier || data.id.toString()
          : null;
      }
      case DataStoreResourceKind.PodmanHost: {
        const host: PodmanHost | null = await PodmanHostService.findOneBy({
          query,
          select: { _id: true, name: true, hostIdentifier: true },
          props: data.props,
        });

        return host
          ? host.name || host.hostIdentifier || data.id.toString()
          : null;
      }
      case DataStoreResourceKind.DatabaseServer: {
        const server: DatabaseServer | null =
          await DatabaseServerService.findOneBy({
            query,
            select: { _id: true, name: true, serverAddress: true },
            props: data.props,
          });

        return server
          ? server.name || server.serverAddress || data.id.toString()
          : null;
      }
      case DataStoreResourceKind.CloudResource: {
        const resource: CloudResource | null =
          await CloudResourceService.findOneBy({
            query,
            select: { _id: true, name: true, providerResourceId: true },
            props: data.props,
          });

        return resource
          ? resource.name || resource.providerResourceId || data.id.toString()
          : null;
      }
      case DataStoreResourceKind.Service: {
        const service: ServiceModel | null = await ServiceService.findOneBy({
          query,
          select: { _id: true, name: true },
          props: data.props,
        });

        return service ? service.name || data.id.toString() : null;
      }
      default:
        return null;
    }
  }

  /*
   * The stores a resource's pages show, not archived, the riskiest first:
   * its own, or - a cluster or a container host - the stores of the
   * databases running on it. One more than the limit is read, to know
   * whether the list was cut.
   */
  @CaptureSpan()
  public static async findResourceStores(data: {
    projectId: ObjectID;
    resource: DataStoreResourceRef;
    limit: number;
  }): Promise<Array<DataStore>> {
    const id: ObjectID = new ObjectID(data.resource.id);
    const select: {
      _id: true;
      cloudResourceId: true;
      serviceId: true;
      databaseServerId: true;
      dataTypeIds: true;
      subjectCountries: true;
      configurationReadAt: true;
      contentScannedAt: true;
    } = {
      _id: true,
      cloudResourceId: true,
      serviceId: true,
      databaseServerId: true,
      dataTypeIds: true,
      subjectCountries: true,
      configurationReadAt: true,
      contentScannedAt: true,
    };
    const base: { projectId: ObjectID; isArchived: false } = {
      projectId: data.projectId,
      isArchived: false,
    };
    let query: Record<string, unknown>;

    switch (data.resource.kind) {
      case DataStoreResourceKind.CloudResource:
        query = { ...base, cloudResourceId: id };
        break;
      case DataStoreResourceKind.Service:
        query = { ...base, serviceId: id };
        break;
      case DataStoreResourceKind.DatabaseServer:
        query = { ...base, databaseServerId: id };
        break;
      case DataStoreResourceKind.KubernetesCluster:
      case DataStoreResourceKind.DockerHost:
      case DataStoreResourceKind.PodmanHost: {
        const serverIds: Array<ObjectID> = await this.findPlatformDatabaseIds({
          projectId: data.projectId,
          platform: data.resource,
        });

        if (serverIds.length === 0) {
          return [];
        }

        query = { ...base, databaseServerId: new Includes(serverIds) };
        break;
      }
      default:
        return [];
    }

    return await DataStoreService.findBy({
      query: query as never,
      select,
      sort: { riskScore: SortOrder.Descending },
      skip: 0,
      limit: data.limit,
      props: { isRoot: true },
    });
  }

  // The databases running on a cluster or a container host.
  private static async findPlatformDatabaseIds(data: {
    projectId: ObjectID;
    platform: DataStoreResourceRef;
  }): Promise<Array<ObjectID>> {
    const id: ObjectID = new ObjectID(data.platform.id);
    const column: string =
      data.platform.kind === DataStoreResourceKind.KubernetesCluster
        ? "kubernetesClusterId"
        : data.platform.kind === DataStoreResourceKind.DockerHost
          ? "dockerHostId"
          : "podmanHostId";

    const servers: Array<DatabaseServer> = await DatabaseServerService.findBy({
      query: { projectId: data.projectId, [column]: id } as never,
      select: { _id: true },
      skip: 0,
      limit: MAX_PLATFORM_DATABASES,
      props: { isRoot: true },
    });

    return servers
      .map((server: DatabaseServer): ObjectID | null => {
        return server.id;
      })
      .filter((serverId: ObjectID | null): serverId is ObjectID => {
        return Boolean(serverId);
      });
  }

  /*
   * Each store with the resource its compliance is set on: a monitored
   * database's platform is read once for all of them.
   */
  @CaptureSpan()
  public static async toScopedStores(
    stores: Array<DataStore>,
  ): Promise<Array<ScopedStore>> {
    const serverIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const store of stores) {
      const serverId: string = store.databaseServerId?.toString() || "";

      if (serverId && !seen.has(serverId)) {
        seen.add(serverId);
        serverIds.push(store.databaseServerId!);
      }
    }

    const placements: Map<string, DatabaseServer> = new Map();

    for (let start: number = 0; start < serverIds.length; start += 500) {
      const servers: Array<DatabaseServer> = await DatabaseServerService.findBy(
        {
          query: { _id: new Includes(serverIds.slice(start, start + 500)) },
          select: {
            _id: true,
            kubernetesClusterId: true,
            dockerHostId: true,
            podmanHostId: true,
          },
          skip: 0,
          limit: 500,
          props: { isRoot: true },
        },
      );

      for (const server of servers) {
        if (server.id) {
          placements.set(server.id.toString(), server);
        }
      }
    }

    return stores
      .filter((store: DataStore): boolean => {
        return Boolean(store.id);
      })
      .map((store: DataStore): ScopedStore => {
        const server: DatabaseServer | undefined = store.databaseServerId
          ? placements.get(store.databaseServerId.toString())
          : undefined;

        return {
          id: store.id!.toString(),
          owner: getDataStoreComplianceOwner({
            cloudResourceId: store.cloudResourceId?.toString(),
            serviceId: store.serviceId?.toString(),
            databaseServerId: store.databaseServerId?.toString(),
            databaseServer: server
              ? {
                  kubernetesClusterId: server.kubernetesClusterId?.toString(),
                  dockerHostId: server.dockerHostId?.toString(),
                  podmanHostId: server.podmanHostId?.toString(),
                }
              : null,
          }),
          input: {
            id: store.id!.toString(),
            dataTypeIds: store.dataTypeIds || [],
            subjectCountries: store.subjectCountries || [],
            isEvaluated: Boolean(
              store.configurationReadAt || store.contentScannedAt,
            ),
          },
        };
      });
  }

  // What every resource of the project turned off, oldest first.
  @CaptureSpan()
  public static async readProjectSettings(
    projectId: ObjectID,
  ): Promise<Array<ComplianceScopeSetting>> {
    const rows: Array<DataSecurityComplianceSetting> =
      await DataSecurityComplianceSettingService.findBy({
        query: { projectId },
        select: {
          _id: true,
          resourceType: true,
          resourceId: true,
          framework: true,
          requirement: true,
          isEnabled: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });

    return rows
      .map(
        (row: DataSecurityComplianceSetting): ComplianceScopeSetting | null => {
          return readComplianceScopeSetting({
            resourceType: row.resourceType,
            resourceId: row.resourceId?.toString(),
            framework: row.framework,
            requirement: row.requirement,
            isEnabled: row.isEnabled,
          });
        },
      )
      .filter(
        (
          setting: ComplianceScopeSetting | null,
        ): setting is ComplianceScopeSetting => {
          return Boolean(setting);
        },
      );
  }

  /*
   * What is turned off, with why and by whom (#9629): every resource's of
   * the project, or one resource's, the latest first. Read as OneUptime -
   * the reader's right to see the resource is asked when it is named.
   */
  @CaptureSpan()
  public static async readTurnedOffSettings(data: {
    projectId: ObjectID;
    resource?: DataStoreResourceRef | undefined;
  }): Promise<Array<TurnedOffSetting>> {
    const rows: Array<DataSecurityComplianceSetting> =
      await DataSecurityComplianceSettingService.findBy({
        query: {
          projectId: data.projectId,
          isEnabled: false,
          ...(data.resource
            ? {
                resourceType: data.resource.kind,
                resourceId: new ObjectID(data.resource.id),
              }
            : {}),
        },
        select: {
          _id: true,
          resourceType: true,
          resourceId: true,
          framework: true,
          requirement: true,
          note: true,
          turnedOffAt: true,
          turnedOffByUser: { name: true, email: true },
        },
        sort: { updatedAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_SETTINGS,
        props: { isRoot: true },
      });

    const settings: Array<TurnedOffSetting> = [];

    for (const row of rows) {
      const setting: ComplianceScopeSetting | null = readComplianceScopeSetting(
        {
          resourceType: row.resourceType,
          resourceId: row.resourceId?.toString(),
          framework: row.framework,
          requirement: row.requirement,
          // Every row read is off: the query asked for no other.
          isEnabled: false,
        },
      );

      if (!setting || !row.id) {
        continue;
      }

      settings.push({
        id: row.id.toString(),
        resource: setting.resource,
        framework: setting.framework,
        requirement: setting.requirement || null,
        note: (row.note || "").trim(),
        turnedOffAt: row.turnedOffAt
          ? new Date(row.turnedOffAt).toISOString()
          : null,
        turnedOffBy:
          row.turnedOffByUser?.name?.toString() ||
          row.turnedOffByUser?.email?.toString() ||
          null,
      });
    }

    // The latest turned off first; one not known to have been goes last.
    return settings.sort((a: TurnedOffSetting, b: TurnedOffSetting): number => {
      return (b.turnedOffAt || "").localeCompare(a.turnedOffAt || "");
    });
  }

  /*
   * The resources settings name, as the reader may see them: each one that
   * still exists, named when the reader may read it and by its kind alone
   * ("") when not. One that no longer exists is left out: what it turned
   * off turns nothing off now. Keyed by getResourceKey.
   */
  @CaptureSpan()
  public static async nameResources(data: {
    projectId: ObjectID;
    resources: Array<DataStoreResourceRef>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    const idsByKind: Map<DataStoreResourceKind, Set<string>> = new Map();

    for (const resource of data.resources) {
      const ids: Set<string> = idsByKind.get(resource.kind) || new Set();
      ids.add(resource.id);
      idsByKind.set(resource.kind, ids);
    }

    for (const [kind, idSet] of idsByKind) {
      const ids: Array<string> = Array.from(idSet);
      // Which exist, as OneUptime; which the reader may read, as the reader.
      const existing: Map<string, string> = await this.readNamesOfKind({
        projectId: data.projectId,
        kind,
        ids,
        props: { isRoot: true },
      });
      let readable: Map<string, string> = new Map<string, string>();

      try {
        readable = await this.readNamesOfKind({
          projectId: data.projectId,
          kind,
          ids: ids.filter((id: string): boolean => {
            return existing.has(id);
          }),
          props: data.props,
        });
      } catch {
        // Not the reader's to read: each is named by its kind alone.
      }

      for (const id of existing.keys()) {
        names.set(getResourceKey({ kind, id }), readable.get(id) || "");
      }
    }

    return names;
  }

  // Some resources of one kind, by id, each with the name its pages give it.
  private static async readNamesOfKind(data: {
    projectId: ObjectID;
    kind: DataStoreResourceKind;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map<string, string>();

    if (data.ids.length === 0) {
      return names;
    }

    const query: { projectId: ObjectID; _id: Includes } = {
      projectId: data.projectId,
      _id: new Includes(
        data.ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
    };
    const page: { skip: number; limit: number } = {
      skip: 0,
      limit: data.ids.length,
    };
    const keep: (id: ObjectID | undefined | null, name: string) => void = (
      id: ObjectID | undefined | null,
      name: string,
    ): void => {
      if (id) {
        names.set(id.toString(), name || id.toString());
      }
    };

    switch (data.kind) {
      case DataStoreResourceKind.KubernetesCluster:
        for (const row of await KubernetesClusterService.findBy({
          query: query as never,
          select: { _id: true, name: true, clusterIdentifier: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || row.clusterIdentifier || "");
        }
        break;
      case DataStoreResourceKind.DockerHost:
        for (const row of await DockerHostService.findBy({
          query: query as never,
          select: { _id: true, name: true, hostIdentifier: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || row.hostIdentifier || "");
        }
        break;
      case DataStoreResourceKind.PodmanHost:
        for (const row of await PodmanHostService.findBy({
          query: query as never,
          select: { _id: true, name: true, hostIdentifier: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || row.hostIdentifier || "");
        }
        break;
      case DataStoreResourceKind.DatabaseServer:
        for (const row of await DatabaseServerService.findBy({
          query: query as never,
          select: { _id: true, name: true, serverAddress: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || row.serverAddress || "");
        }
        break;
      case DataStoreResourceKind.CloudResource:
        for (const row of await CloudResourceService.findBy({
          query: query as never,
          select: { _id: true, name: true, providerResourceId: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || row.providerResourceId || "");
        }
        break;
      case DataStoreResourceKind.Service:
        for (const row of await ServiceService.findBy({
          query: query as never,
          select: { _id: true, name: true },
          ...page,
          props: data.props,
        })) {
          keep(row.id, row.name || "");
        }
        break;
      default:
        break;
    }

    return names;
  }

  /*
   * Each framework with what is turned off of it, named: the latest first,
   * at most MAX_COMPLIANCE_TURNED_OFF, and none of a resource that is gone.
   */
  public static withTurnedOff<T extends DataSecurityComplianceFramework>(
    frameworks: Array<T>,
    settings: Array<TurnedOffSetting>,
    names: Map<string, string>,
  ): Array<T> {
    return frameworks.map((framework: T): T => {
      const turnedOff: Array<DataSecurityComplianceTurnedOff> = [];

      for (const setting of settings) {
        if (turnedOff.length >= MAX_COMPLIANCE_TURNED_OFF) {
          break;
        }

        const name: string | undefined = names.get(
          getResourceKey(setting.resource),
        );

        if (setting.framework !== framework.framework || name === undefined) {
          continue;
        }

        turnedOff.push({
          id: setting.id,
          resource: {
            kind: setting.resource.kind,
            id: setting.resource.id,
            name,
          },
          requirement: setting.requirement,
          note: setting.note,
          turnedOffAt: setting.turnedOffAt,
          turnedOffBy: setting.turnedOffBy,
        });
      }

      return { ...framework, turnedOff };
    });
  }

  // The open issues on some stores, as compliance scores them.
  @CaptureSpan()
  public static async readOpenIssues(data: {
    projectId: ObjectID;
    storeIds?: Array<string> | undefined;
  }): Promise<Array<ComplianceIssueInput>> {
    if (data.storeIds && data.storeIds.length === 0) {
      return [];
    }

    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          status: DataSecurityIssueStatus.Open,
          ...(data.storeIds
            ? {
                dataStoreId: new Includes(
                  data.storeIds.map((id: string): ObjectID => {
                    return new ObjectID(id);
                  }),
                ),
              }
            : {}),
        },
        select: { dataStoreId: true, checkId: true },
        skip: 0,
        limit: MAX_ISSUES,
        props: { isRoot: true },
      });

    return issues.map((issue: DataSecurityIssue): ComplianceIssueInput => {
      return {
        storeId: issue.dataStoreId?.toString() || "",
        checkId: issue.checkId || "",
      };
    });
  }

  /*
   * Every framework, scored over the stores given, with what their owners
   * turned off: the project's Compliance page asks with every store of the
   * project, a resource's with the stores whose compliance it owns.
   */
  public static scoreFrameworks(data: {
    stores: Array<ScopedStore>;
    issues: Array<ComplianceIssueInput>;
    settings: Array<ComplianceScopeSetting>;
  }): Array<DataSecurityComplianceFramework> {
    const inputs: Array<ComplianceStoreInput> = data.stores.map(
      (store: ScopedStore): ComplianceStoreInput => {
        return store.input;
      },
    );
    const scopeStores: Array<ComplianceScopeStore> = data.stores.map(
      (store: ScopedStore): ComplianceScopeStore => {
        return { id: store.id, owner: store.owner };
      },
    );

    return ALL_COMPLIANCE_FRAMEWORKS.map(
      (framework: ComplianceFramework): DataSecurityComplianceFramework => {
        return {
          ...scoreComplianceFramework(
            framework,
            inputs,
            data.issues,
            getComplianceScopeExclusions(framework, scopeStores, data.settings),
          ),
          fullName: COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
          scope: COMPLIANCE_FRAMEWORK_INFO[framework].scope,
        };
      },
    );
  }

  /*
   * What a resource's Data Security and Compliance pages read under: every
   * store its pages show, the ones whose compliance it owns and, for a
   * database on a cluster or a container host, where its compliance is set.
   * Null when the caller may not read the resource.
   */
  @CaptureSpan()
  public static async readScope(data: {
    projectId: ObjectID;
    kind: DataStoreResourceKind;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityResourceScope | null> {
    const name: string | null = await this.readResourceName(data);

    if (name === null) {
      return null;
    }

    const resource: DataStoreResourceRef = {
      kind: data.kind,
      id: data.id.toString(),
    };
    const stores: Array<DataStore> = await this.findResourceStores({
      projectId: data.projectId,
      resource,
      limit: MAX_RESOURCE_SCOPE_STORES + 1,
    });
    const listed: Array<DataStore> = stores.slice(0, MAX_RESOURCE_SCOPE_STORES);
    const scoped: Array<ScopedStore> = await this.toScopedStores(listed);
    const owned: Array<ScopedStore> = scoped.filter(
      (store: ScopedStore): boolean => {
        return isSameDataStoreResource(store.owner, resource);
      },
    );

    return {
      kind: data.kind,
      id: data.id.toString(),
      name,
      dataStoreIds: scoped.map((store: ScopedStore): string => {
        return store.id;
      }),
      ownedDataStoreIds: owned.map((store: ScopedStore): string => {
        return store.id;
      }),
      complianceOwner: await this.readComplianceOwner({
        ...data,
        resource,
        scoped,
      }),
      isTruncated: stores.length > MAX_RESOURCE_SCOPE_STORES,
    };
  }

  /*
   * A database's compliance is set on the cluster or container host it
   * runs on: that one, named as the caller may read it, or null when the
   * resource owns its stores' compliance itself.
   */
  private static async readComplianceOwner(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    resource: DataStoreResourceRef;
    scoped: Array<ScopedStore>;
  }): Promise<DataSecurityResourceRef | null> {
    if (data.resource.kind !== DataStoreResourceKind.DatabaseServer) {
      return null;
    }

    let platform: DataStoreResourceRef | null =
      data.scoped.find((store: ScopedStore): boolean => {
        return Boolean(
          store.owner &&
            !isSameDataStoreResource(store.owner, data.resource) &&
            store.owner.kind !== DataStoreResourceKind.DatabaseServer,
        );
      })?.owner || null;

    if (!platform) {
      // A database with no store yet still runs where it runs.
      const server: DatabaseServer | null =
        await DatabaseServerService.findOneBy({
          query: { _id: data.resource.id, projectId: data.projectId },
          select: {
            _id: true,
            kubernetesClusterId: true,
            dockerHostId: true,
            podmanHostId: true,
          },
          props: { isRoot: true },
        });

      platform = getDatabasePlatform(
        server
          ? {
              kubernetesClusterId: server.kubernetesClusterId?.toString(),
              dockerHostId: server.dockerHostId?.toString(),
              podmanHostId: server.podmanHostId?.toString(),
            }
          : null,
      );
    }

    if (!platform) {
      return null;
    }

    let name: string = "";

    try {
      name =
        (await this.readResourceName({
          projectId: data.projectId,
          kind: platform.kind,
          id: new ObjectID(platform.id),
          props: data.props,
        })) || "";
    } catch {
      // Not the caller's to read: the page names it by its kind alone.
      name = "";
    }

    return { kind: platform.kind, id: platform.id, name };
  }

  /*
   * A resource's Compliance page: every framework scored over the resource's
   * stores, each with what its owner turned off, and what is turned off of
   * each framework where the resource's compliance is set - on the resource
   * itself, or, for a database running on a cluster or a container host, on
   * that cluster or host (complianceOwner), whose page changes it. Null when
   * the caller may not read the resource.
   */
  @CaptureSpan()
  public static async readCompliance(data: {
    projectId: ObjectID;
    kind: DataStoreResourceKind;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityResourceComplianceResponse | null> {
    const name: string | null = await this.readResourceName(data);

    if (name === null) {
      return null;
    }

    const resource: DataStoreResourceRef = {
      kind: data.kind,
      id: data.id.toString(),
    };
    const stores: Array<DataStore> = await this.findResourceStores({
      projectId: data.projectId,
      resource,
      limit: MAX_STORES,
    });
    const scoped: Array<ScopedStore> = await this.toScopedStores(stores);
    const complianceOwner: DataSecurityResourceRef | null =
      await this.readComplianceOwner({
        projectId: data.projectId,
        props: data.props,
        resource,
        scoped,
      });
    // Where what is turned off is set: here, or on the cluster or host the database runs on.
    const settingsResource: DataStoreResourceRef = complianceOwner
      ? { kind: complianceOwner.kind, id: complianceOwner.id }
      : resource;
    const settings: Array<ComplianceScopeSetting> =
      await this.readProjectSettings(data.projectId);
    const issues: Array<ComplianceIssueInput> = await this.readOpenIssues({
      projectId: data.projectId,
      storeIds: scoped.map((store: ScopedStore): string => {
        return store.id;
      }),
    });
    /*
     * Why each is off, and who turned it off when (#9629): the settings of
     * where the compliance is set, named as this page names it.
     */
    const turnedOff: Array<TurnedOffSetting> = await this.readTurnedOffSettings(
      {
        projectId: data.projectId,
        resource: settingsResource,
      },
    );
    const settingsResourceName: Map<string, string> = new Map<string, string>([
      [
        getResourceKey(settingsResource),
        complianceOwner ? complianceOwner.name : name,
      ],
    ]);

    return {
      kind: data.kind,
      id: data.id.toString(),
      name,
      storeCount: scoped.length,
      complianceOwner,
      frameworks: this.withTurnedOff(
        this.scoreFrameworks({
          stores: scoped,
          issues,
          settings,
        }).map(
          (
            framework: DataSecurityComplianceFramework,
          ): DataSecurityResourceComplianceFramework => {
            const scope: ResourceFrameworkScope = getResourceFrameworkScope(
              settingsResource,
              framework.framework,
              settings,
            );

            return {
              ...framework,
              isTurnedOff: scope.isTurnedOff,
              turnedOffRequirements: scope.turnedOffRequirements,
            };
          },
        ),
        turnedOff,
        settingsResourceName,
      ),
    };
  }

  /*
   * The project's Compliance page: every framework over every store of the
   * project, with what each store's resource turned off - and, for a
   * reader, each of those settings with why and by whom, its resource
   * named as they may see it (#9629).
   */
  @CaptureSpan()
  public static async readProjectCompliance(
    projectId: ObjectID,
    props?: DatabaseCommonInteractionProps | undefined,
  ): Promise<Array<DataSecurityComplianceFramework>> {
    const frameworks: Array<DataSecurityComplianceFramework> =
      await this.scoreProjectCompliance(projectId);

    if (!props) {
      return frameworks;
    }

    const turnedOff: Array<TurnedOffSetting> = await this.readTurnedOffSettings(
      { projectId },
    );

    if (turnedOff.length === 0) {
      return this.withTurnedOff(frameworks, [], new Map<string, string>());
    }

    const names: Map<string, string> = await this.nameResources({
      projectId,
      resources: turnedOff.map(
        (setting: TurnedOffSetting): DataStoreResourceRef => {
          return setting.resource;
        },
      ),
      props,
    });

    return this.withTurnedOff(frameworks, turnedOff, names);
  }

  // Every framework over every store of the project, with what each store's resource turned off.
  private static async scoreProjectCompliance(
    projectId: ObjectID,
  ): Promise<Array<DataSecurityComplianceFramework>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: { projectId, isArchived: false },
      select: {
        _id: true,
        cloudResourceId: true,
        serviceId: true,
        databaseServerId: true,
        dataTypeIds: true,
        subjectCountries: true,
        configurationReadAt: true,
        contentScannedAt: true,
      },
      skip: 0,
      limit: MAX_STORES,
      props: { isRoot: true },
    });
    const issues: Array<ComplianceIssueInput> = await this.readOpenIssues({
      projectId,
    });
    const settings: Array<ComplianceScopeSetting> =
      await this.readProjectSettings(projectId);

    /*
     * With nothing turned off anywhere, no store's owner matters: the
     * databases' placements are read only when a setting needs them.
     */
    const scoped: Array<ScopedStore> =
      settings.length > 0
        ? await this.toScopedStores(stores)
        : stores
            .filter((store: DataStore): boolean => {
              return Boolean(store.id);
            })
            .map((store: DataStore): ScopedStore => {
              return {
                id: store.id!.toString(),
                owner: null,
                input: {
                  id: store.id!.toString(),
                  dataTypeIds: store.dataTypeIds || [],
                  subjectCountries: store.subjectCountries || [],
                  isEvaluated: Boolean(
                    store.configurationReadAt || store.contentScannedAt,
                  ),
                },
              };
            });

    return this.scoreFrameworks({ stores: scoped, issues, settings });
  }
}
