import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "Common/Models/DatabaseModels/CephCluster";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Host from "Common/Models/DatabaseModels/Host";
import IoTFleet from "Common/Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Service from "Common/Models/DatabaseModels/Service";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import { getDatabaseAlertTemplates } from "Common/Types/Monitor/DatabaseAlertTemplates";
import { getDatabaseSystemDisplayName } from "Common/Types/DatabaseServer/DatabaseSystem";
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
 *   IoTDevice   name               IoTFleet has no identifier column
 *   RUM         _id                Metric/Span/Exception.primaryEntityId is
 *                                  the RumApplication row id
 *   Service     _id                same — primaryEntityId is the Service row
 *                                  id for OpenTelemetry telemetry
 *   Database    _id                the `oneuptime.database.server.id` stamp
 *                                  every template query filters on is the
 *                                  DatabaseServer row id
 *
 * The five `name` rows mean renaming one of those resources orphans its
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
  {
    resourceType: MonitorRecommendationResourceType.IoTDevice,
    modelType: IoTFleet,
    identifierFieldName: "name",
    displayNameFieldName: "name",
  },
  {
    resourceType: MonitorRecommendationResourceType.RumApplication,
    modelType: RumApplication,
    identifierFieldName: "_id",
    displayNameFieldName: "name",
  },
  /*
   * The only row with a context reader. A service's recommendations depend on
   * the runtime it is written in, and these three columns are the only
   * evidence of that OneUptime has — in descending order of trust, which is
   * the order `detectServiceLanguage` consults them in.
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
        return "This service has not reported which runtime it uses, so only the recommendations that apply to every service are shown. Once its SDK reports telemetry.sdk.language — or you set the tech stack under Settings — the runtime-specific ones appear here too.";
      }

      return `Detected as ${
        SERVICE_LANGUAGE_DISPLAY_NAMES[context.serviceLanguage]
      }, so the runtime-specific recommendations below are the ones that apply to it.`;
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
        return "This database has no engine recorded, and every recommended database monitor reads one engine's own metrics, so none apply to it.";
      }

      const engineName: string = getDatabaseSystemDisplayName(
        context.databaseEngine,
      );

      const templateCount: number = getDatabaseAlertTemplates(
        context.databaseEngine,
      ).length;

      if (templateCount === 0) {
        return `OneUptime does not ship recommended monitors for ${engineName} yet. You can still alert on this database: create a Metrics monitor that filters on oneuptime.database.server.id (shown on the Documentation tab), and its alerts and incidents will appear on this database.`;
      }

      if (context.databaseEngineMetricsReported === false) {
        const receivers: string = getDatabaseRecommendationReceivers(
          context.databaseEngine,
        ).join(" / ");
        return `None of the metrics the ${templateCount} recommended ${engineName} monitors read has arrived from this database in the last ${DATABASE_ENGINE_METRICS_LOOKBACK_DAYS} days. They come from the collector's ${receivers} receiver, which the Database Agent runs; other telemetry linked to this database (its logs, another receiver, an exporter) does not count. Connect the Database Agent or that receiver (see the Documentation tab), and the ${engineName} recommendations appear here.`;
      }

      return `Recommended for ${engineName}, from the metrics its collector receiver reports. Each monitor is scoped to this database by oneuptime.database.server.id, so its alerts and incidents appear on this database's tabs.`;
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
