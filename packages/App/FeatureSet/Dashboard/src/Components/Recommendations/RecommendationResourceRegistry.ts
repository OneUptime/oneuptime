import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Service from "Common/Models/DatabaseModels/Service";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import CloudApp from "Common/Models/DatabaseModels/CloudApp";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { getCloudAppTelemetryFilters } from "../../Pages/AppPlatforms/Utils/CloudApps";
import { isCloudAppTelemetryScoped } from "Common/Types/Monitor/CloudAppAlertTemplates";
import MonitorRecommendationCreateUtil from "./MonitorRecommendationCreateUtil";
import {
  CloudAlertTemplate,
  getCloudAlertTemplatesFor,
  getCloudAlertTemplatesForType,
  getCloudMonitoringServiceName,
  readAllocatedStorageGiB,
  readCloudTelemetryAttributes,
} from "Common/Types/Monitor/CloudAlertTemplates";
import { readCloudResourceReadings } from "Common/Types/Cloud/CloudResourceHealth";
import { AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE } from "Common/Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  RDS_CONNECTION_ENGINE_NAMES,
  RDS_DB_INSTANCE_TYPE,
  RdsConnectionLimitGap,
  RdsConnectionLimitReading,
  readRdsConnectionLimit,
} from "Common/Types/Cloud/RdsConnectionLimits";
import { getCloudResourceTypeDisplayName } from "Common/Types/Cloud/CloudResourceCatalog";
import { getDatabaseAlertTemplates } from "Common/Types/Monitor/DatabaseAlertTemplates";
import { getDatabaseSystemDisplayName } from "Common/Types/DatabaseServer/DatabaseSystem";
import { OPENSHIFT_KUBERNETES_PROVIDER } from "Common/Types/Kubernetes/KubernetesClusterProvider";
import { StorageSystemUtil } from "Common/Types/StorageArray/StorageSystem";
import {
  DATABASE_ENGINE_METRICS_LOOKBACK_DAYS,
  fetchDatabaseEngineMetricsArrived,
  getDatabaseRecommendationReceivers,
} from "../../Pages/Database/Utils/DatabaseEngineMetricsProbe";
import TechStack from "Common/Types/Service/TechStack";
import {
  SERVICE_LANGUAGE_DISPLAY_NAMES,
  detectServiceLanguage,
} from "Common/Types/Service/ServiceLanguage";
import {
  MonitorRecommendationContext,
  MonitorRecommendationResourceType,
} from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  Translator,
  getGlobalTranslator,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import { getOpenStackOptionalServicesOf } from "Common/Types/OpenStack/OpenStackOptionalServices";
import {
  OPENSTACK_SERVICE_TITLES,
  OpenStackServiceType,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackChecksOn,
  OpenStackInventorySummary,
  fetchOpenStackChecksOn,
  fetchOpenStackInventorySummary,
} from "../../Pages/OpenStack/Utils/OpenStackResourceUtils";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";

/*
 * The App-side half of the recommendation registry.
 *
 * `MonitorRecommendationCatalog` in Common knows what to recommend for a
 * resource type. It cannot know which Postgres model that resource type is,
 * or which of that model's columns carries the identifier the telemetry is
 * tagged with — those are dashboard concerns. Before this file, that knowledge
 * was copy-pasted into nearly identical `View/Recommendations.tsx` pages
 * (fetch the model, read one field, pass three props), and there was no way
 * for anything else — like a side-menu count badge — to ask the same question
 * without a ninth copy.
 *
 * A resource type missing from this table renders no recommendations and no
 * badge, silently. `RecommendationResourceRegistry.test.ts` enumerates the
 * ENUM rather than this table, so adding a member to
 * `MonitorRecommendationResourceType` fails there until it is wired up here.
 */
export interface RecommendationResourceDefinition {
  resourceType: MonitorRecommendationResourceType;
  modelType: { new (): BaseModel };
  /*
   * The column whose value the monitor step is scoped to. It MUST be the same
   * value existing monitors were created with, or the already-created diff
   * finds nothing and every recommendation reappears as available.
   *
   * Note this is not uniform: the four resources that ship an agent-reported
   * identifier use it, and the four that do not fall back to `name`. That is
   * the behaviour the individual pages already had — see the table below.
   */
  identifierFieldName: string;
  // The column used to name created monitors, e.g. "prod-cluster - Job Failures".
  displayNameFieldName: string;
  /*
   * Extra columns to fetch because `readContext` reads them.
   *
   * Declared separately from the reader, rather than being implied by it, so
   * that `getSelect` and `readContext` cannot drift apart. A column that is
   * read but never selected comes back `undefined`, and `undefined` here does
   * not throw — it quietly downgrades a Java service to the language-agnostic
   * recommendations, on a page that otherwise looks completely normal.
   */
  contextFieldNames?: Array<string> | undefined;
  /*
   * What this resource type knows about ONE of its resources that changes
   * which recommendations apply. Absent for the resource types whose
   * recommendation set is a constant.
   */
  readContext?:
    | ((model: BaseModel) => MonitorRecommendationContext)
    | undefined;
  /*
   * What the fetched row cannot answer on its own: an async refinement of
   * `readContext`'s answer from telemetry, run by the static `loadContext`.
   * Absent for the resource types whose row says everything.
   */
  loadContext?:
    | ((data: {
        model: BaseModel;
        context: MonitorRecommendationContext;
      }) => Promise<MonitorRecommendationContext>)
    | undefined;
  /*
   * One sentence explaining what the context did to the list, for the page to
   * show above it.
   *
   * Without it the language filter is invisible: a service whose runtime was
   * never reported renders eight cards and a service on the JVM renders
   * fourteen, and nothing on either page says why. The user with eight cards
   * has no way to tell whether that is all OneUptime has or whether they are
   * missing something — and the answer ("your SDK has not told us what you run
   * on") is one they can act on.
   */
  describeContext?:
    | ((context: MonitorRecommendationContext) => string | undefined)
    | undefined;
  /*
   * How to read ONE resource when its model cannot be read with the
   * person's own permissions. A data store is Data Security's record,
   * readable by the Security tiers only, while anyone who may read Data
   * Observability may see its recommendations - so it is read from Data
   * Observability's own route, which hands back what they need: its id and
   * its name. Absent for every resource type its own model's read serves.
   */
  loadResource?:
    | ((resourceId: ObjectID) => Promise<BaseModel | null>)
    | undefined;
  /*
   * What the card says the recommendations are drawn from, when it is not
   * what an agent sends: a cloud resource's come from what its cloud's
   * monitoring reports about it. Absent: the card's own words.
   */
  getCardDescription?:
    | ((context: MonitorRecommendationContext) => string | undefined)
    | undefined;
  /*
   * What a monitor created from one of its recommendations is linked to,
   * beside the scope its step carries: a cloud resource's monitors hold it
   * in their Linked Resources (Monitor.cloudResources), so the monitor's
   * page names it, its incidents and alerts are linked to it, and its own
   * page lists them. Absent for the resource types a monitor names in its
   * step alone.
   */
  linkCreatedMonitor?:
    | ((data: {
        monitor: Monitor;
        resourceId: ObjectID;
        context: MonitorRecommendationContext;
      }) => void)
    | undefined;
}

