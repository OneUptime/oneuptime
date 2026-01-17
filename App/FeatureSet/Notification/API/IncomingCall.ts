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
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
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
import logger from "Common/Server/Utils/Logger";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
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
        logger.error("No called phone number in request");
        res.status(400).send("Bad Request");
        return;
      }

      // Find the policy by the called phone number
      const policy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneBy({
          query: {
            routingPhoneNumber: new Phone(calledPhoneNumber),
          },
          select: {
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
          },
          props: {
            isRoot: true,
          },
        });

      if (!policy) {
        logger.error(
          `Incoming call policy not found for phone number: ${calledPhoneNumber}`,
        );
        res.status(404).send("Policy not found");
        return;
      }

      // Require project-level Twilio config
      if (!policy.projectCallSMSConfigId) {
        logger.error(
          `Policy ${policy.id?.toString()} does not have a project Twilio config`,
        );
        res.status(400).send("Policy not configured correctly");
        return;
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(policy.projectCallSMSConfigId);

      if (!customTwilioConfig) {
        logger.error(
          `Project Twilio config not found for policy ${policy.id?.toString()}`,
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
      logger.debug("=== Incoming Call Webhook Debug ===");
      logger.debug(`Original URL: ${req.originalUrl}`);
      logger.debug(`Base URL: ${req.baseUrl}`);
      logger.debug(`Path: ${req.path}`);
      logger.debug(`Protocol: ${req.protocol}`);
      logger.debug(`Host header: ${req.get("host")}`);
      logger.debug(`X-Forwarded-Proto: ${req.get("x-forwarded-proto")}`);
      logger.debug(`X-Forwarded-Host: ${req.get("x-forwarded-host")}`);
      logger.debug(`Twilio Signature: ${signature}`);
      logger.debug(`Environment HOST: ${Host}`);
      logger.debug(`Environment HttpProtocol: ${HttpProtocol}`);
      logger.debug("=== End Debug ===");

      if (
        !provider.validateWebhookSignature(
          req as unknown as WebhookRequest,
          signature,
        )
      ) {
        logger.error("Invalid webhook signature for incoming call");
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
      if (policy.routingPhoneNumber) {
        callLog.routingPhoneNumber = policy.routingPhoneNumber;
      }
      callLog.callProviderCallId = callData.callId;
      callLog.status = IncomingCallStatus.Initiated;
      callLog.startedAt = new Date();
      callLog.currentEscalationRuleOrder = 1;
      callLog.repeatCount = 0;

      // Check if policy is enabled
      if (!policy.isEnabled) {
        callLog.status = IncomingCallStatus.Failed;
        callLog.statusMessage = "Policy is disabled";
        callLog.endedAt = new Date();
        await IncomingCallLogService.create({
          data: callLog,
          props: { isRoot: true },
        });

        const twiml: string = provider.generateHangupResponse(
          "Sorry, this service is currently disabled.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Save the call log now that initial checks passed
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
        await IncomingCallLogService.updateOneById({
          id: createdCallLog.id!,
          data: {
            status: IncomingCallStatus.Failed,
            statusMessage: "No escalation rules configured",
            endedAt: new Date(),
          },
          props: { isRoot: true },
        });

        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Get the user to call
      const userToCall: UserToCall | null = await getUserToCall(
        firstRule,
        policy.projectId!,
      );

      if (!userToCall) {
        await IncomingCallLogService.updateOneById({
          id: createdCallLog.id!,
          data: {
            status: IncomingCallStatus.Failed,
            statusMessage:
              "No on-call user available or user has no phone number",
            endedAt: new Date(),
          },
          props: { isRoot: true },
        });

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
          },
          props: {
            isRoot: true,
          },
        });

      if (!callLog) {
        logger.error(`Call log not found: ${callLogId}`);
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

      if (!policy || !policy.projectCallSMSConfigId) {
        logger.error("Policy or Twilio config not found");
        res.status(400).send("Configuration error");
        return;
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(policy.projectCallSMSConfigId);

      if (!customTwilioConfig) {
        logger.error("Twilio config not found for policy");
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
        logger.error("Invalid webhook signature for dial status callback");
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

          if (firstRule && policy.projectId) {
            const userToCall: UserToCall | null = await getUserToCall(
              firstRule,
              policy.projectId,
            );
            if (userToCall) {
              // Continue with the call
              return await dialNextUser(
                res,
                provider,
                policy,
                callLog,
                firstRule,
                userToCall,
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
      const userToCall: UserToCall | null = await getUserToCall(
        nextRule,
        policy.projectId!,
      );

      if (!userToCall) {
        /*
         * Skip this rule and try the next one (recursive approach via TwiML redirect would be complex)
         * For simplicity, end the call if no user available
         */
        await IncomingCallLogService.updateOneById({
          id: new ObjectID(callLogId),
          data: {
            status: IncomingCallStatus.Failed,
            statusMessage:
              "No on-call user available or user has no phone number",
            endedAt: new Date(),
          },
          props: { isRoot: true },
        });

        const twiml: string = provider.generateHangupResponse(
          policy.noOneAvailableMessage ||
            "We're sorry, but no on-call engineer is currently available.",
        );
        res.type("text/xml");
        return res.send(twiml);
      }

      // Dial the next user
      return await dialNextUser(
        res,
        provider,
        policy,
        callLog,
        nextRule,
        userToCall,
      );
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

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
    fromPhoneNumber: policy.routingPhoneNumber?.toString() || "",
    timeoutSeconds: rule.escalateAfterSeconds || 30,
    statusCallbackUrl,
  });

  res.type("text/xml");
  return res.send(twiml);
}

export default router;
