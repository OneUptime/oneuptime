import SecurityEventDestination from "../../Models/DatabaseModels/SecurityEventDestination";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import { Service as SecurityEventConnectionServiceClass } from "../Services/SecurityEventConnectionService";
import SecurityEventDestinationService, {
  Service as SecurityEventDestinationServiceType,
} from "../Services/SecurityEventDestinationService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityEventDestinationRegistry from "../Utils/SecurityEvent/Destinations/SecurityEventDestinationRegistry";
import { SecurityEventDestinationSettings } from "../Utils/SecurityEvent/Destinations/Types";
import ConnectorErrorMessage from "../Utils/SecurityEvent/ConnectorErrorMessage";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Security event destinations: the CRUD routes, and
 *
 *   POST /security-event-destination/test
 *
 * which sends ONE test event to the SIEM, so a person setting a destination
 * up sees it arrive before anything real is sent. The body is either
 *   { destinationId, config?, secrets? } - a saved destination, with the
 *     edit form's unsaved values over it by the rule a save applies (a
 *     secret value replaces the stored one, "" or undefined keeps it, null
 *     removes it); the stored secrets are read here and never returned; or
 *   { provider, config, secrets } - settings never saved, so the create
 *     form can test before storing anything.
 * Same gate as editing a destination: whoever may configure it may test it.
 */
export default class SecurityEventDestinationAPI extends BaseAPI<
  SecurityEventDestination,
  SecurityEventDestinationServiceType
> {
  public constructor() {
    super(SecurityEventDestination, SecurityEventDestinationService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/test`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertPermittedInProject({
            databaseProps: props,
            allowedPermissions:
              new SecurityEventDestination().getUpdatePermissions(),
            errorMessage:
              "Testing a destination takes Security Admin, or Project Owner or Project Admin.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const settings: SecurityEventDestinationSettings =
            await this.readSettingsToTest({ body, projectId, props });

          try {
            await SecurityEventDestinationRegistry.getSender(
              settings.provider,
            ).sendTestEvent(settings);
          } catch (error) {
            return Response.sendJsonObjectResponse(req, res, {
              isSuccessful: false,
              message: ConnectorErrorMessage.toMessage(error),
            });
          }

          return Response.sendJsonObjectResponse(req, res, {
            isSuccessful: true,
            message:
              "A test event was sent. It shows in your SIEM within a few minutes.",
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private async readSettingsToTest(data: {
    body: JSONObject;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityEventDestinationSettings> {
    const { body, projectId, props } = data;
    const destinationIdValue: JSONValue | undefined = body["destinationId"];

    if (destinationIdValue === undefined || destinationIdValue === null) {
      return SecurityEventDestinationServiceType.validateSettings({
        provider: body["provider"],
        config: SecurityEventConnectionServiceClass.parseJsonObject(
          body["config"],
          "Configuration",
        ),
        secrets: SecurityEventConnectionServiceClass.parseJsonObject(
          body["secrets"],
          "Credentials",
        ),
        requireRequiredSecrets: true,
      });
    }

    const destinationId: string = String(destinationIdValue);

    if (!ObjectID.isValidUUID(destinationId)) {
      throw new BadDataException("A valid destination ID is required.");
    }

    // Read as the caller first, so a destination of another project is never found.
    const visible: SecurityEventDestination | null =
      await SecurityEventDestinationService.findOneBy({
        query: { _id: destinationId, projectId },
        select: { _id: true, projectId: true },
        props,
      });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: visible?.projectId,
      projectId,
    });

    const stored: SecurityEventDestination | null =
      await SecurityEventDestinationService.findOneById({
        id: new ObjectID(destinationId),
        select: {
          _id: true,
          provider: true,
          config: true,
          secrets: true,
        },
        props: { isRoot: true },
      });

    if (!stored || !stored.provider) {
      throw new BadDataException("The destination no longer exists.");
    }

    const storedSettings: SecurityEventDestinationSettings =
      await SecurityEventDestinationService.getSettings(stored);

    const config: JSONObject =
      body["config"] !== undefined && body["config"] !== null
        ? SecurityEventConnectionServiceClass.parseJsonObject(
            body["config"],
            "Configuration",
          )
        : storedSettings.config;

    const secrets: JSONObject =
      SecurityEventConnectionServiceClass.mergeSecrets({
        definition: SecurityEventDestinationServiceType.getDefinitionOrThrow(
          stored.provider,
        ),
        stored: storedSettings.secrets,
        provided:
          body["secrets"] !== undefined && body["secrets"] !== null
            ? SecurityEventConnectionServiceClass.parseJsonObject(
                body["secrets"],
                "Credentials",
              )
            : {},
      });

    return SecurityEventDestinationServiceType.validateSettings({
      provider: stored.provider,
      config,
      secrets,
      requireRequiredSecrets: true,
    });
  }
}
