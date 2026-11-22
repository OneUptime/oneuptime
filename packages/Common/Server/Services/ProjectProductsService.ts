import ProjectMilestoneService, {
  ReachedMilestone,
} from "./ProjectMilestoneService";
import ProjectService from "./ProjectService";
import ProjectUserPreferenceService from "./ProjectUserPreferenceService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import CallerPermission from "../Utils/Permission/CallerPermission";
import ProjectUsageCache, {
  ProjectUsage,
} from "../Utils/ProjectProducts/ProjectUsageCache";
import ServerProducts from "../Utils/ServerProducts/ServerProducts";
import AIInsight from "../../Models/DatabaseModels/AIInsight";
import Alert from "../../Models/DatabaseModels/Alert";
import CephCluster from "../../Models/DatabaseModels/CephCluster";
import CloudConnection from "../../Models/DatabaseModels/CloudConnection";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import Dashboard from "../../Models/DatabaseModels/Dashboard";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../Models/DatabaseModels/DockerSwarmCluster";
import Form from "../../Models/DatabaseModels/Form";
import Host from "../../Models/DatabaseModels/Host";
import Incident from "../../Models/DatabaseModels/Incident";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import MessageQueue from "../../Models/DatabaseModels/MessageQueue";
import Monitor from "../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import Project from "../../Models/DatabaseModels/Project";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import RumApplication from "../../Models/DatabaseModels/RumApplication";
import Runbook from "../../Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ServerlessFunction from "../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../Models/DatabaseModels/VMwareVCenter";
import Workflow from "../../Models/DatabaseModels/Workflow";
import CloudResource from "../../Models/DatabaseModels/CloudResource";
import DataStore from "../../Models/DatabaseModels/DataStore";
import InventoryItem from "../../Models/DatabaseModels/InventoryItem";
import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import SecurityLogSource from "../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../Models/DatabaseModels/SecurityTelemetrySource";
import { CloudResourceKind } from "../../Types/Cloud/CloudResourceKind";
import {
  DECLARED_DATA_STORE_KINDS,
  DataStoreKind,
} from "../../Types/DataSecurity/DataStoreKind";
import { OBJECT_STORE_KINDS } from "../../Types/DataObservability/StoragePaths";
import { DATA_OBSERVABILITY_KINDS } from "../Utils/DataObservability/DataObservabilityEngines";
import ActivationMilestone from "../../Types/Analytics/ActivationMilestone";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ProductKey, {
  PRODUCT_KEYS,
  isProductKey,
  parseProductKeys,
} from "../../Types/Product/ProductKey";
import {
  MAX_PINNED_PRODUCTS,
  parsePinnedProducts,
} from "../../Types/Product/ProductPins";
import {
  PRODUCTS_USED_BY_RECORDS,
  PRODUCT_USAGE_MILESTONES,
  ProductUsage,
  getProductsInUse,
  isUsedByMilestones,
  toProductUsage,
} from "../../Types/Product/ProductUsage";
import {
  ProjectProductSettings,
  getHiddenProducts,
  getHiddenProductsWithData,
  isHideableProduct,
  parseProjectProductSettings,
  toProjectProductSettingsJSON,
  withEveryProductShown,
  withProductShown,
} from "../../Types/Product/ProjectProducts";
import { ProjectProductsAnswer } from "../../Types/Product/ProjectProductsAnswer";
import {
  ServerProductOffReason,
  ServerProductsOff,
  getProductOffMessage,
} from "../../Types/Product/ServerProducts";