/*
 * What an App Platforms app's row says that decides its recommendations:
 * its own attributes and the environment it runs in. Its environment's
 * cloud.* attributes complete its telemetry filter
 * (loadCloudAppRecommendationContext); read alone, an app is offered
 * nothing yet.
 */
export function readCloudAppRecommendationContext(
  record: Record<string, unknown>,
): MonitorRecommendationContext {
  const environmentId: unknown = record["cloudResourceId"];

  return {
    cloudAppEnvironmentId:
      environmentId && String(environmentId).trim()
        ? String(environmentId).trim()
        : null,
    // The app's own attributes; its environment's are added on load.
    cloudAppTelemetryFilters: getCloudAppTelemetryFilters({
      environment: null,
      app: {
        telemetryAttributes: record["telemetryAttributes"] as
          | Record<string, unknown>
          | undefined,
      },
    }),
  };
}

/*
 * The app's telemetry filter, completed with its environment's platform,
 * account and Region, as its Traces tab filters its spans. The environment
 * is read with the person's own rights; a read that fails keeps the row's
 * context (RecommendationResourceRegistry.loadContext), which has no
 * platform, so the app is offered nothing - never an unscoped monitor.
 */
export async function loadCloudAppRecommendationContext(data: {
  model: BaseModel;
  context: MonitorRecommendationContext;
}): Promise<MonitorRecommendationContext> {
  if (!data.context.cloudAppEnvironmentId) {
    return data.context;
  }

  // Imported here: its client reads the browser's config as it loads.
  const modelApi: typeof import("Common/UI/Utils/ModelAPI/ModelAPI") =
    await import("Common/UI/Utils/ModelAPI/ModelAPI");

  const environment: CloudResource | null = await modelApi.default.getItem({
    modelType: CloudResource,
    id: new ObjectID(data.context.cloudAppEnvironmentId),
    select: { cloudPlatform: true, cloudAccountId: true, cloudRegion: true },
  });

  if (!environment) {
    return data.context;
  }

  const record: Record<string, unknown> = data.model as unknown as Record<
    string,
    unknown
  >;

  return {
    ...data.context,
    cloudAppTelemetryFilters: getCloudAppTelemetryFilters({
      environment: {
        cloudPlatform: environment.cloudPlatform as string | undefined,
        cloudAccountId: environment.cloudAccountId as string | undefined,
        cloudRegion: environment.cloudRegion as string | undefined,
      },
      app: {
        telemetryAttributes: record["telemetryAttributes"] as
          | Record<string, unknown>
          | undefined,
      },
    }),
  };
}

// Why an app is offered nothing, or undefined when it is offered them all.
export function describeCloudAppRecommendationContext(
  context: MonitorRecommendationContext,
): string | undefined {
  if (isCloudAppTelemetryScoped(context.cloudAppTelemetryFilters)) {
    return undefined;
  }

  // The app's own attributes: every key but its environment's cloud.* ones.
  const hasOwnAttributes: boolean = Object.keys(
    context.cloudAppTelemetryFilters || {},
  ).some((key: string): boolean => {
    return !key.startsWith("resource.cloud.");
  });

  return hasOwnAttributes
    ? translateTemplate(
        "Its environment's platform is not known yet, and every recommended monitor reads the app's telemetry by it, so none is offered until it is.",
      )
    : translateTemplate(
        "This app's name is too long to filter its telemetry by, so no monitor can watch it alone. Its environment's telemetry is in the environment's tabs.",
      );
}

// Whether a cloud resource is an RDS DB instance: the one type with a connection limit.
function isRdsDbInstance(provider: unknown, resourceType: unknown): boolean {
  return (
    typeof provider === "string" &&
    typeof resourceType === "string" &&
    provider.trim().toLowerCase() === CloudProvider.AWS &&
    resourceType.trim().toLowerCase() === RDS_DB_INSTANCE_TYPE.toLowerCase()
  );
}

/*
 * What a cloud resource's row says that decides its recommendations
 * (getCloudAlertTemplatesFor): its cloud and type, the attributes its
 * metrics are stored with, its readings (an Azure metric's stored name)
 * and, for an RDS instance, its allocated storage and its connection limit
 * (from its class, engine and parameter group). Shared by a resource's
 * Recommendations tab and its account's, which read every resource the
 * same way.
 */
