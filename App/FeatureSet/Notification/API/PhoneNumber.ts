import CallProviderFactory from "../Providers/CallProviderFactory";
import { PhoneNumberPriceMultiplier, NotificationWebhookHost } from "../Config";
import {
  AvailablePhoneNumber,
  ICallProvider,
  PurchasedPhoneNumber,
} from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectService from "Common/Server/Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import Project from "Common/Models/DatabaseModels/Project";
import Phone from "Common/Types/Phone";

// Helper function to get TwilioConfig from project config
async function getProjectTwilioConfig(
  projectCallSMSConfigId: ObjectID,
): Promise<TwilioConfig | null> {
  const projectConfig: ProjectCallSMSConfig | null =
    await ProjectCallSMSConfigService.findOneById({
      id: projectCallSMSConfigId,
      select: {
        twilioAccountSID: true,
        twilioAuthToken: true,
        twilioPrimaryPhoneNumber: true,
        twilioSecondaryPhoneNumbers: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!projectConfig) {
    return null;
  }

  const twilioConfig: TwilioConfig | undefined =
    ProjectCallSMSConfigService.toTwilioConfig(projectConfig);
  return twilioConfig || null;
}

const router: ExpressRouter = Express.getRouter();

// Search available phone numbers
router.post(
  "/search",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectId: ObjectID | undefined = body["projectId"]
        ? new ObjectID(body["projectId"] as string)
        : undefined;

      // Optional: Use project's own Twilio config
      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      if (!projectId) {
        throw new BadDataException("projectId is required");
      }

      const countryCode: string | undefined = body["countryCode"] as
        | string
        | undefined;
      const areaCode: string | undefined = body["areaCode"] as
        | string
        | undefined;
      const contains: string | undefined = body["contains"] as
        | string
        | undefined;

      if (!countryCode) {
        throw new BadDataException("countryCode is required");
      }

      // Check if project exists
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        throw new BadDataException("Project not found");
      }

      // Get the appropriate provider (project config or global)
      let provider: ICallProvider;
      const isUsingProjectConfig: boolean = Boolean(projectCallSMSConfigId);

      if (projectCallSMSConfigId) {
        const customTwilioConfig: TwilioConfig | null =
          await getProjectTwilioConfig(projectCallSMSConfigId);
        if (!customTwilioConfig) {
          throw new BadDataException("Project Call/SMS Config not found");
        }
        provider =
          CallProviderFactory.getProviderWithConfig(customTwilioConfig);
      } else {
        provider = await CallProviderFactory.getProvider();
      }

      const searchOptions: {
        countryCode: string;
        areaCode?: string;
        contains?: string;
        limit?: number;
      } = {
        countryCode,
        limit: 10,
      };

      if (areaCode) {
        searchOptions.areaCode = areaCode;
      }

      if (contains) {
        searchOptions.contains = contains;
      }

      const numbers: AvailablePhoneNumber[] =
        await provider.searchAvailableNumbers(searchOptions);

      // Apply markup to customer price (only when using global config)
      const numbersWithMarkup: AvailablePhoneNumber[] = numbers.map(
        (number: AvailablePhoneNumber) => {
          return {
            ...number,
            // When using project config, customer pays Twilio directly (no markup)
            customerCostPerMonthInUSDCents: isUsingProjectConfig
              ? number.providerCostPerMonthInUSDCents
              : Math.round(
                  number.providerCostPerMonthInUSDCents *
                    PhoneNumberPriceMultiplier,
                ),
          };
        },
      );

      // If billing is not enabled or using project config, don't show cost
      type ResponseNumber = {
        phoneNumber: string;
        friendlyName: string;
        locality?: string;
        region?: string;
        country: string;
        providerCostPerMonthInUSDCents?: number;
        customerCostPerMonthInUSDCents?: number;
      };

      const responseNumbers: Array<ResponseNumber> = numbersWithMarkup.map(
        (n: AvailablePhoneNumber): ResponseNumber => {
          // When using project config, customer pays Twilio directly - don't show our billing
          if (!IsBillingEnabled || isUsingProjectConfig) {
            const result: ResponseNumber = {
              phoneNumber: n.phoneNumber,
              friendlyName: n.friendlyName,
              country: n.country,
            };
            if (n.locality) {
              result.locality = n.locality;
            }
            if (n.region) {
              result.region = n.region;
            }
            return result;
          }
          return n;
        },
      );

      return Response.sendJsonObjectResponse(req, res, {
        availableNumbers: responseNumbers,
      });
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Purchase a phone number
router.post(
  "/purchase",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectId: ObjectID | undefined = body["projectId"]
        ? new ObjectID(body["projectId"] as string)
        : undefined;

      const phoneNumber: string | undefined = body["phoneNumber"] as
        | string
        | undefined;

      const incomingCallPolicyId: ObjectID | undefined = body[
        "incomingCallPolicyId"
      ]
        ? new ObjectID(body["incomingCallPolicyId"] as string)
        : undefined;

      if (!projectId) {
        throw new BadDataException("projectId is required");
      }

      if (!phoneNumber) {
        throw new BadDataException("phoneNumber is required");
      }

      if (!incomingCallPolicyId) {
        throw new BadDataException("incomingCallPolicyId is required");
      }

      // Check if project exists
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        throw new BadDataException("Project not found");
      }

      // Check if incoming call policy exists and get its project config
      const incomingCallPolicy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: incomingCallPolicyId,
          select: {
            _id: true,
            projectId: true,
            projectCallSMSConfigId: true,
            routingPhoneNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!incomingCallPolicy) {
        throw new BadDataException("Incoming Call Policy not found");
      }

      if (incomingCallPolicy.projectId?.toString() !== projectId.toString()) {
        throw new BadDataException(
          "Incoming Call Policy does not belong to this project",
        );
      }

      if (incomingCallPolicy.routingPhoneNumber) {
        throw new BadDataException(
          "This policy already has a phone number. Please release it first.",
        );
      }

      /*
       * Construct webhook URL - single endpoint for all phone numbers
       * Twilio sends the "To" phone number in every webhook, so we look up the policy by phone number
       */
      const webhookUrl: string = `${NotificationWebhookHost}/notification/incoming-call/voice`;

      // Get the appropriate provider (project config or global)
      let provider: ICallProvider;
      const isUsingProjectConfig: boolean = Boolean(
        incomingCallPolicy.projectCallSMSConfigId,
      );

      if (incomingCallPolicy.projectCallSMSConfigId) {
        const customTwilioConfig: TwilioConfig | null =
          await getProjectTwilioConfig(
            incomingCallPolicy.projectCallSMSConfigId,
          );
        if (!customTwilioConfig) {
          throw new BadDataException("Project Call/SMS Config not found");
        }
        provider =
          CallProviderFactory.getProviderWithConfig(customTwilioConfig);
      } else {
        provider = await CallProviderFactory.getProvider();
      }

      const purchased: PurchasedPhoneNumber = await provider.purchaseNumber(
        phoneNumber,
        webhookUrl,
      );

      // Get country code from phone number
      const countryCode: string = Phone.getCountryCodeFromPhoneNumber(phoneNumber);
      const areaCode: string = Phone.getAreaCodeFromPhoneNumber(phoneNumber);

      /*
       * Update the incoming call policy with the purchased number
       * When using project config, customer pays Twilio directly (no markup, no billing cost stored)
       */
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: new Phone(purchased.phoneNumber),
          callProviderPhoneNumberId: purchased.phoneNumberId,
          phoneNumberCountryCode: countryCode,
          phoneNumberAreaCode: areaCode,
          // Only store costs if using global config (for billing purposes)
          callProviderCostPerMonthInUSDCents: isUsingProjectConfig
            ? null
            : purchased.providerCostPerMonthInUSDCents,
          customerCostPerMonthInUSDCents: isUsingProjectConfig
            ? null
            : Math.round(
                purchased.providerCostPerMonthInUSDCents *
                  PhoneNumberPriceMultiplier,
              ),
          phoneNumberPurchasedAt: new Date(),
        },
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        phoneNumberId: purchased.phoneNumberId,
        phoneNumber: purchased.phoneNumber,
      });
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Release a phone number
router.delete(
  "/release/:incomingCallPolicyId",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const incomingCallPolicyId: ObjectID | undefined = req.params[
        "incomingCallPolicyId"
      ]
        ? new ObjectID(req.params["incomingCallPolicyId"] as string)
        : undefined;

      if (!incomingCallPolicyId) {
        throw new BadDataException("incomingCallPolicyId is required");
      }

      // Get the incoming call policy with its project config
      const incomingCallPolicy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: incomingCallPolicyId,
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
            routingPhoneNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!incomingCallPolicy) {
        throw new BadDataException("Incoming Call Policy not found");
      }

      if (!incomingCallPolicy.callProviderPhoneNumberId) {
        throw new BadDataException("This policy does not have a phone number");
      }

      // Get the appropriate provider (project config or global)
      let provider: ICallProvider;

      if (incomingCallPolicy.projectCallSMSConfigId) {
        const customTwilioConfig: TwilioConfig | null =
          await getProjectTwilioConfig(
            incomingCallPolicy.projectCallSMSConfigId,
          );
        if (!customTwilioConfig) {
          throw new BadDataException("Project Call/SMS Config not found");
        }
        provider =
          CallProviderFactory.getProviderWithConfig(customTwilioConfig);
      } else {
        provider = await CallProviderFactory.getProvider();
      }

      await provider.releaseNumber(
        incomingCallPolicy.callProviderPhoneNumberId,
      );

      // Update the incoming call policy to remove the phone number
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: null,
          callProviderPhoneNumberId: null,
          phoneNumberCountryCode: null,
          phoneNumberAreaCode: null,
          callProviderCostPerMonthInUSDCents: null,
          customerCostPerMonthInUSDCents: null,
          phoneNumberPurchasedAt: null,
        } as any, // TypeORM allows null for nullable columns
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
      });
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

export default router;
