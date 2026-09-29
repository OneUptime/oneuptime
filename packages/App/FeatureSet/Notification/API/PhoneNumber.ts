import CallProviderFactory from "../Providers/CallProviderFactory";
import { getProjectTwilioConfig } from "../Utils/TwilioConfigHelper";
import { HttpProtocol, Host } from "Common/Server/EnvironmentConfig";
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
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import Permission from "Common/Types/Permission";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import Project from "Common/Models/DatabaseModels/Project";
import Phone from "Common/Types/Phone";
import IncomingCallPolicyPhoneNumberService from "Common/Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import CommonAPI from "Common/Server/API/CommonAPI";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "Common/Types/BaseDatabase/Query";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";

const router: ExpressRouter = Express.getRouter();

/*
 * Returns the project (tenant) id the caller was authenticated and authorized
 * for by UserMiddleware. This is the authoritative project for the request —
 * body/URL-supplied project ids must NOT be trusted for ownership decisions.
 */
function getAuthenticatedProjectId(req: ExpressRequest): ObjectID {
  const tenantId: ObjectID | undefined = (req as OneUptimeRequest).tenantId;
  if (!tenantId) {
    throw new BadDataException("Project ID not found in request");
  }
  return tenantId;
}

/*
 * Custom number-management routes do not pass through BaseAPI's record-level
 * label/owner scoping. Reapply the policy's normal update authorization here;
 * the route-level permission check alone only proves that a matching grant
 * exists somewhere in the project.
 */
