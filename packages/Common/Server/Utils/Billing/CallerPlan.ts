import { IsBillingEnabled } from "../../EnvironmentConfig";
import type { CurrentPlan } from "../../Services/ProjectService";
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
 *    none. DatabaseService and ModelPermission ask it before they check a
 *    read or write, and so do the builders of props that act in a project
 *    (WorkflowPrincipal, WorkspaceActionAuthorization).
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
 */

interface CurrentPlanReader {
  getCurrentPlan: (projectId: ObjectID) => Promise<CurrentPlan>;
}

export default class CallerPlan {
  public static readonly PLAN_UNKNOWN_MESSAGE: string =
    "OneUptime could not confirm which plan this project is on, so nothing was changed. Please try again in a moment.";

  /*
   * Whether billing holds these props to a plan they do not carry: they act
   * in a project on a server with billing on, and are neither OneUptime
   * itself nor a server admin, whom no plan binds.
   */
  public static isPlanMissing(props: DatabaseCommonInteractionProps): boolean {
    return (
      IsBillingEnabled &&
      !props.isRoot &&
      !props.isMasterAdmin &&
      Boolean(props.tenantId) &&
      !props.currentPlan
    );
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
