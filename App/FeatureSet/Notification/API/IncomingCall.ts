import CallProviderFactory from "../Providers/CallProviderFactory";
import { IncomingCallMinimumBalanceRequiredInCents } from "../Config";
import {
  DialStatusData,
  ICallProvider,
  IncomingCallData,
  WebhookRequest,
} from "Common/Types/Call/CallProvider";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import UserService from "Common/Server/Services/UserService";
import NotificationService from "Common/Server/Services/NotificationService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "Common/Models/DatabaseModels/IncomingCallLogItem";
import User from "Common/Models/DatabaseModels/User";
import Phone from "Common/Types/Phone";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import ProjectService from "Common/Server/Services/ProjectService";
import Project from "Common/Models/DatabaseModels/Project";

const router: ExpressRouter = Express.getRouter();

// Handle incoming voice call
router.post(
  "/:policyId/voice",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const policyId: string = req.params["policyId"] as string;

      if (!policyId) {
        throw new BadDataException("Invalid webhook URL");
      }

      const provider: ICallProvider = await CallProviderFactory.getProvider();

      // Parse incoming call data
      const callData: IncomingCallData = provider.parseIncomingCallWebhook(
        req as unknown as WebhookRequest,
      );

      // Find the policy
      const policy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: new ObjectID(policyId),
          select: {
            _id: true,
            projectId: true,
            isEnabled: true,
            greetingMessage: true,
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
        logger.error(`Incoming call policy not found: ${policyId}`);
        const twiml: string = provider.generateHangupResponse(
          "Sorry, this phone number is not configured correctly.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Check if policy is enabled
      if (!policy.isEnabled) {
        const twiml: string = provider.generateHangupResponse(
          "Sorry, this service is currently disabled.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Check project balance if billing is enabled
      if (IsBillingEnabled && policy.projectId) {
        const project: Project | null = await ProjectService.findOneById({
          id: policy.projectId,
          select: {
            smsOrCallCurrentBalanceInUSDCents: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (
          !project ||
          !project.smsOrCallCurrentBalanceInUSDCents ||
          project.smsOrCallCurrentBalanceInUSDCents < IncomingCallMinimumBalanceRequiredInCents
        ) {
          // Try to auto-recharge
          try {
            if (policy.projectId) {
              await NotificationService.rechargeIfBalanceIsLow(
                policy.projectId,
              );
            }
          } catch (err) {
            logger.error(err);
          }

          // Check again after recharge attempt
          const updatedProject: Project | null =
            await ProjectService.findOneById({
              id: policy.projectId,
              select: {
                smsOrCallCurrentBalanceInUSDCents: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (
            !updatedProject ||
            !updatedProject.smsOrCallCurrentBalanceInUSDCents ||
            updatedProject.smsOrCallCurrentBalanceInUSDCents <
              IncomingCallMinimumBalanceRequiredInCents
          ) {
            const twiml: string = provider.generateHangupResponse(
              "Sorry, this service is temporarily unavailable due to insufficient balance.",
            );
            res.type("text/xml");
            return res.send(twiml);
          }
        }
      }

      // Create call log
      const callLog: IncomingCallLog = new IncomingCallLog();
      if (policy.projectId) {
        callLog.projectId = policy.projectId;
      }
      callLog.incomingCallPolicyId = new ObjectID(policyId);
      callLog.callerPhoneNumber = new Phone(callData.callerPhoneNumber);
      if (policy.routingPhoneNumber) {
        callLog.routingPhoneNumber = policy.routingPhoneNumber;
      }
      callLog.callProviderCallId = callData.callId;
      callLog.status = IncomingCallStatus.Initiated;
      callLog.startedAt = new Date();
      callLog.currentEscalationRuleOrder = 1;
      callLog.repeatCount = 0;

      const createdCallLog: IncomingCallLog =
        await IncomingCallLogService.create({
          data: callLog,
          props: {
            isRoot: true,
          },
        });

      // Get the first escalation rule
      const firstRule: IncomingCallPolicyEscalationRule | null =
        await IncomingCallPolicyEscalationRuleService.findOneBy({
          query: {
            incomingCallPolicyId: new ObjectID(policyId),
            order: 1,
          },
          select: {
            _id: true,
            name: true,
            escalateAfterSeconds: true,
            onCallDutyPolicyScheduleId: true,
            userId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!firstRule) {
        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Get the user to call
      const userToCall: User | null = await getUserToCall(firstRule);

      if (!userToCall || !userToCall.alertPhoneNumber) {
        // No user available, try next rule or end call
        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
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
      if (userToCall.id) {
        callLogItem.userId = userToCall.id;
      }
      if (userToCall.alertPhoneNumber) {
        callLogItem.userPhoneNumber = userToCall.alertPhoneNumber;
      }
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
      const statusCallbackUrl: string = `${process.env["HOST"] || "https://api.oneuptime.com"}/notification/incoming-call/${policyId}/dial-status/${createdCallLog.id?.toString()}/${createdCallLogItem.id?.toString()}`;

      // Generate greeting + dial TwiML
      const twiml: string = generateGreetingAndDialTwiml(
        provider,
        greetingMessage,
        userToCall.alertPhoneNumber.toString(),
        policy.routingPhoneNumber?.toString() || callData.calledPhoneNumber,
        firstRule.escalateAfterSeconds || 30,
        statusCallbackUrl,
      );

      res.type("text/xml");
      return res.send(twiml);
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Handle dial status callback
router.post(
  "/:policyId/dial-status/:callLogId/:callLogItemId",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const policyId: string = req.params["policyId"] as string;
      const callLogId: string = req.params["callLogId"] as string;
      const callLogItemId: string = req.params["callLogItemId"] as string;

      if (!policyId || !callLogId || !callLogItemId) {
        throw new BadDataException("Invalid webhook URL");
      }

      const provider: ICallProvider = await CallProviderFactory.getProvider();

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
          },
          props: {
            isRoot: true,
          },
        });

      if (!callLogItem) {
        logger.error(`Call log item not found: ${callLogItemId}`);
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      // Update call log item
      const now: Date = new Date();
      await IncomingCallLogItemService.updateOneById({
        id: new ObjectID(callLogItemId),
        data: {
          status:
            dialStatus.dialStatus === "completed"
              ? IncomingCallStatus.Connected
              : IncomingCallStatus.NoAnswer,
          dialDurationInSeconds: dialStatus.dialDurationSeconds || 0,
          endedAt: now,
          isAnswered: dialStatus.dialStatus === "completed",
        },
        props: {
          isRoot: true,
        },
      });

      // Get the call log
      const callLog: IncomingCallLog | null =
        await IncomingCallLogService.findOneById({
          id: new ObjectID(callLogId),
          select: {
            _id: true,
            currentEscalationRuleOrder: true,
            repeatCount: true,
            incomingCallPolicyId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!callLog) {
        logger.error(`Call log not found: ${callLogId}`);
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      // If call was answered, mark as completed
      if (dialStatus.dialStatus === "completed") {
        await IncomingCallLogService.updateOneById({
          id: new ObjectID(callLogId),
          data: {
            status: IncomingCallStatus.Completed,
            endedAt: now,
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

      // Call was not answered, try next escalation rule
      const policy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: callLog.incomingCallPolicyId!,
          select: {
            _id: true,
            projectId: true,
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
        const twiml: string = provider.generateHangupResponse();
        res.type("text/xml");
        return res.send(twiml);
      }

      const nextOrder: number = (callLog.currentEscalationRuleOrder || 1) + 1;

      // Get the next escalation rule
      const nextRule: IncomingCallPolicyEscalationRule | null =
        await IncomingCallPolicyEscalationRuleService.findOneBy({
          query: {
            incomingCallPolicyId: callLog.incomingCallPolicyId!,
            order: nextOrder,
          },
          select: {
            _id: true,
            name: true,
            escalateAfterSeconds: true,
            onCallDutyPolicyScheduleId: true,
            userId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!nextRule) {
        // No more rules, check if we should repeat
        if (
          policy.repeatPolicyIfNoOneAnswers &&
          (callLog.repeatCount || 0) <
            (policy.repeatPolicyIfNoOneAnswersTimes || 1)
        ) {
          // Restart from first rule
          await IncomingCallLogService.updateOneById({
            id: new ObjectID(callLogId),
            data: {
              currentEscalationRuleOrder: 1,
              repeatCount: (callLog.repeatCount || 0) + 1,
            },
            props: {
              isRoot: true,
            },
          });

          // Get first rule again
          const firstRule: IncomingCallPolicyEscalationRule | null =
            await IncomingCallPolicyEscalationRuleService.findOneBy({
              query: {
                incomingCallPolicyId: callLog.incomingCallPolicyId!,
                order: 1,
              },
              select: {
                _id: true,
                name: true,
                escalateAfterSeconds: true,
                onCallDutyPolicyScheduleId: true,
                userId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (firstRule) {
            const userToCall: User | null = await getUserToCall(firstRule);
            if (userToCall && userToCall.alertPhoneNumber) {
              // Continue with the call
              return await dialNextUser(
                req,
                res,
                provider,
                policy,
                callLog,
                firstRule,
                userToCall,
                policyId,
              );
            }
          }
        }

        // No more options, end the call
        await IncomingCallLogService.updateOneById({
          id: new ObjectID(callLogId),
          data: {
            status: IncomingCallStatus.NoAnswer,
            endedAt: now,
          },
          props: {
            isRoot: true,
          },
        });

        const twiml: string = provider.generateHangupResponse(
          policy.noAnswerMessage ||
            "No one is available. Please try again later.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Update call log with new escalation rule order
      await IncomingCallLogService.updateOneById({
        id: new ObjectID(callLogId),
        data: {
          currentEscalationRuleOrder: nextOrder,
          status: IncomingCallStatus.Escalated,
        },
        props: {
          isRoot: true,
        },
      });

      // Get the user to call
      const userToCall: User | null = await getUserToCall(nextRule);

      if (!userToCall || !userToCall.alertPhoneNumber) {
        // Skip this rule and try the next one (recursive approach via TwiML redirect would be complex)
        // For simplicity, end the call if no user available
        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Dial the next user
      return await dialNextUser(
        req,
        res,
        provider,
        policy,
        callLog,
        nextRule,
        userToCall,
        policyId,
      );
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Helper function to get user to call from escalation rule
async function getUserToCall(
  rule: IncomingCallPolicyEscalationRule,
): Promise<User | null> {
  // If rule has a direct user, use that
  if (rule.userId) {
    return await UserService.findOneById({
      id: rule.userId,
      select: {
        _id: true,
        alertPhoneNumber: true,
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  // If rule has an on-call schedule, get the current on-call user
  if (rule.onCallDutyPolicyScheduleId) {
    const currentOnCallUserId: ObjectID | null =
      await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
        rule.onCallDutyPolicyScheduleId,
      );

    if (currentOnCallUserId) {
      // Get the full user with phone number
      return await UserService.findOneById({
        id: currentOnCallUserId,
        select: {
          _id: true,
          alertPhoneNumber: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });
    }
  }

  return null;
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
  _req: ExpressRequest,
  res: ExpressResponse,
  provider: ICallProvider,
  policy: IncomingCallPolicy,
  callLog: IncomingCallLog,
  rule: IncomingCallPolicyEscalationRule,
  userToCall: User,
  policyId: string,
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
  if (userToCall.id) {
    callLogItem.userId = userToCall.id;
  }
  if (userToCall.alertPhoneNumber) {
    callLogItem.userPhoneNumber = userToCall.alertPhoneNumber;
  }
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
  const statusCallbackUrl: string = `${process.env["HOST"] || "https://api.oneuptime.com"}/notification/incoming-call/${policyId}/dial-status/${callLog.id?.toString()}/${createdCallLogItem.id?.toString()}`;

  // Generate dial TwiML with escalation message
  const escalationMessage: string = `Connecting you to the next available engineer.`;

  const twiml: string = provider.generateEscalationResponse(escalationMessage, {
    toPhoneNumber: userToCall.alertPhoneNumber!.toString(),
    fromPhoneNumber: policy.routingPhoneNumber?.toString() || "",
    timeoutSeconds: rule.escalateAfterSeconds || 30,
    statusCallbackUrl,
  });

  res.type("text/xml");
  return res.send(twiml);
}

export default router;