export function readCloudResourceRecommendationContext(
  record: Record<string, unknown>,
): MonitorRecommendationContext {
  const provider: unknown = record["cloudProvider"];
  const resourceType: unknown = record["cloudResourceType"];
  const connectionId: unknown = record["cloudConnectionId"];

  return {
    cloudProvider: typeof provider === "string" ? provider : null,
    cloudResourceType: typeof resourceType === "string" ? resourceType : null,
    cloudTelemetryAttributes: readCloudTelemetryAttributes(
      record["telemetryAttributes"],
    ),
    cloudReadings: readCloudResourceReadings(record["cloudReadings"]),
    cloudAllocatedStorageGiB: readAllocatedStorageGiB(
      record["cloudProperties"],
    ),
    // Only an RDS instance's: no other resource's templates read one.
    ...(isRdsDbInstance(provider, resourceType)
      ? {
          cloudConnectionLimit: readRdsConnectionLimit(
            record["cloudProperties"],
          ),
        }
      : {}),
    // An ObjectID on a read row, a string in a plain record.
    cloudReadByConnection: Boolean(connectionId && String(connectionId).trim()),
  };
}

/*
 * What an RDS instance's page says of its Connections Near the Limit: why
 * it waits or is not offered, or - when its parameter group is one of the
 * team's own, which may set max_connections - the limit its line is a
 * share of, so they can check it. Nothing when the class's default is the
 * limit (an engine's default group) or nothing is known of the group.
 */
function describeCloudConnectionLimit(
  reading: RdsConnectionLimitReading | null | undefined,
): string | undefined {
  if (!reading) {
    return undefined;
  }

  /*
   * Its class, engine and group are names as AWS writes them, set apart in
   * a sentence read right to left, so their dots never move the words.
   */
  const translator: Translator = getGlobalTranslator();

  if (reading.limit) {
    if (!reading.limit.isOwnParameterGroup) {
      return undefined;
    }

    return translator.translateTemplate(
      "Connections Near the Limit alerts at 90% of {{limit}}, the default connection limit of a {{instanceClass}} instance running {{engine}}. Its parameter group, {{parameterGroup}}, is one of your own: if it sets max_connections, change the monitor's threshold to 90% of that.",
      {
        limit: translator.formatNumber(reading.limit.limit),
        instanceClass: reading.limit.instanceClass,
        engine: RDS_CONNECTION_ENGINE_NAMES[reading.limit.engine],
        parameterGroup: reading.limit.parameterGroup || "",
      },
      { setsValuesApart: true },
    );
  }

  switch (reading.gap) {
    case RdsConnectionLimitGap.NotListed:
      return translator.translateTemplate(
        "Connections Near the Limit is offered once the account's inventory lists the instance's class and engine.",
      );
    case RdsConnectionLimitGap.UnknownClass:
      return translator.translateTemplate(
        "Connections Near the Limit is not offered: OneUptime does not know the connection limit of a {{instanceClass}} instance yet. To alert on its connections, open DatabaseConnections on its Metrics tab and create a monitor from the view.",
        { instanceClass: reading.instanceClass || "" },
        { setsValuesApart: true },
      );
    case RdsConnectionLimitGap.NoClassLimit:
      return translator.translateTemplate(
        "Connections Near the Limit is for MySQL, MariaDB, PostgreSQL and Aurora, whose connection limit follows their class. To alert on the connections of an instance running {{engine}}, open DatabaseConnections on its Metrics tab and create a monitor from the view.",
        { engine: reading.engine || "" },
        { setsValuesApart: true },
      );
    default:
      return undefined;
  }
}

// A sentence's end in the languages that write no space after one: Chinese and Japanese.
const FULL_WIDTH_SENTENCE_END: RegExp = /[\u3002\uff01\uff1f]$/u;

// Sentences one after another, the way the reader's language joins them.
export function joinCloudRecommendationNotes(
  notes: Array<string>,
): string | undefined {
  let text: string = "";

  for (const note of notes) {
    if (!text) {
      text = note;
    } else {
      text = FULL_WIDTH_SENTENCE_END.test(text)
        ? `${text}${note}`
        : `${text} ${note}`;
    }
  }

  return text || undefined;
}

/*
 * Why a cloud resource is offered fewer recommendations than its type has,
 * or none - said only then: a resource offered all of them needs no note.
 */
export function describeCloudResourceRecommendationContext(
  context: MonitorRecommendationContext,
): string | undefined {
  const forType: Array<CloudAlertTemplate> = getCloudAlertTemplatesForType({
    provider: context.cloudProvider,
    resourceType: context.cloudResourceType,
  });

  if (forType.length === 0) {
    return translateTemplate(
      "OneUptime has no recommended monitors for {{type}} yet. You can still alert on it: open a metric on its Metrics tab and create a monitor from the view.",
      {
        type: getCloudResourceTypeDisplayName(
          context.cloudProvider,
          context.cloudResourceType,
        ),
      },
    );
  }

  const attributes: Record<string, string> = readCloudTelemetryAttributes(
    context.cloudTelemetryAttributes,
  );

  if (Object.keys(attributes).length === 0) {
    return translateTemplate(
      "Its metrics have not arrived yet, and every recommended monitor reads them, so none is offered until its connection reads them.",
    );
  }

  const offered: Array<CloudAlertTemplate> = getCloudAlertTemplatesFor({
    provider: context.cloudProvider,
    resourceType: context.cloudResourceType,
    telemetryAttributes: attributes,
    allocatedStorageGiB: context.cloudAllocatedStorageGiB,
    connectionLimit: context.cloudConnectionLimit?.limit?.limit,
    readings: context.cloudReadings,
    isReadByConnection: context.cloudReadByConnection === true,
  });

  /*
   * An Azure resource its connection read before readings kept the names
   * its metrics are stored under: its templates wait for the next read
   * (getCloudAlertTemplatesFor), a few minutes away.
   */
  if (
    (context.cloudProvider || "").toLowerCase() === CloudProvider.Azure &&
    context.cloudReadByConnection === true &&
    offered.length === 0
  ) {
    return translateTemplate(
      "Its recommended monitors are offered once its connection reads its metrics again, within a few minutes.",
    );
  }

  if (
    (context.cloudProvider || "").toLowerCase() === CloudProvider.AWS &&
    offered.length === 0
  ) {
    const namespace: string | undefined =
      attributes[AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE];

    return namespace
      ? translateTemplate(
          "OneUptime has no recommended monitors for the metrics this resource reports ({{namespace}}) yet. You can still alert on it: open a metric on its Metrics tab and create a monitor from the view.",
          { namespace: namespace },
        )
      : translateTemplate(
          "Its metrics arrive in CloudWatch's JSON stream format, which these monitors do not read. Stream the account through Cloud > Connect, and they are offered here.",
        );
  }

  const isStorageWaiting: boolean =
    forType.some((template: CloudAlertTemplate): boolean => {
      return Boolean(template.requiresAllocatedStorage);
    }) &&
    !offered.some((template: CloudAlertTemplate): boolean => {
      return Boolean(template.requiresAllocatedStorage);
    });
  const connectionNote: string | undefined = forType.some(
    (template: CloudAlertTemplate): boolean => {
      return Boolean(template.requiresConnectionLimit);
    },
  )
    ? describeCloudConnectionLimit(context.cloudConnectionLimit)
    : undefined;

  // An instance the inventory has not listed: both wait for it, said once.
  if (
    isStorageWaiting &&
    context.cloudConnectionLimit?.gap === RdsConnectionLimitGap.NotListed
  ) {
    return translateTemplate(
      "Low Free Storage and Connections Near the Limit are offered once the account's inventory lists the instance.",
    );
  }

  const notes: Array<string> = [];

  if (isStorageWaiting) {
    notes.push(
      translateTemplate(
        "Low Free Storage is offered once the account's inventory lists the instance's allocated storage.",
      ),
    );
  }

  if (connectionNote) {
    notes.push(connectionNote);
  }

  return joinCloudRecommendationNotes(notes);
}

