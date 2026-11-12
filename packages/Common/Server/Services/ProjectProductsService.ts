import ProjectMilestoneService, {
  ReachedMilestone,
} from "./ProjectMilestoneService";
import ProjectService from "./ProjectService";
import ProjectUserPreferenceService from "./ProjectUserPreferenceService";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import CallerPermission from "../Utils/Permission/CallerPermission";
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
  getProjectProductSettingsFromGoals,
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
import ProjectGoal from "../../Types/WelcomeChecklist/ProjectGoal";
import OldestKeyMap from "../../Utils/OldestKeyMap";

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
 *     checklist's, which would otherwise run Project's update hooks;
 *   - the person's pins: their own ProjectUserPreference row
 *     (ProjectUserPreferenceService), and nobody else's;
 *   - what is in use (getProjectUsage): one statement that asks, for each
 *     product of PRODUCT_RECORD_MODELS, whether the project has any of its
 *     records, and the project's activation milestones for the telemetry
 *     products. Kept per project for USAGE_TTL_IN_MS, so a page load costs
 *     no more than reading the project, and forgotten when the project's
 *     products change.
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

// How long a project's usage is kept before it is asked again.
export const USAGE_TTL_IN_MS: number = 5 * 60 * 1000;

// How many projects' usage this process keeps at most.
export const USAGE_CACHE_MAX_ENTRIES: number = 10_000;

export interface ProjectProductsCaller {
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
}

// What a project has something in: product -> has records or data.
export type ProjectUsage = Partial<Record<ProductKey, boolean>>;

interface CachedUsage {
  usage: ProjectUsage;
  readAt: number;
}

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

  return `SELECT ${columns.join(", ")}`;
};

export class ProjectProductsServiceClass {
  private readonly usageCache: OldestKeyMap<string, CachedUsage> =
    new OldestKeyMap<string, CachedUsage>();

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
   * Gives a project the products its goals need (called when the goals are
   * chosen, WelcomeChecklistService.chooseGoals): Essentials, Settings, what
   * the goals name and anything already in use are shown, the rest hidden.
   * A project whose products a member already chose is left as it is.
   * Never throws: the goals are kept either way.
   */
  public async applyGoals(data: {
    projectId: ObjectID;
    goals: ReadonlyArray<ProjectGoal>;
  }): Promise<void> {
    try {
      const row: ProjectProductsRow = await this.readProject(data.projectId);

      const usage: ProjectUsage = await this.getProjectUsage(data.projectId, {
        isFreshRead: true,
      });

      const next: ProjectProductSettings | null =
        getProjectProductSettingsFromGoals({
          current: row.settings,
          goals: data.goals,
          inUse: PRODUCT_KEYS.filter((product: ProductKey): boolean => {
            return usage[product] === true;
          }),
          now: OneUptimeDate.getCurrentDate(),
        });

      if (!next) {
        return;
      }

      await this.writeSettings(data.projectId, next);
    } catch (err) {
      logger.error("Could not set the project's products from its goals:");
      logger.error(err as Error);
    }
  }

  /*
   * What the project has something in, kept for USAGE_TTL_IN_MS. A fresh
   * read asks the database whatever is kept.
   */
  public async getProjectUsage(
    projectId: ObjectID,
    options?: { isFreshRead?: boolean | undefined } | undefined,
  ): Promise<ProjectUsage> {
    const key: string = projectId.toString();
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: CachedUsage | undefined = this.usageCache.get(key);

    if (
      !options?.isFreshRead &&
      cached &&
      now - cached.readAt < USAGE_TTL_IN_MS
    ) {
      return cached.usage;
    }

    const usage: ProjectUsage = await this.readUsage(projectId);

    this.remember(key, { usage: usage, readAt: now });

    return usage;
  }

  // Forgets every project's kept usage (tests, and a process that must).
  public forgetUsage(projectId?: ObjectID | undefined): void {
    if (projectId) {
      this.usageCache.delete(projectId.toString());
      return;
    }

    this.usageCache.clear();
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

      const modelType: { new (): BaseModel } | undefined =
        PRODUCT_RECORD_MODELS[product];

      if (
        modelType &&
        !data.props.isMasterAdmin &&
        !CallerPermission.holdsModelPermission(data.props, {
          model: new modelType(),
          operation: "read",
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

  private remember(key: string, value: CachedUsage): void {
    this.usageCache.delete(key);

    while (this.usageCache.size >= USAGE_CACHE_MAX_ENTRIES) {
      const oldest: string | undefined = this.usageCache.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.usageCache.delete(oldest);
    }

    this.usageCache.set(key, value);
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
