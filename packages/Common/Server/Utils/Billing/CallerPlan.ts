import { IsBillingEnabled } from "../../EnvironmentConfig";
import type { CurrentPlan } from "../../Services/ProjectService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import PlanGates from "../../Types/Database/Permissions/PlanGates";
import { AnalyticsBaseModelType } from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE PLAN A CALLER IS HELD TO IS ALWAYS KNOWN.
 *
 * On OneUptime Cloud (billing on) every table and column a plan sells is
 * checked against the project's plan, carried on the props a read or write
 * is checked with (`currentPlan`, and `isSubscriptionUnpaid` with it). A
 * request through the API gets them from CommonAPI, which reads them for
 * the project the request names. Everything else that acts in a project
 * builds its props itself - a workflow step, a chat action, a read across a
 * person's projects - and used to leave the plan out, and every plan check
 * read "no plan" as "every plan": a step of a workflow on the Free plan
 * could create what only Scale may.
 *
 * So:
 *
 *  - `withPlan` gives props that act in a project (a tenant, neither
 *    OneUptime itself nor a server admin) the project's plan when they carry
 *    none. WorkflowPrincipal asks it for every step.
 *  - `withPlanFor` asks it only for an operation a plan decides - a table
 *    that names a plan for it, or a column a create or update writes that
 *    names one (PlanGates) - so a read or write no plan decides reads
 *    nothing. DatabaseService asks it once the refusals that need no lookup
 *    are made, ModelPermission's async checks ask it, and so do the checks
 *    of a chat action (WorkspaceActionAuthorization).
 *  - `inProject` gives the props of one project of a read across projects
 *    that project's own plan - never the plan of the project the request
 *    happened to name.
 *  - `assertPlanKnown` is what a plan check does when the props still carry
 *    no plan: it refuses (fail closed), with a plain message, instead of
 *    treating the missing plan as any plan.
 *
 * The plan comes from ProjectService.getCurrentPlan, cached for 60 seconds
 * on each server, so asking costs nothing on the hot path. Billing off: no
 * plans, nothing is read or refused.
 *
 * ONE RULE FOR SERVER ADMINS. OneUptime itself and a server admin (master
 * admin) acting in a project are held to no plan, on every path
 * (isHeldToNoPlan): a request through the API carries no plan for a server
 * admin, as CommonAPI reads it through withPlan, and every plan check lets one
 * through even should their props carry one. So an operator can always fix a
 * project - create, change or remove what its plan does not include - as the
 * CRUD create path always let them. A server admin who is no longer one is
 * held to the plan like anyone else.
 */

interface CurrentPlanReader {
  getCurrentPlan: (projectId: ObjectID) => Promise<CurrentPlan>;
}

export default class CallerPlan {
  public static readonly PLAN_UNKNOWN_MESSAGE: string =
    "OneUptime could not confirm which plan this project is on, so nothing was changed. Please try again in a moment.";

  /*
   * OneUptime itself or a server admin: no plan holds them, whatever their
   * props carry. Every plan check asks this first.
   */
  public static isHeldToNoPlan(props: DatabaseCommonInteractionProps): boolean {
    return Boolean(props.isRoot) || Boolean(props.isMasterAdmin);
  }

  /*
   * Whether billing holds these props to their project's plan: they act in a
   * project on a server with billing on, and are neither OneUptime itself nor
   * a server admin.
   */
  public static isHeldToPlan(props: DatabaseCommonInteractionProps): boolean {
    return (
      IsBillingEnabled &&
      !CallerPlan.isHeldToNoPlan(props) &&
      Boolean(props.tenantId)
    );
  }

  /*
   * Whether billing holds these props to a plan they do not carry: they are
   * held to their project's plan (isHeldToPlan) and carry none.
   */
  public static isPlanMissing(props: DatabaseCommonInteractionProps): boolean {
    return CallerPlan.isHeldToPlan(props) && !props.currentPlan;
  }