/*
 * A RUM application's monthly budget as the catalog reads it: a finite number
 * above 0, or null for none. The column is numeric, but JSON off the wire is
 * not type checked, so a numeric string counts too ("10" is a budget of 10);
 * blank, 0, a negative, NaN and anything that is not a number are no budget.
 */
function readSessionReplayMonthlyBudgetInGB(value: unknown): number | null {
  let budgetInGB: number | null = null;

  if (typeof value === "number") {
    budgetInGB = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    budgetInGB = Number(value);
  }

  if (budgetInGB === null || !Number.isFinite(budgetInGB) || budgetInGB <= 0) {
    return null;
  }

  return budgetInGB;
}

/*
 * Which column each resource type scopes its monitors by, and why they differ:
 *
 *   Kubernetes  clusterIdentifier  agent-reported, stable across renames
 *   Host        hostIdentifier     agent-reported
 *   Docker      hostIdentifier     agent-reported
 *   Podman      hostIdentifier     agent-reported
 *   DockerSwarm name               model has no identifier column
 *   Proxmox     name               model has no identifier column
 *   VMware      name               VMwareVCenter.name IS the agent-stamped
 *                                  `vmware.vcenter.name` attribute
 *   Ceph        name               model has no identifier column
 *   StorageArray name              StorageArray.name IS the agent-stamped
 *                                  `storage.array.name` attribute
 *   IoTDevice   name               IoTFleet has no identifier column
 *   RUM         _id                Metric/Span/Exception.primaryEntityId is
 *                                  the RumApplication row id
 *   Service     _id                same — primaryEntityId is the Service row
 *                                  id for OpenTelemetry telemetry
 *   Database    _id                the `oneuptime.database.server.id` stamp
 *                                  every template query filters on is the
 *                                  DatabaseServer row id
 *   DataStore   _id                the `oneuptime.data.store.id` stamp table
 *                                  health writes on every row is the
 *                                  DataStore row id
 *   DataPipeline _id               the `oneuptime.data.pipeline.id` each
 *                                  run's metrics carry is the DataPipeline
 *                                  row id
 *   CloudResource _id              every template's queries name the
 *                                  CloudResource row in their event scope
 *                                  (eventScope.cloudResourceId), beside the
 *                                  attributes its metrics are stored with
 *
 * The six `name` rows mean renaming one of those resources orphans its
 * existing monitors from the diff — they will show as available again. That is
 * pre-existing behaviour inherited from the per-page wiring, faithfully
 * preserved here rather than quietly changed: switching them to a different
 * column would break the diff for every monitor already created.
 */
