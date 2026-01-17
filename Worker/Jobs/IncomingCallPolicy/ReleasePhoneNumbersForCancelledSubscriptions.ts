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
import { ICallProvider } from "Common/Types/Call/CallProvider";
import CallProviderFactory from "../../../App/FeatureSet/Notification/Providers/CallProviderFactory";

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

    // Find all projects with cancelled subscriptions
    const cancelledProjects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionStatus: SubscriptionStatus.Canceled,
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

    // Find projects with unpaid subscriptions
    const unpaidProjects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionStatus: SubscriptionStatus.Unpaid,
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

    // Find projects with expired subscriptions
    const expiredProjects: Array<Project> = await ProjectService.findAllBy({
      query: {
        paymentProviderSubscriptionStatus: SubscriptionStatus.Expired,
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

    // Also check metered subscription status - cancelled
    const meteredCancelledProjects: Array<Project> =
      await ProjectService.findAllBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Canceled,
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

    // Metered - unpaid
    const meteredUnpaidProjects: Array<Project> =
      await ProjectService.findAllBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Unpaid,
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

    // Metered - expired
    const meteredExpiredProjects: Array<Project> =
      await ProjectService.findAllBy({
        query: {
          paymentProviderMeteredSubscriptionStatus: SubscriptionStatus.Expired,
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

    // Combine and deduplicate all projects
    const projectIds: Set<string> = new Set<string>();
    const allCancelledProjects: Array<Project> = [];

    for (const project of [
      ...cancelledProjects,
      ...unpaidProjects,
      ...expiredProjects,
      ...meteredCancelledProjects,
      ...meteredUnpaidProjects,
      ...meteredExpiredProjects,
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

        // Filter to only policies with phone numbers
        const policiesWithPhoneNumbers: Array<IncomingCallPolicy> =
          policies.filter((p: IncomingCallPolicy) => {
            return p.routingPhoneNumber && p.callProviderPhoneNumberId;
          });

        if (policiesWithPhoneNumbers.length === 0) {
          continue;
        }

        // Get project owners for notifications
        const projectOwners: Array<User> = await ProjectService.getOwners(
          project.id!,
        );

        for (const policy of policiesWithPhoneNumbers) {
          try {
            const isUsingProjectConfig: boolean = Boolean(
              policy.projectCallSMSConfigId,
            );
            const phoneNumber: string =
              policy.routingPhoneNumber?.toString() || "";

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
                routingPhoneNumber: null as any,
                callProviderPhoneNumberId: null as any,
                phoneNumberCountryCode: null as any,
                phoneNumberAreaCode: null as any,
                callProviderCostPerMonthInUSDCents: null as any,
                customerCostPerMonthInUSDCents: null as any,
                phoneNumberPurchasedAt: null as any,
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
                  templateType:
                    EmailTemplateType.IncomingCallPhoneNumberReleased,
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
                  subject: "Your incoming call phone number has been released",
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
