import RunCron from "../../Utils/Cron";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import User from "Common/Models/DatabaseModels/User";
import MailService from "Common/Server/Services/MailService";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { In } from "typeorm";

/**
 * This job sends warning emails to project owners when their subscription is past due
 * and they have incoming call policies with phone numbers that will be released
 * if the subscription is cancelled.
 *
 * Only policies using the global Twilio config (no projectCallSMSConfigId) are affected
 * since those phone numbers are owned by OneUptime and will be released.
 */
RunCron(
  "IncomingCallPolicy:SendWarningEmailsForPastDueSubscriptions",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    if (!IsBillingEnabled) {
      return;
    }

    // Find all projects with past due subscriptions
    const pastDueProjects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionStatus: In([
          SubscriptionStatus.PastDue,
        ]),
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      skip: 0,
    });

    // Also check metered subscription status
    const meteredPastDueProjects: Array<Project> =
      await ProjectService.findAllBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: In([
            SubscriptionStatus.PastDue,
          ]),
        },
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
        skip: 0,
      });

    // Combine and deduplicate
    const projectIds = new Set<string>();
    const allPastDueProjects: Array<Project> = [];

    for (const project of [...pastDueProjects, ...meteredPastDueProjects]) {
      if (project.id && !projectIds.has(project.id.toString())) {
        projectIds.add(project.id.toString());
        allPastDueProjects.push(project);
      }
    }

    for (const project of allPastDueProjects) {
      try {
        // Find all incoming call policies for this project that:
        // 1. Have a phone number (routingPhoneNumber is set)
        // 2. Use global config (projectCallSMSConfigId is null)
        const policies: Array<IncomingCallPolicy> =
          await IncomingCallPolicyService.findAllBy({
            query: {
              projectId: project.id!,
              projectCallSMSConfigId: undefined, // Only global config policies
            },
            select: {
              _id: true,
              name: true,
              routingPhoneNumber: true,
            },
            props: {
              isRoot: true,
            },
            skip: 0,
          });

        // Filter to only policies with phone numbers
        const policiesWithPhoneNumbers = policies.filter(
          (p: IncomingCallPolicy) => p.routingPhoneNumber,
        );

        if (policiesWithPhoneNumbers.length === 0) {
          continue;
        }

        // Get project owners
        const projectOwners: Array<User> = await ProjectService.getOwners(
          project.id!,
        );

        if (!projectOwners || projectOwners.length === 0) {
          logger.info({
            message:
              "No project owners found for past due subscription with incoming call policies.",
            projectId: project.id?.toString(),
          });
          continue;
        }

        // Send email for each policy with a phone number
        for (const policy of policiesWithPhoneNumbers) {
          for (const owner of projectOwners) {
            if (!owner.email) {
              continue;
            }

            MailService.sendMail(
              {
                toEmail: owner.email,
                templateType: EmailTemplateType.IncomingCallPhoneNumberAtRisk,
                vars: {
                  projectName: project.name || "Project",
                  policyName: policy.name || "Incoming Call Policy",
                  phoneNumber: policy.routingPhoneNumber?.toString() || "",
                  dashboardLink: (
                    await ProjectService.getProjectLinkInDashboard(project.id!)
                  ).toString(),
                },
                subject:
                  "[Action Required] Your incoming call phone number is at risk",
              },
              {
                projectId: project.id!,
                userId: owner.id!,
              },
            ).catch((err: Error) => {
              logger.error(err);
            });
          }
        }

        logger.info({
          message: "Sent warning emails for past due incoming call policies",
          projectId: project.id?.toString(),
          policyCount: policiesWithPhoneNumbers.length,
        });
      } catch (error) {
        logger.error({
          message:
            "Error while sending warning emails for past due incoming call policies",
          error,
          projectId: project.id?.toString(),
        });
      }
    }
  },
);