const RESOURCE_DEFINITIONS: Array<RecommendationResourceDefinition> = [
  {
    resourceType: MonitorRecommendationResourceType.Kubernetes,
    modelType: KubernetesCluster,
    identifierFieldName: "clusterIdentifier",
    displayNameFieldName: "name",
    /*
     * An OpenShift cluster is offered OpenShift's alerts too: ingest writes
     * `provider` from the cluster's telemetry, and every other cluster is
     * offered what it always was.
     */
    contextFieldNames: ["provider"],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      const provider: unknown = (model as unknown as Record<string, unknown>)[
        "provider"
      ];

      return {
        kubernetesProvider: typeof provider === "string" ? provider : null,
      };
    },
    /*
     * Said only where the provider changed the list, by the catalog's own
     * test: an OpenShift cluster's operator and update alerts. Every other
     * cluster is offered what every cluster is, which needs no note.
     */
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      if (context.kubernetesProvider !== OPENSHIFT_KUBERNETES_PROVIDER) {
        return undefined;
      }

      return translateTemplate(
        "This cluster runs OpenShift, so the recommendations below include alerts on its cluster operators and its cluster updates.",
      );
    },
  },
  {
    resourceType: MonitorRecommendationResourceType.Host,
    modelType: Host,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Docker,
    modelType: DockerHost,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.DockerSwarm,
    modelType: DockerSwarmCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Podman,
    modelType: PodmanHost,
    identifierFieldName: "hostIdentifier",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Proxmox,
    modelType: ProxmoxCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  /*
   * Some of an OpenStack cloud's recommendations need a service it may not run, or a series only a
   * probe sends (OpenStackAlertTemplate.forService, requiresProbe). Its row says how it is collected,
   * and only its inventory says what it runs: asked for whole, not a region at a time, because a
   * monitor is for the cloud. A read that fails leaves them withheld, which is what the page shows
   * anyway on a cloud that has none of them.
   */
  {
    resourceType: MonitorRecommendationResourceType.OpenStack,
    modelType: OpenStackCloud,
    identifierFieldName: "name",
    displayNameFieldName: "name",
    contextFieldNames: ["collectionMethod"],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      return {
        openStackIsCollectedByProbe:
          (model as unknown as Record<string, unknown>)["collectionMethod"] ===
          OpenStackCollectionMethod.Probe,
      };
    },
    loadContext: async (data: {
      model: BaseModel;
      context: MonitorRecommendationContext;
    }): Promise<MonitorRecommendationContext> => {
      const [summary, checks]: [
        OpenStackInventorySummary | null,
        OpenStackChecksOn,
      ] = await Promise.all([
        fetchOpenStackInventorySummary(data.model.id as ObjectID),
        fetchOpenStackChecksOn(data.model.id as ObjectID),
      ]);
      return {
        ...data.context,
        /*
         * A service that has never let this credential in has nothing for its alerts to read but its
         * API, and that would read down for as long as the credential stays as it is.
         */
        openStackServices: summary
          ? getOpenStackOptionalServicesOf(summary.services).filter(
              (service: string): boolean => {
                return !summary.closedServices.includes(service);
              },
            )
          : null,
        openStackIsApiCheckOn: checks.isApiCheckOn,
        openStackIsLifecycleCheckOn: checks.isLifecycleCheckOn,
      };
    },
    /*
     * Said only where what a cloud runs changed the list. A cloud without them is offered what
     * every cloud is, which needs no note, and is told nothing about what it doesn't run.
     */
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      const services: ReadonlyArray<string> = context.openStackServices || [];
      if (services.length === 0) {
        return undefined;
      }
      return translateTemplate(
        "This cloud runs {{services}}, so the recommendations below include alerts on them.",
        {
          services: services
            .map((service: string): string => {
              return (
                OPENSTACK_SERVICE_TITLES[service as OpenStackServiceType] ||
                service
              );
            })
            .join(", "),
        },
      );
    },
  },
  {
    resourceType: MonitorRecommendationResourceType.VMware,
    modelType: VMwareVCenter,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.Ceph,
    modelType: CephCluster,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  /*
   * A storage array's recommendations depend on its platform: FlashArray
   * and FlashBlade export different metric families (purefa_* and
   * purefb_*), and a template over the other platform's series would never
   * fire (getStorageArrayAlertTemplatesForSystem). Ingest writes
   * `storageSystem` from the array's first batch; until then — or for a
   * platform OneUptime has no templates for — nothing is offered, as for a
   * database with no engine recorded.
   */
  {
    resourceType: MonitorRecommendationResourceType.StorageArray,
    modelType: StorageArray,
    identifierFieldName: "name",
    displayNameFieldName: "name",
    contextFieldNames: ["storageSystem"],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      const storageSystem: unknown = (
        model as unknown as Record<string, unknown>
      )["storageSystem"];

      return {
        storageSystem:
          typeof storageSystem === "string" && storageSystem.trim()
            ? storageSystem.trim()
            : null,
      };
    },
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      if (!context.storageSystem) {
        return translateTemplate(
          "This storage array has not reported its platform yet, and every recommended storage array monitor reads one platform's own metrics, so none are offered until its agent sends data.",
        );
      }

      if (!StorageSystemUtil.isKnownSystem(context.storageSystem)) {
        return translateTemplate(
          "OneUptime has no recommended monitors for this storage array's platform ({{platform}}): each one reads a supported platform's own metrics.",
          { platform: context.storageSystem },
        );
      }

      return translateTemplate(
        "This storage array is a {{platform}}, so the recommendations below are the ones its metrics support.",
        { platform: StorageSystemUtil.getDisplayName(context.storageSystem) },
      );
    },
  },
  {
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    modelType: IoTFleet,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  /*
   * A RUM application is offered the same recommendations as every other
   * one, except its session replay storage budget alerts: the budget sweep
   * only writes the series they watch for an application that has session
   * replay on and has recorded at least one replay, and the monthly series
   * only while it has a monthly budget (see `getRumAlertTemplates`). These
   * three columns are that, and each is readable by exactly the roles that
   * can read `name` — a context column a viewer cannot read would fail
   * `ModelAPI.getItem` for them, and the page would show an error instead
   * of any recommendation.
   *
   * The project's own switch (`Project.isSessionReplayAllowed`), which the
   * sweep also requires, is not read: context columns are this row's own. A
   * project that turns replay off simply stops the series, which resolves
   * any open budget alert.
   */
  {
    resourceType: MonitorRecommendationResourceType.RumApplication,
    modelType: RumApplication,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    contextFieldNames: [
      "isSessionReplayEnabled",
      "sessionReplayLastChunkReceivedAt",
      "sessionReplayMonthlyBudgetInGB",
    ],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      const record: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;

      const isSessionReplayEnabled: unknown = record["isSessionReplayEnabled"];
      const lastChunkReceivedAt: unknown =
        record["sessionReplayLastChunkReceivedAt"];

      return {
        // Anything but a boolean is "not known", which withholds.
        sessionReplayEnabled:
          typeof isSessionReplayEnabled === "boolean"
            ? isSessionReplayEnabled
            : null,
        /*
         * The API hands a Date column back as a Date or as its JSON string,
         * depending on the path; either means a replay was accepted.
         * Anything else — null, undefined, an empty string — means never.
         */
        sessionReplayHasRecorded:
          lastChunkReceivedAt instanceof Date ||
          (typeof lastChunkReceivedAt === "string" &&
            lastChunkReceivedAt.trim().length > 0),
        sessionReplayMonthlyBudgetInGB: readSessionReplayMonthlyBudgetInGB(
          record["sessionReplayMonthlyBudgetInGB"],
        ),
      };
    },
    /*
     * Only the states where the application uses session replay and still
     * misses some of the budget alerts get a note. An application that never
     * used replay hears nothing about it, and one offered everything needs no
     * explanation.
     */
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      const isEnabled: boolean = context.sessionReplayEnabled === true;
      const hasRecorded: boolean = context.sessionReplayHasRecorded === true;
      const hasBudget: boolean =
        readSessionReplayMonthlyBudgetInGB(
          context.sessionReplayMonthlyBudgetInGB,
        ) !== null;

      if (isEnabled && hasRecorded && !hasBudget) {
        return translateTemplate(
          "Of the session replay storage budget alerts, only the two for the project's shared daily limit are offered: this application has no monthly budget. Set a Monthly budget (GB) on its Replay Policy page and the monthly-budget alerts appear here too.",
        );
      }

      if (context.sessionReplayEnabled === false && hasRecorded) {
        return translateTemplate(
          "Session replay is off for this application, so its storage budget alerts are not offered. Turn it back on under Replay Policy and they appear here.",
        );
      }

      /*
       * Switching replay on is not enough on its own here: the series only
       * exists once the application has recorded.
       */
      if (context.sessionReplayEnabled === false && hasBudget) {
        return translateTemplate(
          "Session replay is off for this application, so its storage budget alerts are not offered. Turn it on under Replay Policy and they appear here once it records its first replay.",
        );
      }

      if (isEnabled && !hasRecorded && hasBudget) {
        return translateTemplate(
          "The session replay budget alerts appear here once this application records its first replay.",
        );
      }

      return undefined;
    },
  },
  /*
   * A service's recommendations depend on the runtime it is written in, and
   * these three columns are the only evidence of that OneUptime has — in
   * descending order of trust, which is the order `detectServiceLanguage`
   * consults them in.
   *
   * `serviceLanguage` is deliberately NOT among them despite the name: it is
   * marked deprecated on the model, carries no `@ColumnAccessControl`
   * decorator at all — which makes it unreadable through the model API by
   * every role, silently — and there is a data migration moving projects off
   * it onto `techStack`.
   */
  {
    resourceType: MonitorRecommendationResourceType.Service,
    modelType: Service,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    contextFieldNames: ["telemetrySdkLanguage", "runtimeName", "techStack"],
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      if (!context.serviceLanguage) {
        return translateTemplate(
          "This service has not reported which runtime it uses, so only the recommendations that apply to every service are shown. Once its SDK reports telemetry.sdk.language — or you set the tech stack under Settings — the runtime-specific ones appear here too.",
        );
      }

      return translateTemplate(
        "Detected as {{runtime}}, so the runtime-specific recommendations below are the ones that apply to it.",
        { runtime: SERVICE_LANGUAGE_DISPLAY_NAMES[context.serviceLanguage] },
      );
    },
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      const record: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;

      const telemetrySdkLanguage: unknown = record["telemetrySdkLanguage"];
      const runtimeName: unknown = record["runtimeName"];
      const techStack: unknown = record["techStack"];

      return {
        serviceLanguage: detectServiceLanguage({
          telemetrySdkLanguage:
            typeof telemetrySdkLanguage === "string"
              ? telemetrySdkLanguage
              : undefined,
          runtimeName:
            typeof runtimeName === "string" ? runtimeName : undefined,
          /*
           * `techStack` is a JSON column, so what comes back is whatever was
           * stored. Anything that is not an array is dropped rather than
           * passed through — `detectServiceLanguage` iterates it, and
           * iterating a string would test every character against the tech
           * stack map.
           */
          techStack: Array.isArray(techStack)
            ? (techStack as Array<TechStack>)
            : undefined,
        }),
      };
    },
  },
  /*
   * A database's recommendations depend on its engine (`dbSystem`, a required
   * column) and on whether the metrics its engine's monitors read have
   * arrived. That second question is what stops the page from offering a
   * database a set of monitors over metrics nobody sends — where "Engine
   * Metrics Stopped" fires ten minutes after it is created and never clears.
   *
   * The row answers only half of it. `collectorLastSeenAt` (rather than
   * `otelCollectorStatus`, which flips to "disconnected" the moment the
   * collector stops — exactly when "Engine Metrics Stopped" matters most)
   * says whether ANY batch was attributed to the database: never means
   * nothing arrived. But ingest stamps it for every batch — the database's
   * logs, an exporter, a MongoDB Atlas database's `mongodbatlas` receiver,
   * whose metrics are not the `mongodb.*` the MongoDB monitors read — so
   * `loadContext` then asks the telemetry whether any metric those monitors
   * read has arrived stamped with the database's id
   * (DatabaseEngineMetricsProbe). `projectId` is read for that question.
   */
  {
    resourceType: MonitorRecommendationResourceType.DatabaseServer,
    modelType: DatabaseServer,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    contextFieldNames: ["dbSystem", "collectorLastSeenAt", "projectId"],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      const record: Record<string, unknown> = model as unknown as Record<
        string,
        unknown
      >;

      const dbSystem: unknown = record["dbSystem"];
      const collectorLastSeenAt: unknown = record["collectorLastSeenAt"];

      return {
        databaseEngine:
          typeof dbSystem === "string" && dbSystem.trim()
            ? dbSystem.trim()
            : null,
        /*
         * The API hands a Date column back as a Date or as its JSON string,
         * depending on the path; either means "seen". Anything else — null,
         * undefined, an empty string — means never.
         */
        databaseEngineMetricsReported:
          collectorLastSeenAt instanceof Date ||
          (typeof collectorLastSeenAt === "string" &&
            collectorLastSeenAt.trim().length > 0),
      };
    },
    loadContext: async (data: {
      model: BaseModel;
      context: MonitorRecommendationContext;
    }): Promise<MonitorRecommendationContext> => {
      /*
       * Only a heartbeat can be contradicted: a database that never sent a
       * batch, or whose engine has no library, has nothing to ask.
       */
      if (
        !data.context.databaseEngine ||
        data.context.databaseEngineMetricsReported !== true
      ) {
        return data.context;
      }

      const record: Record<string, unknown> = data.model as unknown as Record<
        string,
        unknown
      >;

      const arrived: boolean | null = await fetchDatabaseEngineMetricsArrived({
        projectId: record["projectId"],
        databaseServerId: record["_id"],
        engine: data.context.databaseEngine,
      });

      // Unknown (the read failed) is never held against the database.
      return arrived === false
        ? { ...data.context, databaseEngineMetricsReported: false }
        : data.context;
    },
    describeContext: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      if (!context.databaseEngine) {
        return translateTemplate(
          "This database has no engine recorded, and every recommended database monitor reads one engine's own metrics, so none apply to it.",
        );
      }

      const engineName: string = getDatabaseSystemDisplayName(
        context.databaseEngine,
      );

      const templateCount: number = getDatabaseAlertTemplates(
        context.databaseEngine,
      ).length;

      if (templateCount === 0) {
        return translateTemplate(
          "OneUptime does not ship recommended monitors for {{engine}} yet. You can still alert on this database: create a Metrics monitor that filters on oneuptime.database.server.id (shown on the Documentation tab), and its alerts and incidents will appear on this database.",
          { engine: engineName },
        );
      }

      if (context.databaseEngineMetricsReported === false) {
        const receivers: string = getDatabaseRecommendationReceivers(
          context.databaseEngine,
        ).join(" / ");
        return translateTemplate(
          "None of the metrics the {{count}} recommended {{engine}} monitors read has arrived from this database in the last {{days}} days. They come from the collector's {{receivers}} receiver, which the Database Agent runs; other telemetry linked to this database (its logs, another receiver, an exporter) does not count. Connect the Database Agent or that receiver (see the Documentation tab), and the {{engine}} recommendations appear here.",
          {
            count: templateCount,
            engine: engineName,
            days: DATABASE_ENGINE_METRICS_LOOKBACK_DAYS,
            receivers: receivers,
          },
        );
      }

      return translateTemplate(
        "Recommended for {{engine}}, from the metrics its collector receiver reports. Each monitor is scoped to this database by oneuptime.database.server.id, so its alerts and incidents appear on this database's tabs.",
        { engine: engineName },
      );
    },
  },
  /*
   * A data store whose tables Data Observability watches. The same set for
   * every store: every template reads the oneuptime.data.table.* metrics
   * table health writes for any engine it collects. Read through
   * `loadResource`, as a DataStore row is readable by the Security tiers
   * only.
   */
  {
    resourceType: MonitorRecommendationResourceType.DataStore,
    modelType: DataStore,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    loadResource: async (resourceId: ObjectID): Promise<BaseModel | null> => {
      // Imported here: its client reads the browser's config as it loads.
      const api: typeof import("../DataObservability/DataObservabilityApi") =
        await import("../DataObservability/DataObservabilityApi");
      const summary: DataObservabilityStoreSummary | undefined = (
        await api.default.getStores()
      ).find((candidate: DataObservabilityStoreSummary) => {
        return candidate.dataStoreId === resourceId.toString();
      });

      if (!summary) {
        return null;
      }

      const store: DataStore = new DataStore();
      store._id = summary.dataStoreId;
      store.name = summary.name;

      return store;
    },
  },
  // A data pipeline: every template filters on its id, as each run's metrics carry it.
  {
    resourceType: MonitorRecommendationResourceType.DataPipeline,
    modelType: DataPipeline,
    identifierFieldName: "_id",
    displayNameFieldName: "jobName",
  },
  /*
   * A cloud resource: every template reads the key metrics its connection
   * reads, filtered on the attributes its metrics are stored with, and
   * names the resource's row in its queries' event scope - so `_id` is the
   * identifier, as for a database. Each context column is readable by
   * exactly the roles that read `name`.
   */
  {
    resourceType: MonitorRecommendationResourceType.CloudResource,
    modelType: CloudResource,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    contextFieldNames: [
      "cloudProvider",
      "cloudResourceType",
      "telemetryAttributes",
      "cloudReadings",
      "cloudProperties",
      "cloudConnectionId",
    ],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      return readCloudResourceRecommendationContext(
        model as unknown as Record<string, unknown>,
      );
    },
    describeContext: describeCloudResourceRecommendationContext,
    getCardDescription: (
      context: MonitorRecommendationContext,
    ): string | undefined => {
      const source: string | undefined = getCloudMonitoringServiceName(
        context.cloudProvider,
      );

      return source
        ? translateTemplate(
            "Monitors OneUptime recommends for this resource, from the metrics {{source}} reports about it. Pick the ones you want and create them in one step.",
            { source: source },
          )
        : undefined;
    },
    linkCreatedMonitor: (data: {
      monitor: Monitor;
      resourceId: ObjectID;
      context: MonitorRecommendationContext;
    }): void => {
      MonitorRecommendationCreateUtil.linkToCloudResource({
        monitor: data.monitor,
        cloudResourceId: data.resourceId,
      });
    },
  },
  /*
   * An App Platforms app: every template reads its own spans and request
   * durations, filtered as its Traces tab filters them - its environment's
   * cloud.* attributes and its own - so `_id` names it, as a cloud
   * resource's does. Each monitor is linked to its environment, where an
   * app's incidents and alerts are listed (CloudApp keeps none of its own).
   */
  {
    resourceType: MonitorRecommendationResourceType.CloudApp,
    modelType: CloudApp,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
    contextFieldNames: ["telemetryAttributes", "cloudResourceId"],
    readContext: (model: BaseModel): MonitorRecommendationContext => {
      return readCloudAppRecommendationContext(
        model as unknown as Record<string, unknown>,
      );
    },
    loadContext: loadCloudAppRecommendationContext,
    describeContext: describeCloudAppRecommendationContext,
    getCardDescription: (): string | undefined => {
      return translateTemplate(
        "Monitors OneUptime recommends for this app, from the requests its OpenTelemetry reports. Pick the ones you want and create them in one step.",
      );
    },
    linkCreatedMonitor: (data: {
      monitor: Monitor;
      resourceId: ObjectID;
      context: MonitorRecommendationContext;
    }): void => {
      if (!data.context.cloudAppEnvironmentId) {
        return;
      }

      MonitorRecommendationCreateUtil.linkToCloudResource({
        monitor: data.monitor,
        cloudResourceId: new ObjectID(data.context.cloudAppEnvironmentId),
      });
    },
  },
];