async function assertCanEditIncomingCallPolicy(data: {
  req: ExpressRequest;
  policy: IncomingCallPolicy;
  projectId: ObjectID;
}): Promise<void> {
  if (!data.policy.id) {
    throw new NotAuthorizedException(
      "You do not have permission to edit this incoming call policy.",
    );
  }

  const databaseProps: DatabaseCommonInteractionProps =
    await CommonAPI.getDatabaseCommonInteractionProps(data.req);

  await ModelPermission.checkUpdatePermissionByModel({
    modelType: IncomingCallPolicy,
    fetchModelWithAccessControlIds: async (): Promise<IncomingCallPolicy> => {
      return data.policy;
    },
    props: databaseProps,
  });

  const permittedQuery: Query<IncomingCallPolicy> =
    await ModelPermission.checkUpdateQueryPermissions(
      IncomingCallPolicy,
      {
        _id: data.policy.id,
        projectId: data.projectId,
      },
      {},
      databaseProps,
    );

  const permittedPolicy: IncomingCallPolicy | null =
    await IncomingCallPolicyService.findOneBy({
      query: permittedQuery,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!permittedPolicy) {
    throw new NotAuthorizedException(
      "You do not have permission to edit this incoming call policy.",
    );
  }
}

/*
 * Verifies the given Call/SMS config belongs to the authenticated project so a
 * caller cannot operate on another tenant's Twilio account by supplying its
 * config id.
 */
async function assertConfigBelongsToProject(
  projectCallSMSConfigId: ObjectID,
  projectId: ObjectID,
): Promise<void> {
  const config: ProjectCallSMSConfig | null =
    await ProjectCallSMSConfigService.findOneById({
      id: projectCallSMSConfigId,
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

  if (!config || config.projectId?.toString() !== projectId.toString()) {
    throw new BadDataException(
      "Project Call/SMS Config not found for this project",
    );
  }
}

/*
 * Avoid mutating a provider-owned number's webhook when the attachment is
 * already known locally. The database unique indexes remain the final guard
 * for concurrent requests that pass this preflight together.
 */
async function assertPhoneNumberCanBeAttached(data: {
  phoneNumber: Phone;
  projectCallSMSConfigId: ObjectID;
  callProviderPhoneNumberId?: string | undefined;
}): Promise<void> {
  const existingByPhonePromise: Promise<IncomingCallPolicyPhoneNumber | null> =
    IncomingCallPolicyPhoneNumberService.findOneBy({
      query: {
        phoneNumber: data.phoneNumber,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

  const existingByProviderPromise: Promise<IncomingCallPolicyPhoneNumber | null> =
    data.callProviderPhoneNumberId
      ? IncomingCallPolicyPhoneNumberService.findOneBy({
          query: {
            projectCallSMSConfigId: data.projectCallSMSConfigId,
            callProviderPhoneNumberId: data.callProviderPhoneNumberId,
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        })
      : Promise.resolve(null);

  const existingLegacyPolicyPromise: Promise<IncomingCallPolicy | null> =
    IncomingCallPolicyService.findOneBy({
      query: {
        routingPhoneNumber: data.phoneNumber,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

  const [existingByPhone, existingByProvider, existingLegacyPolicy] =
    await Promise.all([
      existingByPhonePromise,
      existingByProviderPromise,
      existingLegacyPolicyPromise,
    ]);

  if (existingByPhone || existingByProvider || existingLegacyPolicy) {
    throw new BadDataException(
      "This phone number is already attached to an incoming call policy. Release it before attaching it again.",
    );
  }
}

/*
 * During a rolling upgrade a policy can still have its original number only
 * in the legacy scalar columns. Creating a new child first would make the
 * compatibility mirror overwrite that original attachment. Preserve it as a
 * child before any provider mutation so the old number remains routable and
 * releasable. Existing policies stay on this compatibility path until their
 * first additional-number mutation, avoiding an unsafe eager rollout write.
 */
async function preserveLegacyPolicyPhoneNumber(
  policy: IncomingCallPolicy,
  projectId: ObjectID,
): Promise<void> {
  if (!policy.routingPhoneNumber) {
    return;
  }

  if (
    !policy.id ||
    !policy.projectCallSMSConfigId ||
    !policy.callProviderPhoneNumberId
  ) {
    throw new BadDataException(
      "The existing phone number on this policy could not be migrated. Please repair or remove it before adding another number.",
    );
  }

  const findPreservedPhoneNumber: () => Promise<IncomingCallPolicyPhoneNumber | null> =
    async (): Promise<IncomingCallPolicyPhoneNumber | null> => {
      return await IncomingCallPolicyPhoneNumberService.findOneBy({
        query: {
          incomingCallPolicyId: policy.id!,
          phoneNumber: policy.routingPhoneNumber!,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });
    };

  if (await findPreservedPhoneNumber()) {
    return;
  }

  const legacyPhoneNumber: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();
  legacyPhoneNumber.projectId = projectId;
  legacyPhoneNumber.incomingCallPolicyId = policy.id;
  legacyPhoneNumber.projectCallSMSConfigId = policy.projectCallSMSConfigId;
  legacyPhoneNumber.phoneNumber = policy.routingPhoneNumber;
  legacyPhoneNumber.callProviderPhoneNumberId =
    policy.callProviderPhoneNumberId;

  if (policy.phoneNumberCountryCode !== undefined) {
    legacyPhoneNumber.countryCode = policy.phoneNumberCountryCode;
  }
  if (policy.phoneNumberAreaCode !== undefined) {
    legacyPhoneNumber.areaCode = policy.phoneNumberAreaCode;
  }
  if (policy.phoneNumberPurchasedAt !== undefined) {
    legacyPhoneNumber.phoneNumberPurchasedAt = policy.phoneNumberPurchasedAt;
  }

  try {
    await IncomingCallPolicyPhoneNumberService.create({
      data: legacyPhoneNumber,
      props: {
        isRoot: true,
      },
    });
  } catch (error) {
    /* Another request may have won the insert race. */
    if (await findPreservedPhoneNumber()) {
      return;
    }

    throw error;
  }
}

// Search available phone numbers
router.post(
  "/search",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallPolicy,
    ],
  }),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      // Use the authenticated project, not a caller-supplied projectId.
      const projectId: ObjectID = getAuthenticatedProjectId(req);

      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      if (!projectCallSMSConfigId) {
        throw new BadDataException(
          "projectCallSMSConfigId is required. Please configure a project-level Twilio configuration.",
        );
      }

      // Ensure the Twilio config belongs to the authenticated project.
      await assertConfigBelongsToProject(projectCallSMSConfigId, projectId);

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
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

// List owned phone numbers (already purchased in Twilio account)
router.post(
  "/list-owned",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.ReadProjectIncomingCallPolicy,
    ],
  }),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      // Use the authenticated project, not a caller-supplied projectId.
      const projectId: ObjectID = getAuthenticatedProjectId(req);

      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      if (!projectCallSMSConfigId) {
        throw new BadDataException(
          "projectCallSMSConfigId is required. Please configure a project-level Twilio configuration.",
        );
      }

      // Ensure the Twilio config belongs to the authenticated project.
      await assertConfigBelongsToProject(projectCallSMSConfigId, projectId);

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
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

// Assign an existing phone number to a policy
router.post(
  "/assign-existing",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncomingCallPolicy,
    ],
  }),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      // Use the authenticated project, not a caller-supplied projectId.
      const projectId: ObjectID = getAuthenticatedProjectId(req);

      const phoneNumberId: string | undefined = body["phoneNumberId"] as
        | string
        | undefined;

      const phoneNumber: string | undefined = body["phoneNumber"] as
        | string
        | undefined;

      const rawIncomingCallPolicyId: string | undefined = body[
        "incomingCallPolicyId"
      ] as string | undefined;

      /*
       * ObjectID does not validate, so an unparseable id would otherwise
       * reach Postgres and surface as an untranslated 22P02 server error.
       */
      if (
        rawIncomingCallPolicyId &&
        !ObjectID.isValidUUID(rawIncomingCallPolicyId)
      ) {
        throw new BadDataException("incomingCallPolicyId is not valid");
      }

      const incomingCallPolicyId: ObjectID | undefined = rawIncomingCallPolicyId
        ? new ObjectID(rawIncomingCallPolicyId)
        : undefined;

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
            callProviderPhoneNumberId: true,
            phoneNumberCountryCode: true,
            phoneNumberAreaCode: true,
            phoneNumberPurchasedAt: true,
            labels: {
              _id: true,
              name: true,
            },
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

      await assertCanEditIncomingCallPolicy({
        req,
        policy: incomingCallPolicy,
        projectId,
      });

      // Require project-level Twilio config
      if (!incomingCallPolicy.projectCallSMSConfigId) {
        throw new BadDataException(
          "This policy does not have a project Twilio configuration. Please configure one first.",
        );
      }

      await assertConfigBelongsToProject(
        incomingCallPolicy.projectCallSMSConfigId,
        projectId,
      );

      await preserveLegacyPolicyPhoneNumber(incomingCallPolicy, projectId);

      await assertPhoneNumberCanBeAttached({
        phoneNumber: new Phone(phoneNumber),
        projectCallSMSConfigId: incomingCallPolicy.projectCallSMSConfigId,
        callProviderPhoneNumberId: phoneNumberId,
      });

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

      const assigned: PurchasedPhoneNumber =
        await provider.assignExistingNumber(phoneNumberId, webhookUrl);

      /* The provider response is authoritative and may differ from the input. */
      await assertPhoneNumberCanBeAttached({
        phoneNumber: new Phone(assigned.phoneNumber),
        projectCallSMSConfigId: incomingCallPolicy.projectCallSMSConfigId,
        callProviderPhoneNumberId: assigned.phoneNumberId,
      });

      const attachedPhoneNumber: IncomingCallPolicyPhoneNumber =
        new IncomingCallPolicyPhoneNumber();
      attachedPhoneNumber.projectId = projectId;
      attachedPhoneNumber.incomingCallPolicyId = incomingCallPolicyId;
      attachedPhoneNumber.projectCallSMSConfigId =
        incomingCallPolicy.projectCallSMSConfigId;
      attachedPhoneNumber.phoneNumber = new Phone(assigned.phoneNumber);
      attachedPhoneNumber.callProviderPhoneNumberId = assigned.phoneNumberId;
      attachedPhoneNumber.countryCode = Phone.getCountryCodeFromPhoneNumber(
        assigned.phoneNumber,
      );
      attachedPhoneNumber.areaCode = Phone.getAreaCodeFromPhoneNumber(
        assigned.phoneNumber,
      );
      attachedPhoneNumber.phoneNumberPurchasedAt = new Date();

      const createdPhoneNumber: IncomingCallPolicyPhoneNumber =
        await IncomingCallPolicyPhoneNumberService.create({
          data: attachedPhoneNumber,
          props: {
            isRoot: true,
          },
        });

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        phoneNumberId: assigned.phoneNumberId,
        phoneNumber: assigned.phoneNumber,
        incomingCallPolicyPhoneNumberId: createdPhoneNumber.id?.toString(),
      });
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

// Purchase a phone number
router.post(
  "/purchase",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncomingCallPolicy,
    ],
  }),
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      // Use the authenticated project, not a caller-supplied projectId.
      const projectId: ObjectID = getAuthenticatedProjectId(req);

      const phoneNumber: string | undefined = body["phoneNumber"] as
        | string
        | undefined;

      const rawIncomingCallPolicyId: string | undefined = body[
        "incomingCallPolicyId"
      ] as string | undefined;

      /*
       * ObjectID does not validate, so an unparseable id would otherwise
       * reach Postgres and surface as an untranslated 22P02 server error.
       */
      if (
        rawIncomingCallPolicyId &&
        !ObjectID.isValidUUID(rawIncomingCallPolicyId)
      ) {
        throw new BadDataException("incomingCallPolicyId is not valid");
      }

      const incomingCallPolicyId: ObjectID | undefined = rawIncomingCallPolicyId
        ? new ObjectID(rawIncomingCallPolicyId)
        : undefined;

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
            callProviderPhoneNumberId: true,
            phoneNumberCountryCode: true,
            phoneNumberAreaCode: true,
            phoneNumberPurchasedAt: true,
            labels: {
              _id: true,
              name: true,
            },
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

      await assertCanEditIncomingCallPolicy({
        req,
        policy: incomingCallPolicy,
        projectId,
      });

      // Require project-level Twilio config
      if (!incomingCallPolicy.projectCallSMSConfigId) {
        throw new BadDataException(
          "This policy does not have a project Twilio configuration. Please configure one first.",
        );
      }

      await assertConfigBelongsToProject(
        incomingCallPolicy.projectCallSMSConfigId,
        projectId,
      );

      await preserveLegacyPolicyPhoneNumber(incomingCallPolicy, projectId);

      await assertPhoneNumberCanBeAttached({
        phoneNumber: new Phone(phoneNumber),
        projectCallSMSConfigId: incomingCallPolicy.projectCallSMSConfigId,
      });

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

      /*
       * Persist the purchased number as a policy child row. If this fails, roll back the
       * Twilio purchase so we never leave a paid, untracked number that can't be
       * released later (it would have no stored SID otherwise).
       * Country/area code are derived from the authoritative Twilio-returned
       * number, not the client-supplied one.
       */
      let createdPhoneNumber: IncomingCallPolicyPhoneNumber | null = null;

      try {
        /*
         * Re-check the canonical provider result. If this discovers a duplicate,
         * the catch below releases the newly purchased number just like any
         * other persistence failure.
         */
        await assertPhoneNumberCanBeAttached({
          phoneNumber: new Phone(purchased.phoneNumber),
          projectCallSMSConfigId: incomingCallPolicy.projectCallSMSConfigId,
          callProviderPhoneNumberId: purchased.phoneNumberId,
        });

        const countryCode: string = Phone.getCountryCodeFromPhoneNumber(
          purchased.phoneNumber,
        );
        const areaCode: string = Phone.getAreaCodeFromPhoneNumber(
          purchased.phoneNumber,
        );

        const purchasedPhoneNumber: IncomingCallPolicyPhoneNumber =
          new IncomingCallPolicyPhoneNumber();
        purchasedPhoneNumber.projectId = projectId;
        purchasedPhoneNumber.incomingCallPolicyId = incomingCallPolicyId;
        purchasedPhoneNumber.projectCallSMSConfigId =
          incomingCallPolicy.projectCallSMSConfigId;
        purchasedPhoneNumber.phoneNumber = new Phone(purchased.phoneNumber);
        purchasedPhoneNumber.callProviderPhoneNumberId =
          purchased.phoneNumberId;
        purchasedPhoneNumber.countryCode = countryCode;
        purchasedPhoneNumber.areaCode = areaCode;
        purchasedPhoneNumber.phoneNumberPurchasedAt = new Date();

        createdPhoneNumber = await IncomingCallPolicyPhoneNumberService.create({
          data: purchasedPhoneNumber,
          props: {
            isRoot: true,
          },
        });
      } catch (persistErr) {
        logger.error(
          `Failed to attach purchased number ${purchased.phoneNumber} (SID ${purchased.phoneNumberId}) to policy ${incomingCallPolicyId.toString()}. Rolling back the provider purchase to avoid an orphaned paid number.`,
        );
        try {
          await provider.releaseNumber(purchased.phoneNumberId);
        } catch (releaseErr) {
          logger.error(
            `Rollback release failed for orphaned number SID ${purchased.phoneNumberId}. Manual cleanup may be required on the provider account.`,
          );
          logger.error(releaseErr);
        }
        throw persistErr;
      }

      return Response.sendJsonObjectResponse(req, res, {
        success: true,
        phoneNumberId: purchased.phoneNumberId,
        phoneNumber: purchased.phoneNumber,
        incomingCallPolicyPhoneNumberId: createdPhoneNumber?.id?.toString(),
      });
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

async function releasePhoneNumberHandler(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<ExpressResponse | void> {
  try {
    const rawIncomingCallPolicyId: string | undefined = req.params[
      "incomingCallPolicyId"
    ] as string | undefined;
    const rawIncomingCallPolicyPhoneNumberId: string | undefined = req.params[
      "incomingCallPolicyPhoneNumberId"
    ] as string | undefined;

    if (!rawIncomingCallPolicyId) {
      throw new BadDataException("incomingCallPolicyId is required");
    }

    /*
     * ObjectID does not validate, so an unparseable id would otherwise reach
     * Postgres and surface as an untranslated 22P02 server error.
     */
    if (!ObjectID.isValidUUID(rawIncomingCallPolicyId)) {
      throw new BadDataException("incomingCallPolicyId is not valid");
    }

    if (
      rawIncomingCallPolicyPhoneNumberId &&
      !ObjectID.isValidUUID(rawIncomingCallPolicyPhoneNumberId)
    ) {
      throw new BadDataException(
        "incomingCallPolicyPhoneNumberId is not valid",
      );
    }

    const incomingCallPolicyId: ObjectID = new ObjectID(
      rawIncomingCallPolicyId,
    );
    const incomingCallPolicyPhoneNumberId: ObjectID | undefined =
      rawIncomingCallPolicyPhoneNumberId
        ? new ObjectID(rawIncomingCallPolicyPhoneNumberId)
        : undefined;

    const incomingCallPolicy: IncomingCallPolicy | null =
      await IncomingCallPolicyService.findOneById({
        id: incomingCallPolicyId,
        select: {
          _id: true,
          projectId: true,
          callProviderPhoneNumberId: true,
          projectCallSMSConfigId: true,
          labels: {
            _id: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!incomingCallPolicy) {
      throw new BadDataException("Incoming Call Policy not found");
    }

    const projectId: ObjectID = getAuthenticatedProjectId(req);
    if (incomingCallPolicy.projectId?.toString() !== projectId.toString()) {
      throw new BadDataException(
        "Incoming Call Policy does not belong to this project",
      );
    }

    await assertCanEditIncomingCallPolicy({
      req,
      policy: incomingCallPolicy,
      projectId,
    });

    let phoneNumberToRelease: IncomingCallPolicyPhoneNumber | null = null;

    if (incomingCallPolicyPhoneNumberId) {
      phoneNumberToRelease =
        await IncomingCallPolicyPhoneNumberService.findOneBy({
          query: {
            _id: incomingCallPolicyPhoneNumberId,
            incomingCallPolicyId,
            projectId,
          },
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!phoneNumberToRelease) {
        throw new BadDataException(
          "Incoming Call Policy phone number not found for this policy",
        );
      }
    } else if (incomingCallPolicy.callProviderPhoneNumberId) {
      /*
       * Backward-compatible route: older dashboard clients identify only the
       * policy. Prefer the child represented by the policy's scalar mirror.
       * If that scalar is a missed legacy attachment which differs from every
       * child, leave phoneNumberToRelease null so the scalar itself is released
       * rather than accidentally deleting an unrelated child.
       */
      const mirroredChildQuery: Query<IncomingCallPolicyPhoneNumber> = {
        incomingCallPolicyId,
        projectId,
        callProviderPhoneNumberId: incomingCallPolicy.callProviderPhoneNumberId,
      };

      if (incomingCallPolicy.projectCallSMSConfigId) {
        mirroredChildQuery.projectCallSMSConfigId =
          incomingCallPolicy.projectCallSMSConfigId;
      }

      phoneNumberToRelease =
        await IncomingCallPolicyPhoneNumberService.findOneBy({
          query: mirroredChildQuery,
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          props: {
            isRoot: true,
          },
        });
    } else {
      phoneNumberToRelease =
        await IncomingCallPolicyPhoneNumberService.findOneBy({
          query: {
            incomingCallPolicyId,
            projectId,
          },
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
            _id: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
        });
    }

    const callProviderPhoneNumberId: string | undefined =
      phoneNumberToRelease !== null
        ? phoneNumberToRelease.callProviderPhoneNumberId
        : incomingCallPolicy.callProviderPhoneNumberId;
    const projectCallSMSConfigId: ObjectID | undefined =
      phoneNumberToRelease !== null
        ? phoneNumberToRelease.projectCallSMSConfigId
        : incomingCallPolicy.projectCallSMSConfigId;

    if (!callProviderPhoneNumberId) {
      throw new BadDataException("This policy does not have a phone number");
    }

    if (!projectCallSMSConfigId) {
      throw new BadDataException(
        "This phone number does not have a project Twilio configuration.",
      );
    }

    await assertConfigBelongsToProject(projectCallSMSConfigId, projectId);

    const customTwilioConfig: TwilioConfig | null =
      await getProjectTwilioConfig(projectCallSMSConfigId);
    if (!customTwilioConfig) {
      throw new BadDataException("Project Call/SMS Config not found");
    }

    const provider: ICallProvider =
      CallProviderFactory.getProviderWithConfig(customTwilioConfig);

    await provider.releaseNumber(callProviderPhoneNumberId);

    if (phoneNumberToRelease?.id) {
      await IncomingCallPolicyPhoneNumberService.deleteOneById({
        id: phoneNumberToRelease.id,
        props: {
          isRoot: true,
        },
      });
    } else {
      /* Scalar-only rolling-upgrade fallback. */
      await IncomingCallPolicyService.updateOneById({
        id: incomingCallPolicyId,
        data: {
          routingPhoneNumber: null,
          callProviderPhoneNumberId: null,
          phoneNumberCountryCode: null,
          phoneNumberAreaCode: null,
          phoneNumberPurchasedAt: null,
          // TypeORM columns are nullable even though PartialEntity omits null.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        props: {
          isRoot: true,
        },
      });

      /* Promote any remaining child after removing an unmatched scalar. */
      await IncomingCallPolicyPhoneNumberService.syncPrimaryPhoneNumberToPolicy(
        incomingCallPolicyId,
      );
    }

    return Response.sendJsonObjectResponse(req, res, {
      success: true,
      incomingCallPolicyPhoneNumberId: phoneNumberToRelease?.id?.toString(),
    });
  } catch (err) {
    logger.error(err, getLogAttributesFromRequest(req as RequestLike));
    return next(err);
  }
}

// Release one explicitly selected number from a policy.
router.delete(
  "/release/:incomingCallPolicyId/:incomingCallPolicyPhoneNumberId",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncomingCallPolicy,
    ],
  }),
  releasePhoneNumberHandler,
);

// Legacy clients release the primary (oldest) number by policy id only.
router.delete(
  "/release/:incomingCallPolicyId",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  UserMiddleware.requirePermission({
    permissions: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.EditProjectIncomingCallPolicy,
    ],
  }),
  releasePhoneNumberHandler,
);

/*
 * Internal endpoint (cluster-key authenticated) used by Common-layer services to
 * release a provisioned number when a policy or its Twilio config is deleted.
 * The Common layer cannot reach the call provider directly, so it delegates here
 * (mirroring how CallService delegates outbound calls to the notification app).
 */
router.post(
  "/internal/release",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const body: JSONObject = req.body as JSONObject;

      const projectCallSMSConfigId: ObjectID | undefined = body[
        "projectCallSMSConfigId"
      ]
        ? new ObjectID(body["projectCallSMSConfigId"] as string)
        : undefined;

      const callProviderPhoneNumberId: string | undefined = body[
        "callProviderPhoneNumberId"
      ] as string | undefined;

      if (!projectCallSMSConfigId || !callProviderPhoneNumberId) {
        throw new BadDataException(
          "projectCallSMSConfigId and callProviderPhoneNumberId are required",
        );
      }

      const customTwilioConfig: TwilioConfig | null =
        await getProjectTwilioConfig(projectCallSMSConfigId);

      if (!customTwilioConfig) {
        /*
         * Config is already gone; we cannot build a provider to release the
         * number. Nothing more to do here — treat as success.
         */
        return Response.sendJsonObjectResponse(req, res, { success: true });
      }

      const provider: ICallProvider =
        CallProviderFactory.getProviderWithConfig(customTwilioConfig);

      // releaseNumber is idempotent (already-gone is treated as success).
      await provider.releaseNumber(callProviderPhoneNumberId);

      return Response.sendJsonObjectResponse(req, res, { success: true });
    } catch (err) {
      logger.error(err, getLogAttributesFromRequest(req as RequestLike));
      return next(err);
    }
  },
);

export default router;