/*
 * THE PRODUCTS A PROJECT SHOWS, AND THE ONES A PERSON PINS, ON THE SERVER
 * (issue #6814).
 *
 * One answer for the project and the person asking (getAnswer): the
 * products the project hides, this person's pins, what is in use, the plan
 * each product needs, and - for whoever may choose the project's products -
 * the hidden products that have data. The pure rules are in Types/Product;
 * this file reads what they need and writes what they decide:
 *
 *   - the project's choice: Project.productSettings, written straight to the
 *     row (writeSettings) - the server's own bookkeeping, like the Welcome
 *     checklist's, which would otherwise run Project's update hooks. Only a
 *     member's change on Project Settings > Products writes it
 *     (setProductShown, showEveryProduct): nothing hides a product by
 *     itself, not the project's goals and not a product not set up yet;
 *   - the person's pins: their own ProjectUserPreference row
 *     (ProjectUserPreferenceService), and nobody else's;
 *   - what is in use (getProjectUsage): one statement that asks, for each
 *     product of PRODUCT_RECORD_MODELS, whether the project has any of its
 *     records - and for each of PRODUCT_USAGE_RECORDS, whether it has one
 *     its first page counts - and the project's activation milestones for
 *     the telemetry products and AI / LLM. Kept per project for USAGE_TTL_IN_MS, so a page load costs
 *     no more than reading the project, and read again on every server
 *     once a product's first record is created, its records are deleted or
 *     its first data arrives (Utils/ProjectProducts/ProjectUsageCache,
 *     #7465).
 *
 * A member sees what is in use only for the products whose records they may
 * read (readableUsage): membership is not read authorisation. The telemetry
 * products are read from the milestones, which every member may read.
 *
 * The products switched off on the whole server (#6815, Utils/
 * ServerProducts) ride along in every answer (offOnServer). Off is stronger
 * than the project's choice: showing such a product, or pinning one, is
 * refused with what happened and who can switch it on. Hiding one, and
 * unpinning one, are not: they change nothing anybody sees now, and leave
 * the project's choice ready for when the server switches it on again.
 */

// Who may show and hide the project's products: who may edit the project.
export const CHOOSE_PRODUCTS_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProject,
];

/*
 * The record each product counts to know whether it is in use: the one its
 * first page counts to show its first-run explanation. A record that exists
 * - archived or not - is something in it.
 */
export const PRODUCT_RECORD_MODELS: Readonly<
  Partial<Record<ProductKey, { new (): BaseModel }>>
> = {
  [ProductKey.Monitors]: Monitor,
  [ProductKey.Incidents]: Incident,
  [ProductKey.Alerts]: Alert,
  [ProductKey.OnCall]: OnCallDutyPolicy,
  [ProductKey.StatusPages]: StatusPage,
  [ProductKey.ScheduledMaintenance]: ScheduledMaintenance,
  [ProductKey.Slos]: ServiceLevelObjective,
  [ProductKey.AIInsights]: AIInsight,
  [ProductKey.Code]: CodeRepository,
  [ProductKey.Services]: Service,
  [ProductKey.Databases]: DatabaseServer,
  [ProductKey.Queues]: MessageQueue,
  [ProductKey.Rum]: RumApplication,
  [ProductKey.Hosts]: Host,
  [ProductKey.Kubernetes]: KubernetesCluster,
  [ProductKey.Docker]: DockerHost,
  [ProductKey.DockerSwarm]: DockerSwarmCluster,
  [ProductKey.Podman]: PodmanHost,
  [ProductKey.Proxmox]: ProxmoxCluster,
  [ProductKey.OpenStack]: OpenStackCloud,
  [ProductKey.VMware]: VMwareVCenter,
  [ProductKey.Ceph]: CephCluster,
  [ProductKey.StorageArrays]: StorageArray,
  [ProductKey.Network]: NetworkDevice,
  [ProductKey.IoT]: IoTFleet,
  [ProductKey.Cloud]: CloudConnection,
  [ProductKey.Serverless]: ServerlessFunction,
  [ProductKey.Dashboards]: Dashboard,
  [ProductKey.Workflows]: Workflow,
  [ProductKey.Runbooks]: Runbook,
  [ProductKey.Forms]: Form,
};

/*
 * The products whose first page counts only some records of a table, or
 * the records of a few tables (#7325), each with that rule: in use while
 * one record of one of them matches. Every condition is written here from
 * fixed values - a kind, a switch - never from a request.
 *
 *   - Inventory: an item of the inventory, not archived (its Overview's
 *     count of the estate);
 *   - App Platforms: an environment, a cloud resource of the environment
 *     kind, not archived (its Overview's first-run check);
 *   - Data Observability: a database it can watch, or a bucket with paths
 *     watched, not archived (its Overview's store count);
 *   - Data Security: a data store, not archived, other than the ones
 *     OneUptime declares for every project's security (its Overview's
 *     store count);
 *   - Security Events: a source it reads that is on - a connection, your
 *     logs, your other OneUptime data (its Get started's first step).
 */
