import {
  ProjectBillingHooks,
  ProjectBillingState,
} from "Common/Server/Enterprise/EnterpriseServerModule";
import logger from "Common/Server/Utils/Logger";
import CloudMarketplace from "Common/Types/Marketplace/CloudMarketplace";
import ObjectID from "Common/Types/ObjectID";
import MarketplacePurchases from "./MarketplacePurchases";
import MarketplaceUsageReporter from "./MarketplaceUsageReporter";
import VercelMarketplaceResources from "./Vercel/VercelMarketplaceResources";

/*
 * What the cloud marketplaces and Vercel Marketplace do when ProjectService
 * deletes a project or moves a marketplace-billed one to another plan
 * (EnterpriseEdition.getProjectBillingHooks). ProjectService asks only with
 * billing on. None of these ever fails the change it hears of: each step
 * catches and logs what goes wrong, and the next step still runs.
 */
const CloudMarketplaceProjectBillingHooks: ProjectBillingHooks = {
  /*
   * A marketplace bills a project's usage by the hour, after the hour: what
   * a project it bills used since the last hourly report, and the balance
   * top-ups bought since, are billed now, while the project is still there
   * to be priced (MarketplaceUsageReporter.reportFinalUsageOfProject, which
   * never waits on a marketplace). A project billed by card has nothing to
   * report.
   */
  beforeProjectsDelete: async (
    projects: Array<ProjectBillingState>,
  ): Promise<void> => {
    for (const project of projects) {
      if (!project.billingMarketplace) {
        continue;
      }

      try {
        await MarketplaceUsageReporter.reportFinalUsageOfProject(
          project.projectId,
        );
      } catch (err) {
        logger.error(err);
      }
    }
  },

  /*
   * A Vercel resource IS its project: deleting the project in OneUptime
   * deletes the resource on Vercel too, which takes its environment
   * variables out of the Vercel projects connected to it. One Vercel deleted
   * itself has ended already, and nothing is sent.
   *
   * Then every deleted project's marketplace purchase stops being reported
   * against it: its last usage was billed before the delete. The purchase
   * itself is the buyer's, on the marketplace: it is cancelled there, or
   * linked to another project from the marketplace's "manage" link.
   */
  afterProjectsDelete: async (
    projects: Array<ProjectBillingState>,
  ): Promise<void> => {
    for (const project of projects) {
      if (project.billingMarketplace !== CloudMarketplace.Vercel) {
        continue;
      }

      try {
        await VercelMarketplaceResources.onProjectDeleted(project.projectId);
      } catch (err) {
        logger.error(err);
      }
    }

    for (const project of projects) {
      try {
        await MarketplacePurchases.unlinkProject(project.projectId);
      } catch (err) {
        logger.error(err);
      }
    }
  },

  /*
   * On Vercel the plan is the resource's billing plan, which the team sees
   * in its Vercel dashboard: it follows a change made in OneUptime. The other
   * marketplaces bill the new plan's per-user price from the next hourly
   * usage report on, and need telling nothing.
   */
  afterMarketplacePlanChange: async (data: {
    projectId: ObjectID;
    billingMarketplace: CloudMarketplace;
    paymentProviderPlanId: string;
  }): Promise<void> => {
    if (data.billingMarketplace !== CloudMarketplace.Vercel) {
      return;
    }

    try {
      await VercelMarketplaceResources.onPlanChanged({
        projectId: data.projectId,
        paymentProviderPlanId: data.paymentProviderPlanId,
      });
    } catch (err) {
      logger.error(err);
    }
  },
};

export default CloudMarketplaceProjectBillingHooks;
