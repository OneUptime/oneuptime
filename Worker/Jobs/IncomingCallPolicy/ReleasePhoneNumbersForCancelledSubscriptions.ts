import RunCron from "../../Utils/Cron";
import SubscriptionStatus from "Common/Types/Billing/SubscriptionStatus";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import {
  IsBillingEnabled,
  IsDevelopment,
} from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import logger from "Common/Server/Utils/Logger";
import Project from "Common/Models/DatabaseModels/Project";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import User from "Common/Models/DatabaseModels/User";
import MailService from "Common/Server/Services/MailService";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { In } from "typeorm";
import { ICallProvider } from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";

// Import dynamically to avoid circular dependencies
let CallProviderFactory: typeof import("../../../App/FeatureSet/Notification/Providers/CallProviderFactory").default;

/**
 * This job releases phone numbers and disables incoming call policies
 * for projects with cancelled subscriptions.
 *
 * For policies using global Twilio config:
 * - Release the phone number from Twilio (to stop incurring costs)
 * - Disable the policy
 * - Send notification email
 *
 * For policies using project's own Twilio config:
 * - Do NOT release the phone number (it's in their account)
 * - Disable the policy (so OneUptime stops routing)
 * - Send notification email
 */
RunCron(
  "IncomingCallPolicy:ReleasePhoneNumbersForCancelledSubscriptions",
  { schedule: IsDevelopment ? EVERY_MINUTE : EVERY_DAY, runOnStartup: false },
  async () => {
    if (!IsBillingEnabled) {
      return;
    }

    // Dynamically import CallProviderFactory to avoid circular dependencies
    if (!CallProviderFactory) {
      CallProviderFactory = (
        await import(
          "../../../App/FeatureSet/Notification/Providers/CallProviderFactory"
        )
      ).default;
    }

    // Find all projects with cancelled/unpaid/expired subscriptions
    const cancelledStatuses = [
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Unpaid,
      SubscriptionStatus.Expired,
      SubscriptionStatus.IncompleteExpired,
    ];

    const cancelledProjects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionStatus: In(cancelledStatuses),
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
    const meteredCancelledProjects: Array<Project> =
      await ProjectService.findAllBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: In(cancelledStatuses),
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
    const allCancelledProjects: Array<Project> = [];

    for (const project of [
      ...cancelledProjects,
      ...meteredCancelledProjects,
    ]) {
      if (project.id && !projectIds.has(project.id.toString())) {
        projectIds.add(project.id.toString());
        allCancelledProjects.push(project);
      }
    }

    for (const project of allCancelledProjects) {
      try {
        // Find all incoming call policies for this project with phone numbers
        const policies: Array<IncomingCallPolicy> =
          await IncomingCallPolicyService.findAllBy({
            query: {
              projectId: project.id!,
            },
            select: {
              _id: true,
              name: true,
              routingPhoneNumber: true,
              callProviderPhoneNumberId: true,
              projectCallSMSConfigId: true,
              isEnabled: true,
            },
            props: {
              isRoot: true,
            },
            skip: 0,
          });

        // Filter to only policies with phone numbers that are still enabled
        const policiesWithPhoneNumbers = policies.filter(
          (p: IncomingCallPolicy) =>
            p.routingPhoneNumber && p.callProviderPhoneNumberId,
        );

        if (policiesWithPhoneNumbers.length === 0) {
          continue;
        }

        // Get project owners for notifications
        const projectOwners: Array<User> = await ProjectService.getOwners(
          project.id!,
        );

        for (const policy of policiesWithPhoneNumbers) {
          try {
            const isUsingProjectConfig = Boolean(policy.projectCallSMSConfigId);
            const phoneNumber = policy.routingPhoneNumber?.toString() || "";

            // Only release phone number if using global config
            if (!isUsingProjectConfig && policy.callProviderPhoneNumberId) {
              try {
                const provider: ICallProvider =
                  await CallProviderFactory.getProvider();
                await provider.releaseNumber(policy.callProviderPhoneNumberId);

                logger.info({
                  message: "Released phone number for cancelled subscription",
                  projectId: project.id?.toString(),
                  policyId: policy.id?.toString(),
                  phoneNumber: phoneNumber,
                });
              } catch (releaseError) {
                logger.error({
                  message: "Failed to release phone number from Twilio",
                  error: releaseError,
                  projectId: project.id?.toString(),
                  policyId: policy.id?.toString(),
                  phoneNumber: phoneNumber,
                });
                // Continue to disable the policy even if release fails
              }
            }

            // Disable the policy and clear phone number fields
            await IncomingCallPolicyService.updateOneById({
              id: policy.id!,
              data: {
                isEnabled: false,
                routingPhoneNumber: undefined as any,
                callProviderPhoneNumberId: undefined as any,
                phoneNumberCountryCode: undefined as any,
                phoneNumberAreaCode: undefined as any,
                callProviderCostPerMonthInUSDCents: undefined as any,
                customerCostPerMonthInUSDCents: undefined as any,
                phoneNumberPurchasedAt: undefined as any,
              },
              props: {
                isRoot: true,
              },
            });

            logger.info({
              message:
                "Disabled incoming call policy for cancelled subscription",
              projectId: project.id?.toString(),
              policyId: policy.id?.toString(),
              phoneNumber: phoneNumber,
              usedProjectConfig: isUsingProjectConfig,
            });

            // Send notification to project owners
            for (const owner of projectOwners) {
              if (!owner.email) {
                continue;
              }

              MailService.sendMail(
                {
                  toEmail: owner.email,
                  templateType: EmailTemplateType.IncomingCallPhoneNumberReleased,
                  vars: {
                    projectName: project.name || "Project",
                    policyName: policy.name || "Incoming Call Policy",
                    phoneNumber: phoneNumber,
                    dashboardLink: (
                      await ProjectService.getProjectLinkInDashboard(
                        project.id!,
                      )
                    ).toString(),
                  },
                  subject:
                    "Your incoming call phone number has been released",
                },
                {
                  projectId: project.id!,
                  userId: owner.id!,
                },
              ).catch((err: Error) => {
                logger.error(err);
              });
            }
          } catch (policyError) {
            logger.error({
              message:
                "Error processing incoming call policy for cancelled subscription",
              error: policyError,
              projectId: project.id?.toString(),
              policyId: policy.id?.toString(),
            });
          }
        }
      } catch (error) {
        logger.error({
          message:
            "Error processing project for cancelled subscription phone number release",
          error,
          projectId: project.id?.toString(),
        });
      }
    }
  },
);