export interface ProductUsageRecord {
  modelType: { new (): BaseModel };
  // A condition on the table's own columns, beside its project.
  where: string;
}

const sqlTextList: (values: ReadonlyArray<string>) => string = (
  values: ReadonlyArray<string>,
): string => {
  return values
    .map((value: string): string => {
      return `'${value.replace(/'/g, "''")}'`;
    })
    .join(", ");
};

export const PRODUCT_USAGE_RECORDS: Readonly<
  Partial<Record<ProductKey, ReadonlyArray<ProductUsageRecord>>>
> = {
  [ProductKey.Inventory]: [
    { modelType: InventoryItem, where: `"isArchived" = false` },
  ],
  [ProductKey.AppPlatforms]: [
    {
      modelType: CloudResource,
      where: `"isArchived" = false AND "cloudResourceKind" = '${CloudResourceKind.Environment}'`,
    },
  ],
  [ProductKey.DataObservability]: [
    {
      modelType: DataStore,
      where: `"isArchived" = false AND ("kind" IN (${sqlTextList(
        DATA_OBSERVABILITY_KINDS as ReadonlyArray<DataStoreKind>,
      )}) OR ("kind" IN (${sqlTextList(
        OBJECT_STORE_KINDS as ReadonlyArray<DataStoreKind>,
      )}) AND "watchedPaths" IS NOT NULL))`,
    },
  ],
  /*
   * Not the stores OneUptime declares for a project's security (#10398):
   * every project with security events or network flows has one, set up
   * in Data Security or not.
   */
  [ProductKey.DataSecurity]: [
    {
      modelType: DataStore,
      where: `"isArchived" = false AND "kind" NOT IN (${sqlTextList(
        DECLARED_DATA_STORE_KINDS,
      )})`,
    },
  ],
  [ProductKey.SecurityEvents]: [
    { modelType: SecurityEventConnection, where: `"isEnabled" = true` },
    { modelType: SecurityLogSource, where: `"isEnabled" = true` },
    { modelType: SecurityTelemetrySource, where: `"isEnabled" = true` },
  ],
};

/*
 * How long a project's usage is kept at most before it is asked again. A
 * change to it is seen at once (ProjectUsageCache).
 */
export const USAGE_TTL_IN_MS: number = ProjectUsageCache.TTL_MS;

