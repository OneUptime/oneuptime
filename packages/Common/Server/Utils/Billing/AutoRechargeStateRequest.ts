import { IsBillingEnabled } from "../../EnvironmentConfig";
import AIBillingService from "../../Services/AIBillingService";
import NotificationService from "../../Services/NotificationService";
import ProjectService from "../../Services/ProjectService";
import { OneUptimeRequest } from "../Express";
import CallerPermission from "../Permission/CallerPermission";
import Project from "../../../Models/DatabaseModels/Project";
import AutoRechargeState from "../../../Types/Billing/AutoRechargeState";
import ProjectBalanceType from "../../../Types/Billing/ProjectBalanceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * What Auto Recharge of one of the project's prepaid balances would do now,
 * for the page that holds the balance: GET /notification/auto-recharge-state
 * (Project Settings > Notification Settings) and GET /ai/auto-recharge-state
 * (Project Settings > AI Credits). Off, Ready, or Failed - its last automatic
 * charge did not go through, and it waits before it tries the card again -
 * which the page shows at the top, so nobody has to wait for the owners'
 * email to learn that Auto Recharge has stopped.
 *
 * Asked about the project the request names (its tenant), by a member of it
 * or a master admin: every member reads the Auto Recharge settings on those
 * pages, and whether the last charge went through is the same kind of fact.
 * Anybody else learns nothing - not whether the project exists.
 *
 * Where OneUptime does not bill there is no Auto Recharge: Off.
 */
export default class AutoRechargeStateRequest {
  public static async getState(data: {
    req: OneUptimeRequest;
    balance: ProjectBalanceType;
  }): Promise<AutoRechargeState> {
    const projectId: ObjectID | null = data.req.tenantId || null;

    if (!projectId) {
      throw new BadDataException("Project ID is required");
    }

    if (
      !CallerPermission.isProjectMember(data.req, projectId) &&
      !data.req.userAuthorization?.isMasterAdmin
    ) {
      throw new BadDataException("You do not have access to this project");
    }

    if (!IsBillingEnabled) {
      return AutoRechargeState.Off;
    }

    if (data.balance === ProjectBalanceType.AI) {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAutoRechargeAiBalance: true,
          autoAiRechargeByBalanceInUSD: true,
          autoRechargeAiWhenCurrentBalanceFallsInUSD: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        throw new BadDataException("Project not found");
      }

      return await AIBillingService.getAutoRechargeState({
        projectId,
        project,
      });
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: true,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    return await NotificationService.getAutoRechargeState({
      projectId,
      project,
    });
  }
}