export default class RecommendationResourceRegistry {
  public static getDefinitions(): Array<RecommendationResourceDefinition> {
    return [...RESOURCE_DEFINITIONS];
  }

  public static getDefinition(
    resourceType: MonitorRecommendationResourceType,
  ): RecommendationResourceDefinition | undefined {
    return RESOURCE_DEFINITIONS.find(
      (definition: RecommendationResourceDefinition) => {
        return definition.resourceType === resourceType;
      },
    );
  }

  /*
   * The `select` to pass to `ModelAPI.getItem` for a resource type.
   *
   * Built from the definition rather than written out per page so that the
   * identifier column can never be selected on one code path and forgotten on
   * another — a forgotten select yields `undefined`, which reads as "this
   * resource has no telemetry yet" rather than as an error.
   */
  public static getSelect(
    resourceType: MonitorRecommendationResourceType,
  ): Record<string, boolean> {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(resourceType);

    if (!definition) {
      return {};
    }

    const select: Record<string, boolean> = {};

    select[definition.identifierFieldName] = true;
    select[definition.displayNameFieldName] = true;

    for (const contextFieldName of definition.contextFieldNames || []) {
      select[contextFieldName] = true;
    }

    return select;
  }

  /*
   * What is known about one fetched resource that narrows its recommendations.
   *
   * Returns `{}` — not `undefined` — for every resource type without a reader,
   * for an unregistered type, and for a null model. An empty context and an
   * absent context mean the same thing to the catalog ("nothing is known"), and
   * returning the same shape from all four paths means no caller has to decide
   * which of them it is looking at.
   */
  public static readContext(data: {
    resourceType: MonitorRecommendationResourceType;
    model: BaseModel | null;
  }): MonitorRecommendationContext {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(data.resourceType);

    if (!definition || !definition.readContext || !data.model) {
      return {};
    }

    return definition.readContext(data.model);
  }