export interface ProjectProductsCaller {
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

// What a project has something in: product -> has records or data.
export type { ProjectUsage };

interface ProjectProductsRow {
  settings: ProjectProductSettings | null;
  plan: PlanType | null;
}

/*
 * The statement that asks whether the project has any record of each
 * product: one EXISTS per table, every one an index lookup on the table's
 * projectId, in one round trip. The table names come from the models, never
 * from a request.
 */
export const getUsageStatement: () => string = (): string => {
  const columns: Array<string> = [];

  for (const product of PRODUCT_KEYS) {
    const modelType: { new (): BaseModel } | undefined =
      PRODUCT_RECORD_MODELS[product];

    if (!modelType) {
      continue;
    }

    const tableName: string | null = new modelType().tableName;

    if (!tableName) {
      continue;
    }

    columns.push(
      `EXISTS (SELECT 1 FROM "${tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL) AS "${product}"`,
    );
  }

  // The products counted by some of their records: one EXISTS per table.
  for (const product of PRODUCT_KEYS) {
    const records: ReadonlyArray<ProductUsageRecord> | undefined =
      PRODUCT_USAGE_RECORDS[product];

    if (!records || records.length === 0) {
      continue;
    }

    const exists: Array<string> = records.map(
      (record: ProductUsageRecord): string => {
        return `EXISTS (SELECT 1 FROM "${new record.modelType().tableName}" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND (${record.where}))`;
      },
    );

    columns.push(`(${exists.join(" OR ")}) AS "${product}"`);
  }

  return `SELECT ${columns.join(", ")}`;
};

export class ProjectProductsServiceClass {
  // Whether the caller may show and hide the project's products.
  public canChooseProducts(props: DatabaseCommonInteractionProps): boolean {
    if (props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsAnyOf(props, [...CHOOSE_PRODUCTS_PERMISSIONS]);
  }

  public async getAnswer(
    caller: ProjectProductsCaller,
  ): Promise<ProjectProductsAnswer> {
    const [row, pinned, usage, offOnServer]: [
      ProjectProductsRow,
      Array<ProductKey>,
      ProjectUsage,
      ServerProductsOff,
    ] = await Promise.all([
      this.readProject(caller.projectId),
      ProjectUserPreferenceService.getPinnedProducts({
        projectId: caller.projectId,
        userId: caller.userId,
      }),
      this.getProjectUsageSafely(caller.projectId),
      ServerProducts.getOff(),
    ]);

    const readable: Partial<Record<ProductKey, ProductUsage>> =
      this.readableUsage({ usage: usage, props: caller.props });
    const canChoose: boolean = this.canChooseProducts(caller.props);

    return {
      hidden: getHiddenProducts(row.settings),
      chosenBy: row.settings ? row.settings.chosenBy : null,
      pinned: pinned,
      usage: readable,
      neededPlans: this.getNeededPlans(row.plan),
      canChooseProducts: canChoose,
      hiddenWithData: canChoose
        ? getHiddenProductsWithData({
            settings: row.settings,
            inUse: getProductsInUse(readable),
          }).filter((product: ProductKey): boolean => {
            // An off product is not the project's to show: Home does not ask.
            return !offOnServer[product];
          })
        : [],
      offOnServer: offOnServer,
    };
  }

  /*
   * Shows or hides one product for the project. Only someone who may edit
   * the project may; the route checks it, and so does this. Hiding a
   * product that has data keeps it hidden on purpose: Home does not ask
   * about it.
   */
  public async setProductShown(
    caller: ProjectProductsCaller,
    data: { product: unknown; isShown: unknown },
  ): Promise<void> {
    this.assertCanChoose(caller.props);

    if (!isProductKey(data.product)) {
      throw new BadDataException(
        "Choose one of the products, by its key, such as logs or status-pages.",
      );
    }

    if (typeof data.isShown !== "boolean") {
      throw new BadDataException(
        "Say whether to show the product: isShown must be true or false.",
      );
    }

    if (!isHideableProduct(data.product)) {
      throw new BadDataException(
        "Users, Teams and Project Settings are always shown.",
      );
    }

    const product: ProductKey = data.product;
    const isShown: boolean = data.isShown;

    if (isShown) {
      await this.assertNotOffOnServer(product);
    }

    const [row, usage]: [ProjectProductsRow, ProjectUsage] = await Promise.all([
      this.readProject(caller.projectId),
      isShown
        ? Promise.resolve({} as ProjectUsage)
        : this.getProjectUsageSafely(caller.projectId),
    ]);

    await this.writeSettings(
      caller.projectId,
      withProductShown({
        current: row.settings,
        product: product,
        isShown: isShown,
        isInUse: usage[product] === true,
        userId: caller.userId.toString(),
        now: OneUptimeDate.getCurrentDate(),
      }),
    );
  }

  // Shows every product again, for the project.
  public async showEveryProduct(caller: ProjectProductsCaller): Promise<void> {
    this.assertCanChoose(caller.props);

    await this.writeSettings(
      caller.projectId,
      withEveryProductShown({
        userId: caller.userId.toString(),
        now: OneUptimeDate.getCurrentDate(),
      }),
    );
  }

  /*
   * Keeps the caller's pins: known products, each once, in the order sent,
   * at most MAX_PINNED_PRODUCTS. Anybody in the project may pin; nobody
   * changes anyone else's pins.
   */
  public async setPinnedProducts(
    caller: ProjectProductsCaller,
    pinned: unknown,
  ): Promise<Array<ProductKey>> {
    if (!Array.isArray(pinned)) {
      throw new BadDataException(
        "Send the pins as a list of products, by their keys.",
      );
    }

    const known: Array<ProductKey> = parseProductKeys(pinned);

    if (known.length !== pinned.length) {
      throw new BadDataException(
        "Name each pinned product once, by its key, such as logs or status-pages.",
      );
    }

    if (known.length > MAX_PINNED_PRODUCTS) {
      throw new BadDataException(
        `You can pin up to ${MAX_PINNED_PRODUCTS} products.`,
      );
    }

    const pins: Array<ProductKey> = parsePinnedProducts(known);

    /*
     * A product switched off on the server is not pinned anew. One pinned
     * before it was switched off stays in the list, undrawn, so it is back
     * when the server switches it on again (ProductPins).
     */
    const before: Array<ProductKey> =
      await ProjectUserPreferenceService.getPinnedProducts({
        projectId: caller.projectId,
        userId: caller.userId,
      });

    for (const product of pins) {
      if (!before.includes(product)) {
        await this.assertNotOffOnServer(product);
      }
    }

    await ProjectUserPreferenceService.setPinnedProducts({
      projectId: caller.projectId,
      userId: caller.userId,
      pinned: pins,
    });

    return pins;
  }

  /*
   * What the project has something in, kept for USAGE_TTL_IN_MS or until
   * something changes it (ProjectUsageCache).
   */
  public async getProjectUsage(projectId: ObjectID): Promise<ProjectUsage> {
    return await ProjectUsageCache.getUsage({
      projectId: projectId,
      read: async (): Promise<ProjectUsage> => {
        return await this.readUsage(projectId);
      },
    });
  }

  /*
   * Forgets a project's kept usage, here and on every other server; with no
   * project, everything this process keeps (tests).
   */
  public async forgetUsage(projectId?: ObjectID | undefined): Promise<void> {
    if (projectId) {
      await ProjectUsageCache.forgetProjects([projectId]);
      return;
    }

    ProjectUsageCache.clear();
  }

  /*
   * The usage this person may see: for a product counted by its records,
   * only when they may read those records; the telemetry products, by the
   * milestones every member reads. A master admin sees it all.
   */
  public readableUsage(data: {
    usage: ProjectUsage;
    props: DatabaseCommonInteractionProps;
  }): Partial<Record<ProductKey, ProductUsage>> {
    const readable: Partial<Record<ProductKey, ProductUsage>> = {};

    for (const product of PRODUCT_KEYS) {
      const hasSomething: boolean | undefined = data.usage[product];

      if (hasSomething === undefined) {
        continue;
      }

      const modelTypes: Array<{ new (): BaseModel }> =
        this.getUsageModelTypes(product);

      /*
       * Only for whoever may read one of the records the product is counted
       * by: membership is not read authorisation.
       */
      if (
        modelTypes.length > 0 &&
        !data.props.isMasterAdmin &&
        !modelTypes.some((modelType: { new (): BaseModel }): boolean => {
          return CallerPermission.holdsModelPermission(data.props, {
            model: new modelType(),
            operation: "read",
          });
        })
      ) {
        continue;
      }

      readable[product] = toProductUsage({
        product: product,
        hasSomething: hasSomething,
      });
    }

    return readable;
  }

  /*
   * The models a product's usage is counted by: its main record
   * (PRODUCT_RECORD_MODELS), or the records of PRODUCT_USAGE_RECORDS.
   * None for a product counted by its first data.
   */
  public getUsageModelTypes(product: ProductKey): Array<{ new (): BaseModel }> {
    const main: { new (): BaseModel } | undefined =
      PRODUCT_RECORD_MODELS[product];

    if (main) {
      return [main];
    }

    return (PRODUCT_USAGE_RECORDS[product] || []).map(
      (record: ProductUsageRecord): { new (): BaseModel } => {
        return record.modelType;
      },
    );
  }

  /*
   * The plan each product needs, for the products whose records the
   * project's plan cannot create. Only with billing on, and only when the
   * plans are set up: a plan that cannot be read says nothing.
   */
  public getNeededPlans(
    plan: PlanType | null,
  ): Partial<Record<ProductKey, PlanType>> {
    const needed: Partial<Record<ProductKey, PlanType>> = {};

    if (!IsBillingEnabled || !plan) {
      return needed;
    }

    for (const product of PRODUCT_KEYS) {
      const modelType: { new (): BaseModel } | undefined =
        PRODUCT_RECORD_MODELS[product];

      if (!modelType) {
        continue;
      }

      const productPlan: PlanType | null =
        new modelType().getCreateBillingPlan();

      if (!productPlan) {
        continue;
      }

      try {
        if (
          !SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(productPlan, plan)
        ) {
          needed[product] = productPlan;
        }
      } catch {
        // The plans are not set up on this server: nothing to say.
      }
    }

    return needed;
  }

  // Refuses a product switched off on the whole server, saying who can switch it on.
  private async assertNotOffOnServer(product: ProductKey): Promise<void> {
    const reason: ServerProductOffReason | null =
      await ServerProducts.getOffReason(product);

    if (reason) {
      throw new BadDataException(
        getProductOffMessage({ product: product, reason: reason }),
      );
    }
  }

  private assertCanChoose(props: DatabaseCommonInteractionProps): void {
    if (!this.canChooseProducts(props)) {
      throw new NotAuthorizedException(
        "Only someone who may edit the project can choose the products it shows.",
      );
    }
  }

  private async getProjectUsageSafely(
    projectId: ObjectID,
  ): Promise<ProjectUsage> {
    try {
      return await this.getProjectUsage(projectId);
    } catch (err) {
      // No marks rather than no menu: the answer is a help.
      logger.error("Could not read what the project uses:");
      logger.error(err as Error);
      return {};
    }
  }

  private async readUsage(projectId: ObjectID): Promise<ProjectUsage> {
    const [rows, reached]: [Array<JSONObject>, Array<ReachedMilestone>] =
      await Promise.all([
        ProjectService.getRepository().manager.query(getUsageStatement(), [
          projectId.toString(),
        ]) as Promise<Array<JSONObject>>,
        ProjectMilestoneService.getReachedMilestones(projectId),
      ]);

    const row: JSONObject = rows?.[0] || {};
    const milestones: Set<ActivationMilestone> = new Set(
      reached.map((item: ReachedMilestone): ActivationMilestone => {
        return item.milestone;
      }),
    );

    const usage: ProjectUsage = {};

    for (const product of PRODUCT_KEYS) {
      if (PRODUCTS_USED_BY_RECORDS.includes(product)) {
        usage[product] = row[product] === true;
        continue;
      }

      if (PRODUCT_USAGE_MILESTONES[product]) {
        usage[product] =
          isUsedByMilestones({ product: product, reached: milestones }) ===
          true;
      }
    }

    return usage;
  }

  private async readProject(projectId: ObjectID): Promise<ProjectProductsRow> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        productSettings: true,
        planName: true,
        paymentProviderPlanId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new NotFoundException("Project not found.");
    }

    return {
      settings: parseProjectProductSettings(project.productSettings),
      plan: this.getPlan(project),
    };
  }

  // The project's plan, by its name or its plan id; null without billing.
  private getPlan(project: Project): PlanType | null {
    if (!IsBillingEnabled) {
      return null;
    }

    if (project.planName) {
      return project.planName;
    }

    if (!project.paymentProviderPlanId) {
      return null;
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(project.paymentProviderPlanId);

    return plan ? (plan.getName() as PlanType) : null;
  }

  private async writeSettings(
    projectId: ObjectID,
    settings: ProjectProductSettings,
  ): Promise<void> {
    await ProjectService.getRepository().manager.query(
      `UPDATE "Project" SET "productSettings" = $1 WHERE "_id" = $2`,
      [
        JSON.stringify(toProjectProductSettingsJSON(settings)),
        projectId.toString(),
      ],
    );
  }
}

export default new ProjectProductsServiceClass();
