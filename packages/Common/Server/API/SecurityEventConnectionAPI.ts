import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityEventConnectionService, {
  Service as SecurityEventConnectionServiceType,
} from "../Services/SecurityEventConnectionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import SecurityEventConnectionRunExecutor from "../Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor";
import SecurityEventConnectionTester from "../Utils/SecurityEvent/Connectors/SecurityEventConnectionTester";
import { SecurityConnectorSettings } from "../Utils/SecurityEvent/Connectors/Types";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

export default class SecurityEventConnectionAPI extends BaseAPI<
  SecurityEventConnection,
  SecurityEventConnectionServiceType
> {
  public constructor() {
    super(SecurityEventConnection, SecurityEventConnectionService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    /*
     * Queue an operation (test, poll, preview, backfill) for the worker.
     * Same gate as editing the connection: whoever may configure it may
     * operate it.
     */
    this.router.post(
      `${basePath}/:connectionId/run`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);
          this.assertCanOperate(props);

          const connectionId: string | undefined = req.params["connectionId"];

          if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
            throw new BadDataException("A valid connection ID is required.");
          }

          const connection: SecurityEventConnection | null =
            await this.service.findOneBy({
              query: { _id: connectionId, projectId },
              select: { _id: true, projectId: true },
              props,
            });
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: connection?.projectId,
            projectId,
          });

          const runId: ObjectID =
            await SecurityEventConnectionRunExecutor.enqueue({
              projectId,
              connectionId: new ObjectID(connectionId),
              options: SecurityEventConnectionRunExecutor.validateOptions(
                req.body,
              ),
              requestedByUserId: props.userId,
            });

          return Response.sendJsonObjectResponse(req, res, {
            runId: runId.toString(),
          });
        } catch (error) {
          next(error);
        }
      },
    );

    /*
     * Synchronous connection test. Body is either
     *   { connectionId, config?, secrets?, alertingOnly? } — a saved
     *     connection, optionally with the edit form's unsaved values
     *     overlaid by the same rule a save applies: a config replaces the
     *     stored one; a secret value replaces the stored one, "" or
     *     undefined keeps it, null removes it (so the edit form can test a
     *     cleared optional credential before saving); a boolean alertingOnly
     *     replaces the stored one, null or undefined keeps it. The stored
     *     secrets are read here with root props and never returned, because
     *     an edit form can never read them back. Or
     *   { provider, config, secrets, alertingOnly? } — settings that were
     *     never saved, so the create form can test before storing anything.
     * Nothing is persisted except a run-history row for a saved connection
     * tested exactly as stored: a row describing settings that were never
     * saved would misstate that connection's history (see
     * overlaysStoredSettings).
     */
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
          this.assertCanOperate(props);

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          /*
           * Rejected the way a save rejects it, instead of being read as
           * "not provided" and silently testing a different selection than
           * the one on screen. null is the one non-boolean accepted: it
           * keeps the stored value, as it did on the Google SecOps test
           * route this endpoint replaces.
           */
          const alertingOnlyValue: JSONValue | undefined = body["alertingOnly"];

          if (
            alertingOnlyValue !== undefined &&
            alertingOnlyValue !== null &&
            typeof alertingOnlyValue !== "boolean"
          ) {
            throw new BadDataException(
              "Alerting records only must be true or false.",
            );
          }

          const connectionIdValue: JSONValue | undefined = body["connectionId"];
          let connection: SecurityEventConnection | undefined = undefined;
          let settings: SecurityConnectorSettings;
          // Only ever true for a saved connection tested exactly as stored.
          let recordRun: boolean = false;

          if (connectionIdValue !== undefined && connectionIdValue !== null) {
            const connectionId: string = String(connectionIdValue);

            if (!ObjectID.isValidUUID(connectionId)) {
              throw new BadDataException("A valid connection ID is required.");
            }

            const accessible: SecurityEventConnection | null =
              await this.service.findOneBy({
                query: { _id: connectionId, projectId },
                select: { _id: true, projectId: true },
                props,
              });
            CommonAPI.assertResourceBelongsToProject({
              resourceProjectId: accessible?.projectId,
              projectId,
            });

            const loaded: SecurityEventConnection | null =
              await this.service.findOneById({
                id: new ObjectID(connectionId),
                select: {
                  _id: true,
                  projectId: true,
                  name: true,
                  provider: true,
                  config: true,
                  secrets: true,
                  alertingOnly: true,
                  isEnabled: true,
                  pollIntervalInMinutes: true,
                  createdAt: true,
                  lastPolledAt: true,
                  lastSuccessfulPollAt: true,
                  lastEventIngestedAt: true,
                  lastError: true,
                },
                props: { isRoot: true },
              });

            if (!loaded || !loaded.provider) {
              throw new BadDataException("The connection no longer exists.");
            }

            connection = loaded;

            const stored: SecurityConnectorSettings =
              await this.service.getConnectorSettings(loaded);
            const config: JSONObject =
              body["config"] !== undefined
                ? SecurityEventConnectionServiceType.parseJsonObject(
                    body["config"],
                    "Configuration",
                  )
                : stored.config;
            const overlay: JSONObject =
              body["secrets"] !== undefined
                ? SecurityEventConnectionServiceType.parseJsonObject(
                    body["secrets"],
                    "Credentials",
                  )
                : {};
            /*
             * The merge a save would apply. Testing with a different rule
             * would pass settings that cannot be stored, or report a
             * cleared credential as still in use (review finding
             * optional-secret-cannot-be-cleared).
             */
            const secrets: JSONObject =
              SecurityEventConnectionServiceType.mergeSecrets({
                definition:
                  SecurityEventConnectionServiceType.getDefinitionOrThrow(
                    loaded.provider,
                  ),
                stored: stored.secrets,
                provided: overlay,
              });
            const alertingOnly: boolean =
              typeof alertingOnlyValue === "boolean"
                ? alertingOnlyValue
                : stored.alertingOnly;

            settings =
              await SecurityEventConnectionServiceType.validateSettings({
                provider: loaded.provider,
                config,
                secrets,
                alertingOnly,
                requireRequiredSecrets: true,
              });

            recordRun = !SecurityEventConnectionAPI.overlaysStoredSettings({
              stored,
              config,
              providedSecrets: overlay,
              alertingOnly,
            });
          } else {
            settings =
              await SecurityEventConnectionServiceType.validateSettings({
                provider: body["provider"],
                config: SecurityEventConnectionServiceType.parseJsonObject(
                  body["config"],
                  "Configuration",
                ),
                secrets: SecurityEventConnectionServiceType.parseJsonObject(
                  body["secrets"],
                  "Credentials",
                ),
                alertingOnly: alertingOnlyValue !== false,
                requireRequiredSecrets: true,
              });
          }

          const report: SecurityConnectorTestReport =
            await SecurityEventConnectionTester.test({
              settings,
              connection,
              recordRun,
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            report as unknown as JSONObject,
          );
        } catch (error) {
          next(error);
        }
      },
    );
  }

  private assertCanOperate(props: DatabaseCommonInteractionProps): void {
    CommonAPI.assertPermittedInProject({
      databaseProps: props,
      allowedPermissions: new SecurityEventConnection().getUpdatePermissions(),
      errorMessage:
        "Project owners, project administrators, and security administrators can run connection diagnostics.",
    });
  }

  /*
   * Whether a saved connection is tested with anything other than what it
   * stores (the edit form's unsaved values). Such a test is not recorded in
   * the connection's run history: a row describing settings that were
   * never saved would misstate that history, the defect the Google SecOps
   * test route fixed with the same rule (review finding
   * edit-form-test-ignores-edited-settings). Called only once the tested
   * settings have validated.
   *
   *  - config is compared by value, not by shape. Connectors trim what they
   *    read (readSettingString) and a form sends an optional field it left
   *    empty as "" where the stored row may have no key at all, so " us "
   *    equals "us", and "" or null equals an absent key. Anything else that
   *    differs is an overlay.
   *  - ANY provided secret is an overlay: a non-empty value even when it
   *    equals the stored one, and null even for a key that is not stored.
   *    Comparing against the stored secrets would let "was a row recorded"
   *    tell the caller whether a guessed credential, or an optional one, is
   *    stored, and secrets are write-only. "" and undefined keep the stored
   *    value (mergeSecrets), so they test what is saved.
   *  - alertingOnly is an overlay only when the tested value differs from
   *    the stored one; an equal value tests what is saved.
   */
  private static overlaysStoredSettings(data: {
    stored: SecurityConnectorSettings;
    config: JSONObject;
    providedSecrets: JSONObject;
    alertingOnly: boolean;
  }): boolean {
    if (
      !SecurityEventConnectionAPI.haveSameConfigValues(
        data.stored.config,
        data.config,
      )
    ) {
      return true;
    }

    for (const key of Object.keys(data.providedSecrets)) {
      const value: JSONValue | undefined = data.providedSecrets[key];

      if (value === null || (value !== undefined && value !== "")) {
        return true;
      }
    }

    return data.alertingOnly !== data.stored.alertingOnly;
  }

  private static haveSameConfigValues(
    stored: JSONObject,
    tested: JSONObject,
  ): boolean {
    const storedValues: Record<string, string> =
      SecurityEventConnectionAPI.normalizeConfigValues(stored);
    const testedValues: Record<string, string> =
      SecurityEventConnectionAPI.normalizeConfigValues(tested);
    const storedKeys: Array<string> = Object.keys(storedValues);

    if (storedKeys.length !== Object.keys(testedValues).length) {
      return false;
    }

    return storedKeys.every((key: string): boolean => {
      return testedValues[key] === storedValues[key];
    });
  }

  private static normalizeConfigValues(
    config: JSONObject,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};

    for (const key of Object.keys(config)) {
      const value: JSONValue | undefined = config[key];

      if (value === undefined || value === null) {
        continue;
      }

      const text: string =
        typeof value === "object"
          ? JSON.stringify(value)
          : String(value).trim();

      if (text) {
        normalized[key] = text;
      }
    }

    return normalized;
  }
}