  /*
   * `readContext`, then whatever the definition must ask telemetry to
   * complete it (a database: have the metrics its monitors read arrived?).
   * What the page and the side-menu badge should both render from, so the
   * two never disagree. A failed question leaves `readContext`'s answer
   * standing — never an error on the page.
   */
  public static async loadContext(data: {
    resourceType: MonitorRecommendationResourceType;
    model: BaseModel | null;
  }): Promise<MonitorRecommendationContext> {
    const context: MonitorRecommendationContext = this.readContext(data);

    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(data.resourceType);

    if (!definition || !definition.loadContext || !data.model) {
      return context;
    }

    try {
      return await definition.loadContext({
        model: data.model,
        context: context,
      });
    } catch {
      return context;
    }
  }

  /*
   * A sentence explaining what narrowed this resource's recommendations, or
   * undefined when nothing did.
   *
   * Takes the context rather than the model so the page describes exactly the
   * context it rendered from — reading the model a second time here would let
   * the note and the list disagree.
   */
  public static describeContext(data: {
    resourceType: MonitorRecommendationResourceType;
    context: MonitorRecommendationContext;
  }): string | undefined {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(data.resourceType);

    if (!definition || !definition.describeContext) {
      return undefined;
    }

    return definition.describeContext(data.context);
  }

