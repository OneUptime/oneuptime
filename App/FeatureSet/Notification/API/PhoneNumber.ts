import CallProviderFactory from "../Providers/CallProviderFactory";
import {
  HttpProtocol,
  Host,
} from "Common/Server/EnvironmentConfig";
import {
  AvailablePhoneNumber,
  ICallProvider,
  OwnedPhoneNumber,
  PurchasedPhoneNumber,
} from "Common/Types/Call/CallProvider";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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

      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      if (!projectId) {
        throw new BadDataException("projectId is required");
      }

      if (!projectCallSMSConfigId) {
        throw new BadDataException(
          "projectCallSMSConfigId is required. Please configure a project-level Twilio configuration.",
        );
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

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(projectCallSMSConfigId);
      if (!customTwilioConfig) {
        throw new BadDataException("Project Call/SMS Config not found");
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

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

      // Customer pays Twilio directly - just return the phone numbers
      type ResponseNumber = {
        phoneNumber: string;
        friendlyName: string;
        locality?: string;
        region?: string;
        country: string;
      };

      const responseNumbers: Array<ResponseNumber> = numbers.map(
        (n: AvailablePhoneNumber): ResponseNumber => {
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

// List owned phone numbers (already purchased in Twilio account)
router.post(
  "/list-owned",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectId: ObjectID | undefined = body["projectId"]
        ? new ObjectID(body["projectId"] as string)
        : undefined;

      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      if (!projectId) {
        throw new BadDataException("projectId is required");
      }

      if (!projectCallSMSConfigId) {
        throw new BadDataException(
          "projectCallSMSConfigId is required. Please configure a project-level Twilio configuration.",
        );
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

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(projectCallSMSConfigId);
      if (!customTwilioConfig) {
        throw new BadDataException("Project Call/SMS Config not found");
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      const numbers: OwnedPhoneNumber[] = await provider.listOwnedNumbers();

      type ResponseNumber = {
        phoneNumberId: string;
        phoneNumber: string;
        friendlyName: string;
        voiceUrl?: string | undefined;
      };

      const responseNumbers: Array<ResponseNumber> = numbers.map(
        (n: OwnedPhoneNumber): ResponseNumber => {
          return {
            phoneNumberId: n.phoneNumberId,
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName,
            voiceUrl: n.voiceUrl,
          };
        },
      );

      return Response.sendJsonObjectResponse(req, res, {
        ownedNumbers: responseNumbers,
      });
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Assign an existing phone number to a policy
router.post(
  "/assign-existing",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectId: ObjectID | undefined = body["projectId"]
        ? new ObjectID(body["projectId"] as string)
        : undefined;

      const phoneNumberId: string | undefined = body["phoneNumberId"] as
        | string
        | undefined;

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

      if (!phoneNumberId) {
        throw new BadDataException("phoneNumberId is required");
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

      // Require project-level Twilio config
      if (!incomingCallPolicy.projectCallSMSConfigId) {
        throw new BadDataException(
          "This policy does not have a project Twilio configuration. Please configure one first.",
        );
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(incomingCallPolicy.projectCallSMSConfigId);
      if (!customTwilioConfig) {
        throw new BadDataException("Project Call/SMS Config not found");
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      /*
       * Construct webhook URL - single endpoint for all phone numbers
       * Twilio sends the "To" phone number in every webhook, so we look up the policy by phone number
       */
      const webhookUrl: string = `${HttpProtocol}${Host}/notification/incoming-call/voice`;

      const assigned: PurchasedPhoneNumber = await provider.assignExistingNumber(
        phoneNumberId,
        webhookUrl,
      );

      // Get country code from phone number
      const countryCode: string =
        Phone.getCountryCodeFromPhoneNumber(phoneNumber);
      const areaCode: string = Phone.getAreaCodeFromPhoneNumber(phoneNumber);

      /*
       * Update the incoming call policy with the assigned number
       */
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: new Phone(assigned.phoneNumber),
          callProviderPhoneNumberId: assigned.phoneNumberId,
          phoneNumberCountryCode: countryCode,
          phoneNumberAreaCode: areaCode,
          phoneNumberPurchasedAt: new Date(),
        },
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        phoneNumberId: assigned.phoneNumberId,
        phoneNumber: assigned.phoneNumber,
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

      // Require project-level Twilio config
      if (!incomingCallPolicy.projectCallSMSConfigId) {
        throw new BadDataException(
          "This policy does not have a project Twilio configuration. Please configure one first.",
        );
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(incomingCallPolicy.projectCallSMSConfigId);
      if (!customTwilioConfig) {
        throw new BadDataException("Project Call/SMS Config not found");
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      /*
       * Construct webhook URL - single endpoint for all phone numbers
       * Twilio sends the "To" phone number in every webhook, so we look up the policy by phone number
       */
      const webhookUrl: string = `${HttpProtocol}${Host}/notification/incoming-call/voice`;

      const purchased: PurchasedPhoneNumber = await provider.purchaseNumber(
        phoneNumber,
        webhookUrl,
      );

      // Get country code from phone number
      const countryCode: string =
        Phone.getCountryCodeFromPhoneNumber(phoneNumber);
      const areaCode: string = Phone.getAreaCodeFromPhoneNumber(phoneNumber);

      /*
       * Update the incoming call policy with the purchased number
       * Customer pays Twilio directly - no billing cost stored
       */
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: new Phone(purchased.phoneNumber),
          callProviderPhoneNumberId: purchased.phoneNumberId,
          phoneNumberCountryCode: countryCode,
          phoneNumberAreaCode: areaCode,
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

      // Require project-level Twilio config
      if (!incomingCallPolicy.projectCallSMSConfigId) {
        throw new BadDataException(
          "This policy does not have a project Twilio configuration.",
        );
      }

      // Get project Twilio config
      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(incomingCallPolicy.projectCallSMSConfigId);
      if (!customTwilioConfig) {
        throw new BadDataException("Project Call/SMS Config not found");
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

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
