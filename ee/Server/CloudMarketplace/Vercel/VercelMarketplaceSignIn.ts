import MarketplaceSubscription from "Common/Models/DatabaseModels/MarketplaceSubscription";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import VercelMarketplaceInstallation from "Common/Models/DatabaseModels/VercelMarketplaceInstallation";
import { DashboardRoute } from "Common/ServiceRoute";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import VercelInstallationStatus from "Common/Types/Marketplace/VercelInstallationStatus";
import ObjectID from "Common/Types/ObjectID";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import VercelMarketplaceInstallationService from "Common/Server/Services/VercelMarketplaceInstallationService";
import logger from "Common/Server/Utils/Logger";
import MarketplaceConfig from "../MarketplaceConfig";
import {
  VercelMarketplaceCaller,
  VercelUserRole,
} from "./VercelMarketplaceAuth";
import VercelMarketplaceResources from "./VercelMarketplaceResources";

/*
 * Signing in from Vercel ("Open in OneUptime", a resource's links, the
 * support link): which OneUptime projects the person gets into, as whom, and
 * which page they land on. The sign-in itself - the code exchange, the
 * OneUptime account, the session - is the Identity service's
 * (App/FeatureSet/Identity/API/VercelSignIn).
 *
 * Everyone in the Vercel team may open the team's OneUptime resources:
 * Vercel only signs in people of the team that installed OneUptime. A
 * Vercel admin joins each resource's project in its Admin team, anyone else
 * (Vercel's Billing and Viewer roles) in its Members team. Someone already
 * in the project keeps the teams they are in.
 */

const TEAM_OF_ROLE: Record<VercelUserRole, string> = {
  ADMIN: "Admin",
  USER: "Members",
};

export interface VercelSignInRequest {
  resourceId?: string | undefined;
  path?: string | undefined;
  invoiceId?: string | undefined;
  isSupport?: boolean | undefined;
}

export class VercelSignInError extends Error {
  public readonly userMessage: string;

  public constructor(userMessage: string) {
    super(userMessage);
    this.name = "VercelSignInError";
    this.userMessage = userMessage;
  }
}

export default class VercelMarketplaceSignIn {
  /*
   * The projects the person signs in to: the resource Vercel named, or every
   * resource of the installation. Ended resources are left out.
   */
  public static async getPurchases(data: {
    caller: VercelMarketplaceCaller;
    resourceId?: string | undefined;
  }): Promise<Array<MarketplaceSubscription>> {
    if (!data.caller.installationId) {
      throw new VercelSignInError(
        "Vercel did not say which installation you came from. Open OneUptime from your Vercel dashboard again.",
      );
    }

    const installation: VercelMarketplaceInstallation | null =
      await VercelMarketplaceInstallationService.findByInstallationId(
        data.caller.installationId,
      );

    if (
      !installation ||
      installation.status !== VercelInstallationStatus.Active
    ) {
      throw new VercelSignInError(
        "OneUptime is not installed on this Vercel team. Add OneUptime from the Vercel Marketplace first.",
      );
    }

    const purchases: Array<MarketplaceSubscription> = data.resourceId
      ? [
          await VercelMarketplaceResources.findPurchase({
            installationId: data.caller.installationId,
            resourceId: data.resourceId,
          }),
        ].filter(
          (
            purchase: MarketplaceSubscription | null,
          ): purchase is MarketplaceSubscription => {
            return Boolean(purchase);
          },
        )
      : await VercelMarketplaceResources.listPurchases(
          data.caller.installationId,
        );

    const open: Array<MarketplaceSubscription> = purchases.filter(
      (purchase: MarketplaceSubscription): boolean => {
        return (
          Boolean(purchase.projectId) &&
          purchase.status !== MarketplaceSubscriptionStatus.Cancelled
        );
      },
    );

    if (open.length === 0) {
      throw new VercelSignInError(
        data.resourceId
          ? "This OneUptime resource was deleted, or is not finished being set up. Open it from your Vercel dashboard again in a minute."
          : "This Vercel team has no OneUptime resource yet. Add one from the OneUptime integration in your Vercel dashboard.",
      );
    }

    return open;
  }

  // The person is in each project, in the team their Vercel role gives them.
  public static async ensureMemberships(data: {
    userId: ObjectID;
    role: VercelUserRole;
    purchases: Array<MarketplaceSubscription>;
  }): Promise<void> {
    let isChanged: boolean = false;

    for (const purchase of data.purchases) {
      const projectId: ObjectID = purchase.projectId!;

      const existing: TeamMember | null = await TeamMemberService.findOneBy({
        query: { projectId: projectId, userId: data.userId },
        select: { _id: true, hasAcceptedInvitation: true },
        props: { isRoot: true },
      });

      if (existing) {
        if (!existing.hasAcceptedInvitation) {
          await TeamMemberService.updateOneById({
            id: existing.id!,
            data: { hasAcceptedInvitation: true },
            props: { isRoot: true },
          });
          isChanged = true;
        }

        continue;
      }

      const team: Team | null = await TeamService.findOneBy({
        query: { projectId: projectId, name: TEAM_OF_ROLE[data.role] },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!team) {
        logger.error(
          `Project ${projectId.toString()} of Vercel resource ${purchase.externalSubscriptionId} has no ${TEAM_OF_ROLE[data.role]} team to add a Vercel user to.`,
        );
        continue;
      }

      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = team.id!;
      member.userId = data.userId;
      member.hasAcceptedInvitation = true;

      try {
        await TeamMemberService.create({
          data: member,
          props: { isRoot: true },
        });
        isChanged = true;
      } catch (err) {
        // A plan's limit on people, most likely: said in the dashboard's own words.
        throw new VercelSignInError(
          `You could not be added to the OneUptime project of this resource: ${(err as Error).message}`,
        );
      }
    }

    if (isChanged) {
      await AccessTokenService.refreshUserAllPermissions(data.userId);
    }
  }

  /*
   * Where the person lands: the resource's billing page for an invoice or
   * the billing and usage links, its ingestion keys for the secrets link,
   * OneUptime support for a support link, and otherwise the project's home.
   */
  public static getRedirectUrl(data: {
    projectId: ObjectID;
    request: VercelSignInRequest;
  }): string {
    const project: string = `${DashboardRoute.toString()}/${data.projectId.toString()}`;

    if (data.request.isSupport || data.request.path === "support") {
      return `${MarketplaceConfig.getPublicOrigin()}/support`;
    }

    if (
      data.request.invoiceId ||
      data.request.path === "billing" ||
      data.request.path === "usage"
    ) {
      return `${project}/settings/billing`;
    }

    if (data.request.path === "secrets") {
      return `${project}/settings/telemetry-ingestion-keys`;
    }

    return `${project}/home/`;
  }
}