  /*
   * What a plan check does when it meets props whose plan is missing: refuse.
   * Never "any plan".
   */
  public static assertPlanKnown(props: DatabaseCommonInteractionProps): void {
    if (CallerPlan.isPlanMissing(props)) {
      throw new NotAuthorizedException(CallerPlan.PLAN_UNKNOWN_MESSAGE);
    }
  }

  /*
   * The props, with their project's plan when they act in a project and
   * carry none: a copy, so a caller's own object is left as it was. Props
   * that carry a plan, or need none, come back as they are. Throws when the
   * project's plan cannot be read (a project that does not exist, or has no
   * plan yet), as every API request of that project does.
   */
  public static async withPlan(
    props: DatabaseCommonInteractionProps,
  ): Promise<DatabaseCommonInteractionProps> {
    if (!CallerPlan.isPlanMissing(props)) {
      return props;
    }

    const plan: CurrentPlan = await CallerPlan.readPlan(
      props.tenantId as ObjectID,
    );

    const withPlan: DatabaseCommonInteractionProps = {
      ...props,
      isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
    };

    if (plan.plan) {
      withPlan.currentPlan = plan.plan;
    }

    return withPlan;
  }

  /*
   * withPlan, for an operation on a database model: the plan is read only
   * when the operation needs it - the table names a plan for it, or a
   * create or update writes a column that names one (PlanGates). Every other
   * operation needs no plan, and its props come back as they are.
   */
  public static async withPlanFor(data: {
    props: DatabaseCommonInteractionProps;
    modelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    // What a create or update writes.
    data?: unknown;
  }): Promise<DatabaseCommonInteractionProps> {
    if (
      !CallerPlan.isPlanMissing(data.props) ||
      !PlanGates.isPlanAtStake(new data.modelType(), data.type, data.data)
    ) {
      return data.props;
    }

    return await CallerPlan.withPlan(data.props);
  }

  // withPlanFor, for an operation on an analytics model.
  public static async withAnalyticsPlanFor(data: {
    props: DatabaseCommonInteractionProps;
    modelType: AnalyticsBaseModelType;
    type: DatabaseRequestType;
    data?: unknown;
  }): Promise<DatabaseCommonInteractionProps> {
    if (
      !CallerPlan.isPlanMissing(data.props) ||
      !PlanGates.isAnalyticsPlanAtStake(
        new data.modelType(),
        data.type,
        data.data,
      )
    ) {
      return data.props;
    }

    return await CallerPlan.withPlan(data.props);
  }

  /*
   * The props of one project of a read across projects (TenantPermission,
   * the analytics ModelPermission, PerProjectReadScope): that project as the
   * tenant, read on its own plan. A plan is the plan of the project it was
   * read for, so one carried for another project is dropped first.
   */
  public static async inProject(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<DatabaseCommonInteractionProps> {
    return await CallerPlan.withPlan(
      CallerPlan.inProjectWithoutPlan(props, projectId),
    );
  }

  /*
   * inProject without reading the plan: for a caller that reads it later,
   * through withPlan, on the object it keeps.
   */
  public static inProjectWithoutPlan(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): DatabaseCommonInteractionProps {
    const projectProps: DatabaseCommonInteractionProps = {
      ...props,
      tenantId: projectId,
      isMultiTenantRequest: false,
    };

    if (
      !props.tenantId ||
      props.tenantId.toString().toLowerCase() !==
        projectId.toString().toLowerCase()
    ) {
      delete projectProps.currentPlan;
      delete projectProps.isSubscriptionUnpaid;
    }

    return projectProps;
  }

  /*
   * Required rather than imported: ProjectService is a DatabaseService, and
   * DatabaseService reads plans through here.
   */
  private static async readPlan(projectId: ObjectID): Promise<CurrentPlan> {
    const projectService: CurrentPlanReader =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/ProjectService").default;

    return await projectService.getCurrentPlan(projectId);
  }
}
