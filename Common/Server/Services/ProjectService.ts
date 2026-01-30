import ResellerPlan from "../../Models/DatabaseModels/ResellerPlan";
import {
  IsBillingEnabled,
  NotificationSlackWebhookOnCreateProject,
  NotificationSlackWebhookOnDeleteProject,
  NotificationSlackWebhookOnSubscriptionUpdate,
  getAllEnvVars,
} from "../EnvironmentConfig";
import AllMeteredPlans from "../Types/Billing/MeteredPlan/AllMeteredPlans";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import Errors from "../Utils/Errors";
import AccessTokenService from "./AccessTokenService";
import BillingService from "./BillingService";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import IncidentRoleService from "./IncidentRoleService";
import MailService from "./MailService";
import MonitorStatusService from "./MonitorStatusService";
import NotificationService from "./NotificationService";
import PromoCodeService from "./PromoCodeService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import TeamMemberService from "./TeamMemberService";
import TeamPermissionService from "./TeamPermissionService";
import TeamService from "./TeamService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserService from "./UserService";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../Types/Billing/SubscriptionStatus";
import {
  Black,
  Blue500,
  Gray500,
  Green,
  Moroon500,
  Purple500,
  Red,
  Teal500,
  Yellow,
  Yellow500,
} from "../../Types/BrandColors";
import Color from "../../Types/Color";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import Model from "../../Models/DatabaseModels/Project";
import PromoCode from "../../Models/DatabaseModels/PromoCode";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import Team from "../../Models/DatabaseModels/Team";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../Models/DatabaseModels/TeamPermission";
import User from "../../Models/DatabaseModels/User";
import Select from "../Types/Database/Select";
import Query from "../Types/Database/Query";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertSeverityService from "./AlertSeverityService";
import AlertState from "../../Models/DatabaseModels/AlertState";
import AlertStateService from "./AlertStateService";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseConfig from "../DatabaseConfig";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../Types/PositiveNumber";

export interface CurrentPlan {
  plan: PlanType | null;
  isSubscriptionUnpaid: boolean;
}

export class ProjectService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public getPlanType(planId: string): PlanType {
    if (!SubscriptionPlan.isValidPlanId(planId, getAllEnvVars())) {
      throw new BadDataException("Plan is invalid.");
    }