  // The card's description for one resource, or undefined for its own words.
  public static getCardDescription(data: {
    resourceType: MonitorRecommendationResourceType;
    context: MonitorRecommendationContext;
  }): string | undefined {
    return this.getDefinition(data.resourceType)?.getCardDescription?.(
      data.context,
    );
  }

  /*
   * What a monitor created for this resource is linked to, as a function
   * of the monitor, or undefined for the types that link nothing.
   */
  public static getMonitorLinker(data: {
    resourceType: MonitorRecommendationResourceType;
    resourceId: ObjectID;
    // What the page read about the resource: an app's environment, say.
    context?: MonitorRecommendationContext | undefined;
  }): ((monitor: Monitor) => void) | undefined {
    const link:
      | ((link: {
          monitor: Monitor;
          resourceId: ObjectID;
          context: MonitorRecommendationContext;
        }) => void)
      | undefined = this.getDefinition(data.resourceType)?.linkCreatedMonitor;

    if (!link) {
      return undefined;
    }

    return (monitor: Monitor): void => {
      link({
        monitor: monitor,
        resourceId: data.resourceId,
        context: data.context || {},
      });
    };
  }

  /*
   * Pull the identifier and display name out of a fetched model.
   *
   * `resourceDisplayName` falls back to the identifier so a resource with a
   * blank name still produces meaningfully-named monitors rather than
   * monitors called " - Node Not Ready".
   */
  public static readResourceFields(data: {
    resourceType: MonitorRecommendationResourceType;
    model: BaseModel | null;
  }): { resourceIdentifier: string; resourceDisplayName: string } {
    const definition: RecommendationResourceDefinition | undefined =
      this.getDefinition(data.resourceType);

    if (!definition || !data.model) {
      return { resourceIdentifier: "", resourceDisplayName: "" };
    }

    const record: Record<string, unknown> = data.model as unknown as Record<
      string,
      unknown
    >;

    const identifierValue: unknown = record[definition.identifierFieldName];
    const displayNameValue: unknown = record[definition.displayNameFieldName];

    const resourceIdentifier: string =
      typeof identifierValue === "string" ? identifierValue : "";
    const resourceDisplayName: string =
      typeof displayNameValue === "string" ? displayNameValue : "";

    return {
      resourceIdentifier: resourceIdentifier,
      resourceDisplayName: resourceDisplayName || resourceIdentifier,
    };
  }
}
