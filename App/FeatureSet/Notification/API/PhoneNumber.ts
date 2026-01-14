import CallProviderFactory from "../Providers/CallProviderFactory";
import {
  AvailablePhoneNumber,
  ICallProvider,
  PurchasedPhoneNumber,
} from "Common/Types/Call/CallProvider";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
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
import Project from "Common/Models/DatabaseModels/Project";
import Phone from "Common/Types/Phone";

const router: ExpressRouter = Express.getRouter();

// Environment variable for phone number price multiplier
const PHONE_NUMBER_PRICE_MULTIPLIER: number = process.env[
  "PHONE_NUMBER_PRICE_MULTIPLIER"
]
  ? parseFloat(process.env["PHONE_NUMBER_PRICE_MULTIPLIER"])
  : 1.2; // Default 20% markup

// Search available phone numbers
router.post(
  "/search",
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectId: ObjectID | undefined = body["projectId"]
        ? new ObjectID(body["projectId"] as string)
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

      const provider: ICallProvider = await CallProviderFactory.getProvider();

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

      // Apply markup to customer price
      const numbersWithMarkup: AvailablePhoneNumber[] = numbers.map(
        (number: AvailablePhoneNumber) => {
          return {
            ...number,
            customerCostPerMonthInUSDCents: Math.round(
              number.providerCostPerMonthInUSDCents *
                PHONE_NUMBER_PRICE_MULTIPLIER,
            ),
          };
        },
      );

      // If billing is not enabled, don't show cost
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
          if (!IsBillingEnabled) {
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

      // Check if incoming call policy exists
      const incomingCallPolicy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: incomingCallPolicyId,
          select: {
            _id: true,
            projectId: true,
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

      // Construct webhook URL
      const webhookUrl: string = `${process.env["HOST"] || "https://api.oneuptime.com"}/notification/incoming-call/${incomingCallPolicyId.toString()}/voice`;

      const provider: ICallProvider = await CallProviderFactory.getProvider();

      const purchased: PurchasedPhoneNumber = await provider.purchaseNumber(
        phoneNumber,
        webhookUrl,
      );

      // Get country code from phone number
      const countryCode: string = getCountryCodeFromPhoneNumber(phoneNumber);
      const areaCode: string = getAreaCodeFromPhoneNumber(phoneNumber);

      // Update the incoming call policy with the purchased number
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: new Phone(purchased.phoneNumber),
          callProviderPhoneNumberId: purchased.phoneNumberId,
          phoneNumberCountryCode: countryCode,
          phoneNumberAreaCode: areaCode,
          callProviderCostPerMonthInUSDCents:
            purchased.providerCostPerMonthInUSDCents,
          customerCostPerMonthInUSDCents: Math.round(
            purchased.providerCostPerMonthInUSDCents *
              PHONE_NUMBER_PRICE_MULTIPLIER,
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

      // Get the incoming call policy
      const incomingCallPolicy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: incomingCallPolicyId,
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
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

      const provider: ICallProvider = await CallProviderFactory.getProvider();

      await provider.releaseNumber(
        incomingCallPolicy.callProviderPhoneNumberId,
      );

      // Update the incoming call policy to remove the phone number
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
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

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
      });
    } catch (err) {
      logger.error(err);
      return next(err);
    }
  },
);

// Helper function to extract country code from phone number
function getCountryCodeFromPhoneNumber(phoneNumber: string): string {
  // Map common country calling codes to ISO country codes
  const countryCodeMap: Record<string, string> = {
    "+1": "US", // US and Canada
    "+44": "GB", // United Kingdom
    "+61": "AU", // Australia
    "+49": "DE", // Germany
    "+33": "FR", // France
    "+91": "IN", // India
    "+81": "JP", // Japan
    "+86": "CN", // China
    "+55": "BR", // Brazil
    "+52": "MX", // Mexico
  };

  for (const [prefix, countryCode] of Object.entries(countryCodeMap)) {
    if (phoneNumber.startsWith(prefix)) {
      return countryCode;
    }
  }

  return "US"; // Default to US if unknown
}

// Helper function to extract area code from phone number
function getAreaCodeFromPhoneNumber(phoneNumber: string): string {
  // Remove the country code prefix
  let number: string = phoneNumber;

  // For US/Canada numbers (+1), extract the next 3 digits
  if (phoneNumber.startsWith("+1")) {
    number = phoneNumber.substring(2);
    if (number.length >= 3) {
      return number.substring(0, 3);
    }
  }

  // For other countries, this is more complex - return empty for now
  return "";
}

export default router;