    return SubscriptionPlan.getPlanType(planId);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    data: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!data.data.name) {
      throw new BadDataException("Project name is required");
    }

    if (data.props.userId) {
      data.data.createdByUserId = data.props.userId;
    } else {
      throw new NotAuthorizedException(
        "User should be logged in to create the project.",
      );
    }

    logger.debug("Creating project for user " + data.props.userId);

    const user: User | null = await UserService.findOneById({
      id: data.props.userId,
      select: {
        name: true,
        email: true,
        companyPhoneNumber: true,
        companyName: true,
        utmCampaign: true,
        utmSource: true,
        utmMedium: true,
        utmTerm: true,
        utmContent: true,
        utmUrl: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new BadDataException("User not found.");
    }

    if (IsBillingEnabled) {
      if (!data.data.paymentProviderPlanId) {
        throw new BadDataException("Plan required to create the project.");
      }

      data.data.planName = this.getPlanType(data.data.paymentProviderPlanId);

      if (data.data.paymentProviderPromoCode) {
        /*
         * check if it exists in promcode table. Not all promocodes are in the table, only reseller ones are.
         * If they are not in the table, allow projetc creation to proceed.
         * If they are in the project table, then see if anyn restrictions on reseller plan apply and if it does,
         * apply those restictions to the project.
         */

        const promoCode: PromoCode | null = await PromoCodeService.findOneBy({
          query: {
            promoCodeId: data.data.paymentProviderPromoCode,
          },
          select: {
            isPromoCodeUsed: true,
            userEmail: true,
            resellerPlan: {
              _id: true,
              planType: true,
              monitorLimit: true,
              teamMemberLimit: true,
            } as Select<ResellerPlan>,
            resellerId: true,
            resellerLicenseId: true,
            planType: true,
            resellerPlanId: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (promoCode) {
          // check if the same user is creating the project.
          if (promoCode.userEmail?.toString() !== user.email?.toString()) {
            throw new BadDataException(
              "This promocode is assigned to a different user and cannot be used.",
            );
          }

          if (promoCode.isPromoCodeUsed) {
            throw new BadDataException("This promocode has already been used.");
          }

          if (promoCode.resellerPlan?.monitorLimit) {
            data.data.activeMonitorsLimit =
              promoCode.resellerPlan?.monitorLimit;
          }

          if (promoCode.resellerPlan?.teamMemberLimit) {
            data.data.seatLimit = promoCode.resellerPlan?.teamMemberLimit;
          }

          if (promoCode.planType !== data.data.planName) {
            throw new BadDataException(
              "Promocode is not valid for this plan. Please select the " +
                promoCode.planType +
                " plan.",
            );
          }

          if (promoCode.resellerLicenseId) {
            data.data.resellerLicenseId = promoCode.resellerLicenseId;
          }

          if (promoCode.resellerId) {
            data.data.resellerId = promoCode.resellerId;
          }

          if (promoCode.resellerPlanId) {
            data.data.resellerPlanId = promoCode.resellerPlanId;
          }
        }
      }

      if (
        data.data.paymentProviderPromoCode &&
        !(await BillingService.isPromoCodeValid(
          data.data.paymentProviderPromoCode,
        ))
      ) {
        throw new BadDataException("Promo code is invalid.");
      }

      // check if promocode is valid.
    }

    // check if the user has the project with the same name. If yes, reject.

    let existingProjectWithSameNameCount: number = 0;
    if (
      data.props.userGlobalAccessPermission &&
      data.props.userGlobalAccessPermission?.projectIds.length > 0
    ) {
      existingProjectWithSameNameCount = (
        await this.countBy({
          query: {
            _id: QueryHelper.any(
              data.props.userGlobalAccessPermission?.projectIds.map(
                (item: ObjectID) => {
                  return item.toString();
                },
              ) || [],
            ),
            name: QueryHelper.findWithSameText(data.data.name!),
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();
    }

    if (existingProjectWithSameNameCount > 0) {
      throw new BadDataException("Project with the same name already exists");
    }

    data.data.createdOwnerName = user.name!;
    data.data.createdOwnerEmail = user.email!;
    data.data.createdOwnerPhone = user.companyPhoneNumber!;
    data.data.createdOwnerCompanyName = user.companyName!;

    // UTM info.
    data.data.utmCampaign = user.utmCampaign!;
    data.data.utmSource = user.utmSource!;
    data.data.utmMedium = user.utmMedium!;
    data.data.utmTerm = user.utmTerm!;
    data.data.utmContent = user.utmContent!;
    data.data.utmUrl = user.utmUrl!;

    return Promise.resolve({ createBy: data, carryForward: null });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (IsBillingEnabled) {
      if (
        updateBy.data.businessDetails ||
        updateBy.data.businessDetailsCountry ||
        updateBy.data.financeAccountingEmail ||
        updateBy.data.sendInvoicesByEmail !== undefined
      ) {
        logger.debug(
          `[Invoice Email] ProjectService.onBeforeUpdate - syncing billing details to Stripe`,
        );
        logger.debug(
          `[Invoice Email] Fields being updated - businessDetails: ${Boolean(updateBy.data.businessDetails)}, businessDetailsCountry: ${Boolean(updateBy.data.businessDetailsCountry)}, financeAccountingEmail: ${Boolean(updateBy.data.financeAccountingEmail)}, sendInvoicesByEmail: ${updateBy.data.sendInvoicesByEmail}`,
        );

        // Sync to Stripe.
        const project: Model | null = await this.findOneById({
          id: new ObjectID(updateBy.query._id! as string),
          select: {
            paymentProviderCustomerId: true,
            financeAccountingEmail: true,
            sendInvoicesByEmail: true,
          },
          props: { isRoot: true },
        });

        logger.debug(
          `[Invoice Email] Project found - paymentProviderCustomerId: ${project?.paymentProviderCustomerId}, existing sendInvoicesByEmail: ${(project as any)?.sendInvoicesByEmail}`,
        );

        if (project?.paymentProviderCustomerId) {
          try {
            const sendInvoicesByEmailValue: boolean | null =
              updateBy.data.sendInvoicesByEmail !== undefined
                ? (updateBy.data.sendInvoicesByEmail as boolean)
                : (project as any).sendInvoicesByEmail || null;

            logger.debug(
              `[Invoice Email] Calling BillingService.updateCustomerBusinessDetails with sendInvoicesByEmail: ${sendInvoicesByEmailValue}`,
            );

            await BillingService.updateCustomerBusinessDetails(
              project.paymentProviderCustomerId,
              (updateBy.data.businessDetails as string) || "",
              (updateBy.data.businessDetailsCountry as string) || null,
              (updateBy.data.financeAccountingEmail as string) ||
                (project as any).financeAccountingEmail ||
                null,
              sendInvoicesByEmailValue,
            );

            logger.debug(
              `[Invoice Email] Successfully synced billing details to Stripe for customer ${project.paymentProviderCustomerId}`,
            );
          } catch (err) {
            logger.error(
              `[Invoice Email] Failed to update Stripe customer business details: ${err}`,
            );
          }
        } else {
          logger.debug(
            `[Invoice Email] No paymentProviderCustomerId found, skipping Stripe sync`,
          );
        }
      }
      if (updateBy.data.enableAutoRechargeSmsOrCallBalance) {
        await NotificationService.rechargeIfBalanceIsLow(
          new ObjectID(updateBy.query._id! as string),
          {
            autoRechargeSmsOrCallByBalanceInUSD: updateBy.data
              .autoRechargeSmsOrCallByBalanceInUSD as number,
            autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: updateBy.data
              .autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD as number,
            enableAutoRechargeSmsOrCallBalance: updateBy.data
              .enableAutoRechargeSmsOrCallBalance as boolean,
          },
        );
      }

      if (
        updateBy.data.paymentProviderPlanId &&
        !updateBy.props.ignoreHooks &&
        !updateBy.props.isRoot
      ) {
        throw new BadDataException(
          "Project plan cannot be updated directly. Please use the change plan API.",
        );
      }
    }

    return { updateBy, carryForward: [] };
  }

  @CaptureSpan()
  public async changePlan(params: {
    projectId: ObjectID;
    paymentProviderPlanId: string;
    endTrialAt?: Date | null;
  }): Promise<void> {
    if (!IsBillingEnabled) {
      throw new BadDataException("Billing is not enabled for this server");
    }

    const project: Model | null = await this.findOneById({
      id: params.projectId,
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
        paymentProviderSubscriptionSeats: true,
        paymentProviderPlanId: true,
        trialEndsAt: true,
        paymentProviderCustomerId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.paymentProviderSubscriptionId) {
      throw new BadDataException("Payment Provider subscription not found");
    }

    if (!project.paymentProviderMeteredSubscriptionId) {
      throw new BadDataException(
        "Payment Provider metered subscription not found",
      );
    }

    // Check if customer has payment methods before attempting to change plan
    if (!project.paymentProviderCustomerId) {
      throw new BadDataException("Payment Provider customer not found");
    }

    const hasPaymentMethods: boolean = await BillingService.hasPaymentMethods(
      project.paymentProviderCustomerId,
    );

    if (!hasPaymentMethods) {
      throw new BadDataException(Errors.BillingService.NO_PAYMENTS_METHODS);
    }

    const plan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        params.paymentProviderPlanId,
        getAllEnvVars(),
      );

    if (!plan) {
      throw new BadDataException("Invalid plan");
    }

    let seats: number | undefined = project.paymentProviderSubscriptionSeats;

    if (!seats || seats <= 0) {
      seats = await TeamMemberService.getUniqueTeamMemberCountInProject(
        project.id!,
      );
    }

    logger.debug(
      `Changing plan for project ${project.id?.toString()} to ${plan.getName()} with seats ${seats}`,
    );

    const endTrialAt: Date | undefined =
      params.endTrialAt !== undefined
        ? params.endTrialAt || undefined
        : project.trialEndsAt || undefined;

    const subscription: {
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt?: Date | undefined;
    } = await BillingService.changePlan({
      projectId: project.id!,
      subscriptionId: project.paymentProviderSubscriptionId,
      meteredSubscriptionId: project.paymentProviderMeteredSubscriptionId,
      serverMeteredPlans: AllMeteredPlans,
      newPlan: plan,
      quantity: seats,
      isYearly: plan.getYearlyPlanId() === params.paymentProviderPlanId,
      endTrialAt: endTrialAt,
    });

    const subscriptionState: SubscriptionStatus =
      await BillingService.getSubscriptionStatus(subscription.subscriptionId);

    const meteredSubscriptionState: SubscriptionStatus =
      await BillingService.getSubscriptionStatus(
        subscription.meteredSubscriptionId,
      );

    await this.updateOneById({
      id: project.id!,
      data: {
        paymentProviderPlanId: params.paymentProviderPlanId,
        paymentProviderSubscriptionId: subscription.subscriptionId,
        paymentProviderMeteredSubscriptionId:
          subscription.meteredSubscriptionId,
        paymentProviderSubscriptionSeats: seats,
        trialEndsAt: subscription.trialEndsAt || endTrialAt || new Date(),
        planName: SubscriptionPlan.getPlanType(
          params.paymentProviderPlanId,
          getAllEnvVars(),
        ),
        paymentProviderMeteredSubscriptionStatus: meteredSubscriptionState,
        paymentProviderSubscriptionStatus: subscriptionState,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    await this.sendSubscriptionChangeWebhookSlackNotification(project.id!);
  }

  private async sendSubscriptionChangeWebhookSlackNotification(
    projectId: ObjectID,
  ): Promise<void> {
    if (NotificationSlackWebhookOnSubscriptionUpdate) {
      // fetch project again.
      const project: Model | null = await this.findOneById({
        id: new ObjectID(projectId.toString()),
        select: {
          name: true,
          _id: true,
          createdOwnerName: true,
          createdOwnerEmail: true,
          planName: true,
          createdByUserId: true,
          paymentProviderSubscriptionStatus: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        throw new BadDataException("Project not found");
      }

      let slackMessage: string = `*Project Plan Changed:*
*Project Name:* ${project.name?.toString() || "N/A"}
*Project ID:* ${project.id?.toString() || "N/A"}
`;

      if (project.createdOwnerName && project.createdOwnerEmail) {
        slackMessage += `*Project Created By:* ${project?.createdOwnerName?.toString() + " (" + project.createdOwnerEmail.toString() + ")" || "N/A"}
`;
      }

      if (IsBillingEnabled) {
        // which plan?
        slackMessage += `*Plan:* ${project.planName?.toString() || "N/A"} 
*Subscription Status:* ${project.paymentProviderSubscriptionStatus?.toString() || "N/A"}
`;
      }

      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(NotificationSlackWebhookOnSubscriptionUpdate),
        text: slackMessage,
      }).catch((error: Exception) => {
        logger.error("Error sending slack message: " + error);
      });
    }
  }

  private async addDefaultScheduledMaintenanceState(
    createdItem: Model,
  ): Promise<Model> {
    let createdScheduledMaintenanceState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    createdScheduledMaintenanceState.name = "Scheduled";
    createdScheduledMaintenanceState.description =
      "When an event is scheduled, it belongs to this state";
    createdScheduledMaintenanceState.color = Black;
    createdScheduledMaintenanceState.isScheduledState = true;
    createdScheduledMaintenanceState.projectId = createdItem.id!;
    createdScheduledMaintenanceState.order = 1;

    createdScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.create({
        data: createdScheduledMaintenanceState,
        props: {
          isRoot: true,
        },
      });

    let ongoingScheduledMaintenanceState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    ongoingScheduledMaintenanceState.name = "Ongoing";
    ongoingScheduledMaintenanceState.description =
      "When an event is ongoing, it belongs to this state.";
    ongoingScheduledMaintenanceState.color = Yellow;
    ongoingScheduledMaintenanceState.isOngoingState = true;
    ongoingScheduledMaintenanceState.projectId = createdItem.id!;
    ongoingScheduledMaintenanceState.order = 2;

    ongoingScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.create({
        data: ongoingScheduledMaintenanceState,
        props: {
          isRoot: true,
        },
      });

    let endedScheduledMaintenanceState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    endedScheduledMaintenanceState.name = "Ended";
    endedScheduledMaintenanceState.description =
      "Scheduled maintenance events switch to this state when they end.";
    endedScheduledMaintenanceState.color = new Color("#4A4A4A");
    endedScheduledMaintenanceState.isEndedState = true;
    endedScheduledMaintenanceState.projectId = createdItem.id!;
    endedScheduledMaintenanceState.order = 3;

    endedScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.create({
        data: endedScheduledMaintenanceState,
        props: {
          isRoot: true,
        },
      });

    let completedScheduledMaintenanceState: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    completedScheduledMaintenanceState.name = "Completed";
    completedScheduledMaintenanceState.description =
      "When an event is completed, it belongs to this state.";
    completedScheduledMaintenanceState.color = Green;
    completedScheduledMaintenanceState.isResolvedState = true;
    completedScheduledMaintenanceState.projectId = createdItem.id!;
    completedScheduledMaintenanceState.order = 4;

    completedScheduledMaintenanceState =
      await ScheduledMaintenanceStateService.create({
        data: completedScheduledMaintenanceState,
        props: {
          isRoot: true,
        },
      });

    return createdItem;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // Create billing.

    if (IsBillingEnabled) {
      const customerId: string = await BillingService.createCustomer({
        name: createdItem.name!,
        email: createdItem.createdOwnerEmail!,
        id: createdItem.id!,
      });

      const plan: SubscriptionPlan | undefined =
        SubscriptionPlan.getSubscriptionPlanById(
          createdItem.paymentProviderPlanId!,
          getAllEnvVars(),
        );

      if (!plan) {
        throw new BadDataException("Invalid plan.");
      }
      // add subscription to this customer.

      const { subscriptionId, meteredSubscriptionId, trialEndsAt } =
        await BillingService.subscribeToPlan({
          projectId: createdItem.id!,
          customerId,
          serverMeteredPlans: AllMeteredPlans,
          plan,
          quantity: 1,
          isYearly:
            plan.getYearlyPlanId() === createdItem.paymentProviderPlanId!,
          trial: true,
          promoCode: createdItem.paymentProviderPromoCode,
        });

      await this.updateOneById({
        id: createdItem.id!,
        data: {
          paymentProviderCustomerId: customerId,
          paymentProviderSubscriptionId: subscriptionId,
          paymentProviderMeteredSubscriptionId: meteredSubscriptionId,
          paymentProviderSubscriptionSeats: 1,
          trialEndsAt: (trialEndsAt || null) as any,
        },
        props: {
          isRoot: true,
        },
      });

      // mark the promo code as used it it exists.

      if (createdItem.paymentProviderPromoCode) {
        await PromoCodeService.updateOneBy({
          query: {
            promoCodeId: createdItem.paymentProviderPromoCode,
          },
          data: {
            isPromoCodeUsed: true,
            promoCodeUsedAt: OneUptimeDate.getCurrentDate(),
            projectId: createdItem.id!,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    createdItem = await this.addDefaultIncidentSeverity(createdItem);
    createdItem = await this.addDefaultAlertSeverity(createdItem);
    createdItem = await this.addDefaultProjectTeams(createdItem);
    createdItem = await this.addDefaultMonitorStatus(createdItem);
    createdItem = await this.addDefaultIncidentState(createdItem);
    createdItem = await this.addDefaultScheduledMaintenanceState(createdItem);
    createdItem = await this.addDefaultAlertState(createdItem);
    createdItem = await this.addDefaultIncidentRoles(createdItem);

    if (NotificationSlackWebhookOnCreateProject) {
      // fetch project again.
      const project: Model | null = await this.findOneById({
        id: createdItem.id!,
        select: {
          name: true,
          _id: true,
          createdOwnerName: true,
          createdOwnerEmail: true,
          planName: true,
          createdByUserId: true,
          paymentProviderSubscriptionStatus: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        throw new BadDataException("Project not found");
      }

      let slackMessage: string = `*Project Created:*
*Project Name:* ${project.name?.toString() || "N/A"}
*Project ID:* ${project.id?.toString() || "N/A"}
`;

      if (project.createdOwnerName && project.createdOwnerEmail) {
        slackMessage += `*Created By:* ${project?.createdOwnerName?.toString() + " (" + project.createdOwnerEmail.toString() + ")" || "N/A"}
`;

        if (IsBillingEnabled) {
          // which plan?
          slackMessage += `*Plan:* ${project.planName?.toString() || "N/A"}
*Subscription Status:* ${project.paymentProviderSubscriptionStatus?.toString() || "N/A"}
`;
        }

        SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(NotificationSlackWebhookOnCreateProject),
          text: slackMessage,
        }).catch((error: Exception) => {
          logger.error("Error sending slack message: " + error);
        });
      }
    }

    return createdItem;
  }

  private async addDefaultIncidentState(createdItem: Model): Promise<Model> {
    let createdIncidentState: IncidentState = new IncidentState();
    createdIncidentState.name = "Identified";
    createdIncidentState.description =
      "When an incident is created, it belongs to this state";
    createdIncidentState.color = Red;
    createdIncidentState.isCreatedState = true;
    createdIncidentState.projectId = createdItem.id!;
    createdIncidentState.order = 1;

    createdIncidentState = await IncidentStateService.create({
      data: createdIncidentState,
      props: {
        isRoot: true,
      },
    });

    let acknowledgedIncidentState: IncidentState = new IncidentState();
    acknowledgedIncidentState.name = "Acknowledged";
    acknowledgedIncidentState.description =
      "When an incident is acknowledged, it belongs to this state.";
    acknowledgedIncidentState.color = Yellow;
    acknowledgedIncidentState.isAcknowledgedState = true;
    acknowledgedIncidentState.projectId = createdItem.id!;
    acknowledgedIncidentState.order = 2;

    acknowledgedIncidentState = await IncidentStateService.create({
      data: acknowledgedIncidentState,
      props: {
        isRoot: true,
      },
    });

    let resolvedIncidentState: IncidentState = new IncidentState();
    resolvedIncidentState.name = "Resolved";
    resolvedIncidentState.description =
      "When an incident is resolved, it belongs to this state.";
    resolvedIncidentState.color = Green;
    resolvedIncidentState.isResolvedState = true;
    resolvedIncidentState.projectId = createdItem.id!;
    resolvedIncidentState.order = 3;

    resolvedIncidentState = await IncidentStateService.create({
      data: resolvedIncidentState,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  @CaptureSpan()
  public async addDefaultAlertState(createdItem: Model): Promise<Model> {
    let createdAlertState: AlertState = new AlertState();
    createdAlertState.name = "Identified";
    createdAlertState.description =
      "When an alert is created, it belongs to this state";
    createdAlertState.color = Red;
    createdAlertState.isCreatedState = true;
    createdAlertState.projectId = createdItem.id!;
    createdAlertState.order = 1;

    createdAlertState = await AlertStateService.create({
      data: createdAlertState,
      props: {
        isRoot: true,
      },
    });

    let acknowledgedAlertState: AlertState = new AlertState();
    acknowledgedAlertState.name = "Acknowledged";
    acknowledgedAlertState.description =
      "When an alert is acknowledged, it belongs to this state.";
    acknowledgedAlertState.color = Yellow;
    acknowledgedAlertState.isAcknowledgedState = true;
    acknowledgedAlertState.projectId = createdItem.id!;
    acknowledgedAlertState.order = 2;

    acknowledgedAlertState = await AlertStateService.create({
      data: acknowledgedAlertState,
      props: {
        isRoot: true,
      },
    });

    let resolvedAlertState: AlertState = new AlertState();
    resolvedAlertState.name = "Resolved";
    resolvedAlertState.description =
      "When an incident is resolved, it belongs to this state.";
    resolvedAlertState.color = Green;
    resolvedAlertState.isResolvedState = true;
    resolvedAlertState.projectId = createdItem.id!;
    resolvedAlertState.order = 3;

    resolvedAlertState = await AlertStateService.create({
      data: resolvedAlertState,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  @CaptureSpan()
  public async addDefaultAlertSeverity(createdItem: Model): Promise<Model> {
    let highSeverity: AlertSeverity = new AlertSeverity();
    highSeverity.name = "High";
    highSeverity.description =
      "Issues causing very high impact to customers. Immediate attention is required.";
    highSeverity.color = Moroon500;
    highSeverity.projectId = createdItem.id!;
    highSeverity.order = 1;

    highSeverity = await AlertSeverityService.create({
      data: highSeverity,
      props: {
        isRoot: true,
      },
    });

    let lowSeverity: AlertSeverity = new AlertSeverity();
    lowSeverity.name = "Low";
    lowSeverity.description = "Issues causing low impact to customers.";
    lowSeverity.color = Yellow500;
    lowSeverity.projectId = createdItem.id!;
    lowSeverity.order = 2;

    lowSeverity = await AlertSeverityService.create({
      data: lowSeverity,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  private async addDefaultIncidentSeverity(createdItem: Model): Promise<Model> {
    let criticalIncident: IncidentSeverity = new IncidentSeverity();
    criticalIncident.name = "Critical Incident";
    criticalIncident.description =
      "Issues causing very high impact to customers. Immediate response is required. Examples include a full outage, or a data breach.";
    criticalIncident.color = Moroon500;
    criticalIncident.projectId = createdItem.id!;
    criticalIncident.order = 1;

    criticalIncident = await IncidentSeverityService.create({
      data: criticalIncident,
      props: {
        isRoot: true,
      },
    });

    let majorIncident: IncidentSeverity = new IncidentSeverity();
    majorIncident.name = "Major Incident";
    majorIncident.description =
      "Issues causing significant impact. Immediate response is usually required. We might have some workarounds that mitigate the impact on customers. Examples include an important sub-system failing.";
    majorIncident.color = Red;
    majorIncident.projectId = createdItem.id!;
    majorIncident.order = 2;

    majorIncident = await IncidentSeverityService.create({
      data: majorIncident,
      props: {
        isRoot: true,
      },
    });

    let minorIncident: IncidentSeverity = new IncidentSeverity();
    minorIncident.name = "Minor Incident";
    minorIncident.description =
      "Issues with low impact, which can usually be handled within working hours. Most customers are unlikely to notice any problems. Examples include a slight drop in application performance.";
    minorIncident.color = Yellow;
    minorIncident.projectId = createdItem.id!;
    minorIncident.order = 3;

    minorIncident = await IncidentSeverityService.create({
      data: minorIncident,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  public async addDefaultIncidentRoles(createdItem: Model): Promise<Model> {
    let incidentCommander: IncidentRole = new IncidentRole();
    incidentCommander.name = "Incident Commander";
    incidentCommander.description =
      "Primary decision maker during an incident. Responsible for coordinating the response and making final decisions.";
    incidentCommander.color = Purple500;
    incidentCommander.projectId = createdItem.id!;
    incidentCommander.isPrimaryRole = true;
    incidentCommander.isDeleteable = false;

    incidentCommander = await IncidentRoleService.create({
      data: incidentCommander,
      props: {
        isRoot: true,
      },
    });

    let responder: IncidentRole = new IncidentRole();
    responder.name = "Responder";
    responder.description =
      "Active participant in incident resolution. Performs hands-on work to resolve the incident.";
    responder.color = Blue500;
    responder.projectId = createdItem.id!;

    responder = await IncidentRoleService.create({
      data: responder,
      props: {
        isRoot: true,
      },
    });

    let communicationsLead: IncidentRole = new IncidentRole();
    communicationsLead.name = "Communications Lead";
    communicationsLead.description =
      "Handles stakeholder communication and status updates during an incident.";
    communicationsLead.color = Teal500;
    communicationsLead.projectId = createdItem.id!;

    communicationsLead = await IncidentRoleService.create({
      data: communicationsLead,
      props: {
        isRoot: true,
      },
    });

    let observer: IncidentRole = new IncidentRole();
    observer.name = "Observer";
    observer.description =
      "Read-only participant who monitors the incident without active involvement.";
    observer.color = Gray500;
    observer.projectId = createdItem.id!;

    observer = await IncidentRoleService.create({
      data: observer,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  private async addDefaultMonitorStatus(createdItem: Model): Promise<Model> {
    let operationalStatus: MonitorStatus = new MonitorStatus();
    operationalStatus.name = "Operational";
    operationalStatus.description = "Monitor operating normally";
    operationalStatus.projectId = createdItem.id!;
    operationalStatus.priority = 1;
    operationalStatus.isOperationalState = true;
    operationalStatus.color = Green;

    operationalStatus = await MonitorStatusService.create({
      data: operationalStatus,
      props: {
        isRoot: true,
      },
    });

    let degradedStatus: MonitorStatus = new MonitorStatus();
    degradedStatus.name = "Degraded";
    degradedStatus.description = "Monitor is operating at reduced performance.";
    degradedStatus.priority = 2;
    degradedStatus.projectId = createdItem.id!;
    degradedStatus.color = Yellow;

    degradedStatus = await MonitorStatusService.create({
      data: degradedStatus,
      props: {
        isRoot: true,
      },
    });

    let downStatus: MonitorStatus = new MonitorStatus();
    downStatus.name = "Offline";
    downStatus.description = "Monitor is offline.";
    downStatus.isOfflineState = true;
    downStatus.projectId = createdItem.id!;
    downStatus.priority = 3;
    downStatus.color = Red;

    downStatus = await MonitorStatusService.create({
      data: downStatus,
      props: {
        isRoot: true,
      },
    });

    return createdItem;
  }

  private async addDefaultProjectTeams(createdItem: Model): Promise<Model> {
    // add a team member.

    // Owner Team.
    let ownerTeam: Team = new Team();
    ownerTeam.projectId = createdItem.id!;
    ownerTeam.name = "Owners";
    ownerTeam.shouldHaveAtLeastOneMember = true;
    ownerTeam.isPermissionsEditable = false;
    ownerTeam.isTeamEditable = false;
    ownerTeam.isTeamDeleteable = false;
    ownerTeam.description =
      "This team is for project owners. Adding team members to this team will give them root level permissions.";

    ownerTeam = await TeamService.create({
      data: ownerTeam,
      props: {
        isRoot: true,
      },
    });

    // Add current user to owners team.

    let ownerTeamMember: TeamMember = new TeamMember();
    ownerTeamMember.projectId = createdItem.id!;
    ownerTeamMember.userId = createdItem.createdByUserId!;
    ownerTeamMember.hasAcceptedInvitation = true;
    ownerTeamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
    ownerTeamMember.teamId = ownerTeam.id!;

    ownerTeamMember = await TeamMemberService.create({
      data: ownerTeamMember,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    // Add permissions for this team.

    const ownerPermissions: TeamPermission = new TeamPermission();
    ownerPermissions.permission = Permission.ProjectOwner;
    ownerPermissions.teamId = ownerTeam.id!;
    ownerPermissions.projectId = createdItem.id!;

    await TeamPermissionService.create({
      data: ownerPermissions,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    // Admin Team.
    const adminTeam: Team = new Team();
    adminTeam.projectId = createdItem.id!;
    adminTeam.name = "Admin";
    adminTeam.isPermissionsEditable = false;
    adminTeam.isTeamDeleteable = false;
    adminTeam.isTeamEditable = false;
    adminTeam.description =
      "This team is for project admins. Admins can invite members to any team and create project resources.";

    await TeamService.create({
      data: adminTeam,
      props: {
        isRoot: true,
      },
    });

    const adminPermissions: TeamPermission = new TeamPermission();
    adminPermissions.permission = Permission.ProjectAdmin;
    adminPermissions.teamId = adminTeam.id!;
    adminPermissions.projectId = createdItem.id!;

    await TeamPermissionService.create({
      data: adminPermissions,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    // Members Team.
    const memberTeam: Team = new Team();
    memberTeam.projectId = createdItem.id!;
    memberTeam.isPermissionsEditable = true;
    memberTeam.name = "Members";
    memberTeam.isTeamDeleteable = true;
    memberTeam.description =
      "This team is for project members. Members can interact with any project resources like monitors, incidents, etc.";

    await TeamService.create({
      data: memberTeam,
      props: {
        isRoot: true,
      },
    });

    const memberPermissions: TeamPermission = new TeamPermission();
    memberPermissions.permission = Permission.ProjectMember;
    memberPermissions.teamId = memberTeam.id!;
    memberPermissions.projectId = createdItem.id!;

    await TeamPermissionService.create({
      data: memberPermissions,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    await AccessTokenService.refreshUserAllPermissions(
      createdItem.createdByUserId!,
    );

    const user: User | null = await UserService.findOneById({
      id: createdItem.createdByUserId!,
      props: {
        isRoot: true,
      },
      select: {
        isEmailVerified: true,
        email: true,
      },
    });

    if (user && user.isEmailVerified) {
      await UserNotificationRuleService.addDefaultNotificationRuleForUser(
        createdItem.id!,
        user.id!,
        user.email!,
      );

      await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
        user.id!,
        createdItem.id!,
      );
    }

    return createdItem;
  }

  @CaptureSpan()
  public async updateLastActive(projectId: ObjectID): Promise<void> {
    await this.updateOneById({
      id: projectId,
      data: {
        lastActive: OneUptimeDate.getCurrentDate(),
      },
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getOwners(projectId: ObjectID): Promise<Array<User>> {
    if (!projectId) {
      throw new BadDataException("Project ID is required");
    }

    // get teams with project owner permissions.
    const teamPermissions: Array<TeamPermission> =
      await TeamPermissionService.findBy({
        query: {
          projectId: projectId,
          permission: Permission.ProjectOwner,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          teamId: true,
        },
      });

    if (teamPermissions.length === 0) {
      return [];
    }

    const teamIds: Array<ObjectID> = teamPermissions.map(
      (item: TeamPermission) => {
        return item.teamId!;
      },
    );

    return TeamMemberService.getUsersInTeams(teamIds);
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    // if user has no project id, then he should not be able to access any project.
    if (
      (!findBy.props.isRoot &&
        !findBy.props.userGlobalAccessPermission?.projectIds) ||
      findBy.props.userGlobalAccessPermission?.projectIds.length === 0
    ) {
      findBy.props.isRoot = true;
      findBy.query._id = ObjectID.getZeroObjectID().toString(); // should not get any projects.
    }

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const projects: Array<Model> = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      select: {
        _id: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
        name: true,
        createdByUser: {
          name: true,
          email: true,
        },
      },
    });

    return { deleteBy, carryForward: projects };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<Model>> {
    if (NotificationSlackWebhookOnDeleteProject) {
      for (const project of onDelete.carryForward) {
        let subscriptionStatus: SubscriptionStatus | null = null;

        if (IsBillingEnabled) {
          subscriptionStatus = await BillingService.getSubscriptionStatus(
            project.paymentProviderSubscriptionId!,
          );
        }

        let slackMessage: string = `*Project Deleted:*
*Project Name:* ${project.name?.toString() || "N/A"}
*Project ID:* ${project._id?.toString() || "N/A"}
`;

        if (subscriptionStatus) {
          slackMessage += `*Project Subscription Status:* ${subscriptionStatus?.toString() || "N/A"}
`;
        }

        if (
          project.createdByUser &&
          project.createdByUser.name &&
          project.createdByUser.email
        ) {
          slackMessage += `*Created By:* ${project?.createdByUser.name?.toString() + " (" + project.createdByUser.email.toString() + ")" || "N/A"}
`;
        }

        SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: URL.fromString(NotificationSlackWebhookOnDeleteProject),
          text: slackMessage,
        }).catch((err: Error) => {
          // log this error but do not throw it. Not important enough to stop the process.
          logger.error(err);
        });
      }
    }

    // get project id
    if (IsBillingEnabled) {
      for (const project of onDelete.carryForward) {
        if (project.paymentProviderSubscriptionId) {
          await BillingService.cancelSubscription(
            project.paymentProviderSubscriptionId,
          );
        }

        if (project.paymentProviderMeteredSubscriptionId) {
          await BillingService.cancelSubscription(
            project.paymentProviderMeteredSubscriptionId,
          );
        }
      }
    }

    return onDelete;
  }

  @CaptureSpan()
  public async getCurrentPlan(projectId: ObjectID): Promise<CurrentPlan> {
    if (!IsBillingEnabled) {
      return { plan: null, isSubscriptionUnpaid: false };
    }

    const project: Model | null = await this.findOneById({
      id: projectId,
      select: {
        paymentProviderPlanId: true,
        paymentProviderSubscriptionStatus: true,
        paymentProviderMeteredSubscriptionStatus: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project ID is invalid");
    }

    if (!project.paymentProviderPlanId) {
      throw new BadDataException("Project does not have any plans");
    }

    const plan: PlanType = SubscriptionPlan.getPlanType(
      project.paymentProviderPlanId,
      getAllEnvVars(),
    );

    return {
      plan: plan,
      isSubscriptionUnpaid:
        !BillingService.isSubscriptionActive(
          project.paymentProviderSubscriptionStatus!,
        ) ||
        !BillingService.isSubscriptionActive(
          project.paymentProviderMeteredSubscriptionStatus!,
        ),
    };
  }

  @CaptureSpan()
  public async sendEmailToProjectOwners(
    projectId: ObjectID,
    subject: string,
    message: string,
  ): Promise<void> {
    const owners: Array<User> = await this.getOwners(projectId);

    if (owners.length === 0) {
      return;
    }

    for (const owner of owners) {
      MailService.sendMail(
        {
          toEmail: owner.email!,
          templateType: EmailTemplateType.SimpleMessage,
          vars: {
            subject: subject,
            message: message,
          },
          subject: subject,
        },
        {
          projectId,
          userId: owner.id!,
        },
      ).catch((err: Error) => {
        logger.error(err);
      });
    }
  }

  @CaptureSpan()
  public async reactiveSubscription(projectId: ObjectID): Promise<void> {
    logger.debug("Reactivating subscription for project " + projectId);

    const project: Model | null = await this.findOneById({
      id: projectId!,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        paymentProviderCustomerId: true,
        paymentProviderSubscriptionId: true,
        paymentProviderMeteredSubscriptionId: true,
        paymentProviderSubscriptionSeats: true,
        paymentProviderPlanId: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    if (!project.paymentProviderCustomerId) {
      throw new BadDataException("Payment Provider customer not found");
    }

    if (!project.paymentProviderSubscriptionId) {
      throw new BadDataException("Payment Provider subscription not found");
    }

    if (!project.paymentProviderMeteredSubscriptionId) {
      throw new BadDataException(
        "Payment Provider metered subscription not found",
      );
    }

    if (!project.paymentProviderSubscriptionSeats) {
      throw new BadDataException(
        "Payment Provider subscription seats not found",
      );
    }

    if (!project.paymentProviderPlanId) {
      throw new BadDataException("Payment Provider plan id not found");
    }

    const subscriptionPlan: SubscriptionPlan | undefined =
      SubscriptionPlan.getSubscriptionPlanById(
        project.paymentProviderPlanId,
        getAllEnvVars(),
      );

    if (!subscriptionPlan) {
      throw new BadDataException("Subscription plan not found");
    }

    const result: {
      subscriptionId: string;
      meteredSubscriptionId: string;
      trialEndsAt?: Date | undefined;
    } = await BillingService.changePlan({
      projectId: project.id as ObjectID,
      subscriptionId: project.paymentProviderSubscriptionId,
      meteredSubscriptionId: project.paymentProviderMeteredSubscriptionId,
      serverMeteredPlans: AllMeteredPlans,
      newPlan: subscriptionPlan,
      quantity: project.paymentProviderSubscriptionSeats,
      isYearly: SubscriptionPlan.isYearlyPlan(project.paymentProviderPlanId),
      endTrialAt: undefined,
    });

    // refresh subscription status.
    const subscriptionState: SubscriptionStatus =
      await BillingService.getSubscriptionStatus(
        result.subscriptionId as string,
      );

    const meteredSubscriptionState: SubscriptionStatus =
      await BillingService.getSubscriptionStatus(
        project.paymentProviderMeteredSubscriptionId as string,
      );

    // now update project with new subscription id.

    await this.updateOneById({
      id: project.id!,
      data: {
        paymentProviderSubscriptionId: result.subscriptionId,
        paymentProviderMeteredSubscriptionId: result.meteredSubscriptionId,
        paymentProviderSubscriptionStatus: subscriptionState,
        paymentProviderMeteredSubscriptionStatus: meteredSubscriptionState,
      },
      props: {
        isRoot: true,
      },
    });

    // send slack message on plan change.
    await this.sendSubscriptionChangeWebhookSlackNotification(projectId);
  }

  public getActiveProjectStatusQuery(): Query<Model> {
    return {
      // get only active projects
      paymentProviderSubscriptionStatus: QueryHelper.equalToOrNull([
        SubscriptionStatus.Active,
        SubscriptionStatus.Trialing,
      ]),
      paymentProviderMeteredSubscriptionStatus: QueryHelper.equalToOrNull([
        SubscriptionStatus.Active,
        SubscriptionStatus.Trialing,
      ]),
    };
  }

  @CaptureSpan()
  public async getAllActiveProjects(params?: {
    select?: Select<Model>;
    props?: DatabaseCommonInteractionProps;
    skip?: PositiveNumber | number;
    limit?: PositiveNumber | number;
  }): Promise<Array<Model>> {
    const select: Select<Model> | undefined =
      params?.select || ({ _id: true } as Select<Model>);
    const props: DatabaseCommonInteractionProps = params?.props || {
      isRoot: true,
    };

    return await this.findAllBy({
      query: this.getActiveProjectStatusQuery(),
      select,
      props,
      skip: params?.skip,
      limit: params?.limit,
    });
  }

  @CaptureSpan()
  public async getProjectLinkInDashboard(projectId: ObjectID): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}`,
    );
  }

  @CaptureSpan()
  public async isSMSNotificationsEnabled(
    projectId: ObjectID,
  ): Promise<boolean> {
    const project: Model | null = await this.findOneById({
      id: projectId,
      select: {
        enableSmsNotifications: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      throw new BadDataException("Project not found");
    }

    return Boolean(project.enableSmsNotifications);
  }
}
export default new ProjectService();
