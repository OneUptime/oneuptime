import CallProviderFactory from "../Providers/CallProviderFactory";
import { getProjectTwilioConfig } from "../Utils/TwilioConfigHelper";
import {
  DialStatusData,
  ICallProvider,
  IncomingCallData,
  WebhookRequest,
} from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import { IncomingCallStatusMessage } from "Common/Types/IncomingCall/MissedIncomingCall";
import { getIncomingCallRingSeconds } from "Common/Types/IncomingCall/IncomingCallRingTime";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
import IncomingCallMissedCallNotificationService from "Common/Server/Services/IncomingCallMissedCallNotificationService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import UserService from "Common/Server/Services/UserService";
import UserIncomingCallNumberService from "Common/Server/Services/UserIncomingCallNumberService";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallPolicyPhoneNumberService from "Common/Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "Common/Models/DatabaseModels/IncomingCallLogItem";
import User from "Common/Models/DatabaseModels/User";
import Phone from "Common/Types/Phone";
import { Host, HttpProtocol } from "Common/Server/EnvironmentConfig";

const router: ExpressRouter = Express.getRouter();

// Handle incoming voice call - single endpoint for all phone numbers
router.post(
  "/voice",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      // Parse the called phone number from the request body (Twilio sends this)
      const calledPhoneNumber: string = req.body["To"] || req.body["Called"];

      if (!calledPhoneNumber) {
        logger.error(
          "No called phone number in request",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Bad Request");
        return;
      }

      const routingPhoneNumber: Phone = new Phone(calledPhoneNumber);

      // Resolve the exact attached number first; child rows are authoritative.
      const policyPhoneNumber: IncomingCallPolicyPhoneNumber | null =
        await IncomingCallPolicyPhoneNumberService.findOneBy({
          query: {
            phoneNumber: routingPhoneNumber,
          },
          select: {
            incomingCallPolicyId: true,
            projectCallSMSConfigId: true,
            phoneNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

      const policySelect: {
        _id: true;
        projectId: true;
        projectCallSMSConfigId: true;
        isEnabled: true;
        greetingMessage: true;
        noAnswerMessage: true;
        noOneAvailableMessage: true;
        repeatPolicyIfNoOneAnswers: true;
        repeatPolicyIfNoOneAnswersTimes: true;
        routingPhoneNumber: true;
      } = {
        _id: true,
        projectId: true,
        projectCallSMSConfigId: true,
        isEnabled: true,
        greetingMessage: true,
        noAnswerMessage: true,
        noOneAvailableMessage: true,
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: true,
        routingPhoneNumber: true,
      };

      let policy: IncomingCallPolicy | null = null;

      if (policyPhoneNumber?.incomingCallPolicyId) {
        policy = await IncomingCallPolicyService.findOneById({
          id: policyPhoneNumber.incomingCallPolicyId,
          select: policySelect,
          props: {
            isRoot: true,
          },
        });
      } else {
        /* Scalar-only rolling-upgrade fallback. */
        policy = await IncomingCallPolicyService.findOneBy({
          query: {
            routingPhoneNumber,
          },
          select: policySelect,
          props: {
            isRoot: true,
          },
        });
      }

      if (!policy) {
        logger.error(
          `Incoming call policy not found for phone number: ${calledPhoneNumber}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(404).send("Policy not found");
        return;
      }

      const projectCallSMSConfigId: ObjectID | undefined =
        policyPhoneNumber?.projectCallSMSConfigId ||
        policy.projectCallSMSConfigId;

      // Require the config that provisioned this exact number.
      if (!projectCallSMSConfigId) {
        logger.error(
          `Policy ${policy.id?.toString()} does not have a project Twilio config`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Policy not configured correctly");
        return;
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(projectCallSMSConfigId);

      if (!customTwilioConfig) {
        logger.error(
          `Project Twilio config not found for policy ${policy.id?.toString()}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Twilio configuration not found");
        return;
      }

      // Get provider with project config
      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      // Validate webhook signature to ensure request is from the call provider
      const signature: string =
        (req.headers["x-twilio-signature"] as string) || "";

      // Debug logging
      logger.debug(
        "=== Incoming Call Webhook Debug ===",
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Original URL: ${req.originalUrl}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Base URL: ${req.baseUrl}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Path: ${req.path}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Protocol: ${req.protocol}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Host header: ${req.get("host")}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `X-Forwarded-Proto: ${req.get("x-forwarded-proto")}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `X-Forwarded-Host: ${req.get("x-forwarded-host")}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Twilio Signature: ${signature}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Environment HOST: ${Host}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        `Environment HttpProtocol: ${HttpProtocol}`,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        "=== End Debug ===",
        getLogAttributesFromRequest(req as any),
      );

      if (
        !provider.validateWebhookSignature(
          req as unknown as WebhookRequest,
          signature,
        )
      ) {
        logger.error(
          "Invalid webhook signature for incoming call",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(403).send("Forbidden");
        return;
      }

      // Parse incoming call data
      const callData: IncomingCallData = provider.parseIncomingCallWebhook(
        req as unknown as WebhookRequest,
      );

      const policyId: string = policy.id!.toString();

      // Create call log early so we can track all outcomes
      const callLog: IncomingCallLog = new IncomingCallLog();
      if (policy.projectId) {
        callLog.projectId = policy.projectId;
      }
      callLog.incomingCallPolicyId = new ObjectID(policyId);
      callLog.callerPhoneNumber = new Phone(callData.callerPhoneNumber);
      callLog.routingPhoneNumber =
        policyPhoneNumber?.phoneNumber || routingPhoneNumber;
      callLog.callProviderCallId = callData.callId;
      callLog.status = IncomingCallStatus.Initiated;
      callLog.startedAt = new Date();
      callLog.currentEscalationRuleOrder = 1;
      callLog.repeatCount = 0;

      /*
       * Every call is logged as Initiated when it arrives and is ended by an
       * update that sets endedAt - even one turned away straight away - so a
       * workflow can treat "On Create" as "a call came in" and the update
       * that sets Ended At as "the call ended".
       */
      const createdCallLog: IncomingCallLog =
        await IncomingCallLogService.create({
          data: callLog,
          props: {
            isRoot: true,
          },
        });

      // Check if policy is enabled
      if (!policy.isEnabled) {
        await endMissedCall({
          callLogId: createdCallLog.id!,
          status: IncomingCallStatus.Failed,
          statusMessage: IncomingCallStatusMessage.PolicyDisabled,
        });

        const twiml: string = provider.generateHangupResponse(
          "Sorry, this service is currently disabled.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      /*
       * Find the first escalation rule that currently has an available user.
       * This skips rules whose user is momentarily unresolvable (empty schedule
       * or no verified number) instead of hanging up on the caller.
       */
      const firstResolved: {
        rule: IncomingCallPolicyEscalationRule;
        user: UserToCall;
      } | null = await getNextRuleWithAvailableUser(
        new ObjectID(policyId),
        policy.projectId!,
        0,
      );

      if (!firstResolved) {
        await endMissedCall({
          callLogId: createdCallLog.id!,
          status: IncomingCallStatus.Failed,
          statusMessage: IncomingCallStatusMessage.NoOneAvailable,
        });

        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      const firstRule: IncomingCallPolicyEscalationRule = firstResolved.rule;
      const userToCall: UserToCall = firstResolved.user;

      /*
       * Persist the order of the rule we're actually dialing (gap-safe; may be
       * greater than 1 if earlier rules had no available user).
       */
      if (firstRule.order && firstRule.order !== 1) {
        await IncomingCallLogService.updateOneById({
          id: createdCallLog.id!,
          data: {
            currentEscalationRuleOrder: firstRule.order,
          },
          props: { isRoot: true },
        });
      }

      // Create call log item
      const callLogItem: IncomingCallLogItem = new IncomingCallLogItem();
      if (policy.projectId) {
        callLogItem.projectId = policy.projectId;
      }
      callLogItem.incomingCallLogId = createdCallLog.id!;
      if (firstRule.id) {
        callLogItem.incomingCallPolicyEscalationRuleId = firstRule.id;
      }
      callLogItem.userId = userToCall.userId;
      callLogItem.userPhoneNumber = userToCall.phoneNumber;
      callLogItem.status = IncomingCallStatus.Ringing;
      callLogItem.startedAt = new Date();
      callLogItem.isAnswered = false;

      const createdCallLogItem: IncomingCallLogItem =
        await IncomingCallLogItemService.create({
          data: callLogItem,
          props: {
            isRoot: true,
          },
        });

      // Generate TwiML response
      const greetingMessage: string =
        policy.greetingMessage ||
        "Please wait while we connect you to the on-call engineer.";

      // Construct status callback URL
      const statusCallbackUrl: string = `${HttpProtocol}${Host}/notification/incoming-call/dial-status/${createdCallLog.id?.toString()}/${createdCallLogItem.id?.toString()}`;

      // Generate greeting + dial TwiML
      const twiml: string = generateGreetingAndDialTwiml(
        provider,
        greetingMessage,
        userToCall.phoneNumber.toString(),
        callLog.routingPhoneNumber?.toString() || callData.calledPhoneNumber,
        getIncomingCallRingSeconds(firstRule.escalateAfterSeconds),
        statusCallbackUrl,
      );

      res.type("text/xml");
      return res.send(twiml);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

// Handle dial status callback
router.post(
  "/dial-status/:callLogId/:callLogItemId",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const callLogId: string = req.params["callLogId"] as string;
      const callLogItemId: string = req.params["callLogItemId"] as string;

      if (!callLogId || !callLogItemId) {
        throw new BadDataException("Invalid webhook URL");
      }

      // Get the call log to find the policy and its Twilio config
      const callLog: IncomingCallLog | null =
        await IncomingCallLogService.findOneById({
          id: new ObjectID(callLogId),
          select: {
            _id: true,
            currentEscalationRuleOrder: true,
            repeatCount: true,
            incomingCallPolicyId: true,
            routingPhoneNumber: true,
            endedAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!callLog) {
        logger.error(
          `Call log not found: ${callLogId}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(404).send("Call log not found");
        return;
      }

      // Get the policy with its Twilio config
      const policy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: callLog.incomingCallPolicyId!,
          select: {
            _id: true,
            projectId: true,
            projectCallSMSConfigId: true,
            noAnswerMessage: true,
            noOneAvailableMessage: true,
            repeatPolicyIfNoOneAnswers: true,
            repeatPolicyIfNoOneAnswersTimes: true,
            routingPhoneNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!policy) {
        logger.error(
          "Policy not found",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Configuration error");
        return;
      }

      let policyPhoneNumber: IncomingCallPolicyPhoneNumber | null = null;
      if (callLog.routingPhoneNumber) {
        policyPhoneNumber =
          await IncomingCallPolicyPhoneNumberService.findOneBy({
            query: {
              incomingCallPolicyId: callLog.incomingCallPolicyId!,
              phoneNumber: callLog.routingPhoneNumber,
            },
            select: {
              projectCallSMSConfigId: true,
            },
            props: {
              isRoot: true,
            },
          });
      }

      const projectCallSMSConfigId: ObjectID | undefined =
        policyPhoneNumber?.projectCallSMSConfigId ||
        policy.projectCallSMSConfigId;

      if (!projectCallSMSConfigId) {
        logger.error(
          "Twilio config not found for called phone number",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Configuration error");
        return;
      }

      // Get the config that provisioned the exact called number.
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(projectCallSMSConfigId);

      if (!customTwilioConfig) {
        logger.error(
          "Twilio config not found for policy",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Configuration error");
        return;
      }

      // Get provider with project config
      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      // Validate webhook signature to ensure request is from the call provider
      const signature: string =
        (req.headers["x-twilio-signature"] as string) || "";
      if (
        !provider.validateWebhookSignature(
          req as unknown as WebhookRequest,
          signature,
        )
      ) {
        logger.error(
          "Invalid webhook signature for dial status callback",
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(403).send("Forbidden");
        return;
      }

      // Parse dial status
      const dialStatus: DialStatusData = provider.parseDialStatusWebhook(
        req as unknown as WebhookRequest,
      );

      // Get the call log item
      const callLogItem: IncomingCallLogItem | null =
        await IncomingCallLogItemService.findOneById({
          id: new ObjectID(callLogItemId),
          select: {
            _id: true,
            incomingCallLogId: true,
            userId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!callLogItem) {
        logger.error(
          `Call log item not found: ${callLogItemId}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      if (
        !callLogItem.incomingCallLogId ||
        !callLog.id ||
        callLogItem.incomingCallLogId.toString() !== callLog.id.toString()
      ) {
        logger.error(
          `Call log item ${callLogItemId} does not belong to call log ${callLogId}`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        res.status(400).send("Call log item does not belong to this call log");
        return;
      }

      /*
       * The call already ended, so this is a repeat of a callback that was
       * handled. Acting on it again would ring someone for a caller who is
       * gone, and tell the owners about the same missed call twice.
       */
      if (callLog.endedAt) {
        logger.debug(
          `Dial status for call log ${callLogId} arrived after the call ended. Ignoring it.`,
          getLogAttributesFromRequest(req as RequestLike),
        );
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      const now: Date = new Date();
      const isAnswered: boolean = dialStatus.dialStatus === "completed";

      /*
       * The provider also reports a dial result when the caller hangs up
       * while the engineer's phone is still ringing. It looks like an
       * unanswered dial, but nobody is left to connect, so the hunt stops
       * here. Escalating or repeating would log an attempt that never rings,
       * with dial instructions the provider throws away, and leave the call
       * log open for good.
       */
      const callerHungUp: boolean = !isAnswered && dialStatus.callerHungUp;

      let attemptStatus: IncomingCallStatus = IncomingCallStatus.NoAnswer;
      if (isAnswered) {
        attemptStatus = IncomingCallStatus.Connected;
      } else if (callerHungUp) {
        attemptStatus = IncomingCallStatus.CallerHungUp;
      }

      // Update call log item
      await IncomingCallLogItemService.updateOneById({
        id: new ObjectID(callLogItemId),
        data: {
          status: attemptStatus,
          dialDurationInSeconds: dialStatus.dialDurationSeconds || 0,
          endedAt: now,
          isAnswered: isAnswered,
        },
        props: {
          isRoot: true,
        },
      });

      // If call was answered, mark as completed
      if (isAnswered) {
        await IncomingCallLogService.updateOneById({
          id: new ObjectID(callLogId),
          data: {
            status: IncomingCallStatus.Completed,
            endedAt: now,
            ...(callLogItem.userId
              ? { answeredByUserId: callLogItem.userId }
              : {}),
          },
          props: {
            isRoot: true,
          },
        });

        // Hang up - the call is complete
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      if (callerHungUp) {
        await endMissedCall({
          callLogId: new ObjectID(callLogId),
          status: IncomingCallStatus.CallerHungUp,
          endedAt: now,
        });

        // The call is already over; the provider ignores this response.
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      /*
       * Call was not answered. Advance to the next escalation rule that has an
       * available user. Skips rules whose user is momentarily unavailable and
       * is gap-safe (does not assume contiguous order values).
       */
      const nextResolved: {
        rule: IncomingCallPolicyEscalationRule;
        user: UserToCall;
      } | null = await getNextRuleWithAvailableUser(
        callLog.incomingCallPolicyId!,
        policy.projectId!,
        callLog.currentEscalationRuleOrder || 0,
      );

      if (nextResolved) {
        await IncomingCallLogService.updateOneById({
          id: new ObjectID(callLogId),
          data: {
            currentEscalationRuleOrder: nextResolved.rule.order!,
            status: IncomingCallStatus.Escalated,
          },
          props: {
            isRoot: true,
          },
        });

        return await dialNextUser(
          res,
          provider,
          policy,
          callLog,
          nextResolved.rule,
          nextResolved.user,
        );
      }

      /*
       * No further rule with an available user. If the policy is configured to
       * repeat, restart from the first available rule. State (repeatCount /
       * order) is only mutated once we've confirmed there is someone to dial,
       * so a failed repeat doesn't leave misleading audit state.
       */
      if (
        policy.repeatPolicyIfNoOneAnswers &&
        (callLog.repeatCount || 0) <
          (policy.repeatPolicyIfNoOneAnswersTimes || 1)
      ) {
        const repeatResolved: {
          rule: IncomingCallPolicyEscalationRule;
          user: UserToCall;
        } | null = await getNextRuleWithAvailableUser(
          callLog.incomingCallPolicyId!,
          policy.projectId!,
          0,
        );

        if (repeatResolved) {
          await IncomingCallLogService.updateOneById({
            id: new ObjectID(callLogId),
            data: {
              currentEscalationRuleOrder: repeatResolved.rule.order!,
              repeatCount: (callLog.repeatCount || 0) + 1,
              status: IncomingCallStatus.Escalated,
            },
            props: {
              isRoot: true,
            },
          });

          return await dialNextUser(
            res,
            provider,
            policy,
            callLog,
            repeatResolved.rule,
            repeatResolved.user,
          );
        }
      }

      // No more options, end the call.
      await endMissedCall({
        callLogId: new ObjectID(callLogId),
        status: IncomingCallStatus.NoAnswer,
        endedAt: now,
      });

      const twiml: string = provider.generateHangupResponse(
        policy.noAnswerMessage ||
          "No one is available. Please try again later.",
      );
      res.type("text/xml");
      return res.send(twiml);
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

/*
 * Ends a call that reached nobody and tells the policy's owners. The
 * notification is not awaited: the call provider (and usually the caller) is
 * waiting for this webhook's reply, and the notification never throws.
 */
async function endMissedCall(data: {
  callLogId: ObjectID;
  status: IncomingCallStatus;
  statusMessage?: IncomingCallStatusMessage | undefined;
  endedAt?: Date | undefined;
}): Promise<void> {
  await IncomingCallLogService.updateOneById({
    id: data.callLogId,
    data: {
      status: data.status,
      ...(data.statusMessage ? { statusMessage: data.statusMessage } : {}),
      endedAt: data.endedAt || new Date(),
    },
    props: {
      isRoot: true,
    },
  });

  IncomingCallMissedCallNotificationService.notifyOwnersOfMissedCall({
    incomingCallLogId: data.callLogId,
  }).catch((err: Error) => {
    logger.error(err);
  });
}

// Interface for user with phone number to call
interface UserToCall {
  userId: ObjectID;
  phoneNumber: Phone;
  name?: string | undefined;
  email?: string | undefined;
}

// Helper function to get user to call from escalation rule
async function getUserToCall(
  rule: IncomingCallPolicyEscalationRule,
  projectId: ObjectID,
): Promise<UserToCall | null> {
  let userId: ObjectID | null = null;

  // If rule has a direct user, use that
  if (rule.userId) {
    userId = rule.userId;
  } else if (rule.onCallDutyPolicyScheduleId) {
    // If rule has an on-call schedule, get the current on-call user
    userId = await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
      rule.onCallDutyPolicyScheduleId,
    );
  }

  if (!userId) {
    return null;
  }

  // Check if the user has a verified incoming call number for this project
  const verifiedIncomingCallNumber: UserIncomingCallNumber | null =
    await UserIncomingCallNumberService.findOneBy({
      query: {
        userId: userId,
        projectId: projectId,
        isVerified: true,
      },
      select: {
        phone: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!verifiedIncomingCallNumber || !verifiedIncomingCallNumber.phone) {
    // No verified incoming call number for this user in this project
    return null;
  }

  // Get user details for logging
  const user: User | null = await UserService.findOneById({
    id: userId,
    select: {
      _id: true,
      name: true,
      email: true,
    },
    props: {
      isRoot: true,
    },
  });

  return {
    userId: userId,
    phoneNumber: verifiedIncomingCallNumber.phone,
    name: user?.name?.toString(),
    email: user?.email?.toString(),
  };
}

/*
 * Finds the next escalation rule (strictly after `afterOrder`, ascending) that
 * currently has an available user to call. Rules whose user cannot be resolved
 * right now (empty schedule, or user without a verified incoming-call number)
 * are skipped rather than dead-ending the call. Gap-safe: does not assume
 * `order` values are contiguous.
 */
async function getNextRuleWithAvailableUser(
  incomingCallPolicyId: ObjectID,
  projectId: ObjectID,
  afterOrder: number,
): Promise<{
  rule: IncomingCallPolicyEscalationRule;
  user: UserToCall;
} | null> {
  let currentAfterOrder: number = afterOrder;

  /*
   * Each iteration strictly increases currentAfterOrder, so this terminates
   * once there are no more rules with a higher order.
   */
  for (;;) {
    const rule: IncomingCallPolicyEscalationRule | null =
      await IncomingCallPolicyEscalationRuleService.findOneBy({
        query: {
          incomingCallPolicyId: incomingCallPolicyId,
          order: QueryHelper.greaterThan(currentAfterOrder),
        },
        select: {
          _id: true,
          name: true,
          order: true,
          escalateAfterSeconds: true,
          onCallDutyPolicyScheduleId: true,
          userId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    if (!rule) {
      return null;
    }

    const user: UserToCall | null = await getUserToCall(rule, projectId);
    if (user) {
      return { rule: rule, user: user };
    }

    // This rule has no available user right now; skip to the next one.
    currentAfterOrder = rule.order!;
  }
}

// Helper function to generate greeting and dial TwiML
function generateGreetingAndDialTwiml(
  provider: ICallProvider,
  greetingMessage: string,
  toPhoneNumber: string,
  fromPhoneNumber: string,
  timeoutSeconds: number,
  statusCallbackUrl: string,
): string {
  // Use the escalation response which says a message then dials
  return provider.generateEscalationResponse(greetingMessage, {
    toPhoneNumber,
    fromPhoneNumber,
    timeoutSeconds,
    statusCallbackUrl,
  });
}

// Helper function to dial the next user
async function dialNextUser(
  res: ExpressResponse,
  provider: ICallProvider,
  policy: IncomingCallPolicy,
  callLog: IncomingCallLog,
  rule: IncomingCallPolicyEscalationRule,
  userToCall: UserToCall,
): Promise<ExpressResponse> {
  // Create call log item
  const callLogItem: IncomingCallLogItem = new IncomingCallLogItem();
  if (policy.projectId) {
    callLogItem.projectId = policy.projectId;
  }
  callLogItem.incomingCallLogId = callLog.id!;
  if (rule.id) {
    callLogItem.incomingCallPolicyEscalationRuleId = rule.id;
  }
  callLogItem.userId = userToCall.userId;
  callLogItem.userPhoneNumber = userToCall.phoneNumber;
  callLogItem.status = IncomingCallStatus.Ringing;
  callLogItem.startedAt = new Date();
  callLogItem.isAnswered = false;

  const createdCallLogItem: IncomingCallLogItem =
    await IncomingCallLogItemService.create({
      data: callLogItem,
      props: {
        isRoot: true,
      },
    });

  // Construct status callback URL
  const statusCallbackUrl: string = `${HttpProtocol}${Host}/notification/incoming-call/dial-status/${callLog.id?.toString()}/${createdCallLogItem.id?.toString()}`;

  // Generate dial TwiML with escalation message
  const escalationMessage: string = `Connecting you to the next available engineer.`;

  const twiml: string = provider.generateEscalationResponse(escalationMessage, {
    toPhoneNumber: userToCall.phoneNumber.toString(),
    fromPhoneNumber:
      callLog.routingPhoneNumber?.toString() ||
      policy.routingPhoneNumber?.toString() ||
      "",
    timeoutSeconds: getIncomingCallRingSeconds(rule.escalateAfterSeconds),
    statusCallbackUrl,
  });

  res.type("text/xml");
  return res.send(twiml);
}

export default router;
