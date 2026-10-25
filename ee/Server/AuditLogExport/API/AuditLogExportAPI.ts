import CommonAPI from "Common/Server/API/CommonAPI";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import AuditLogExportService, {
  Service as AuditLogExportServiceClass,
} from "Common/Server/Services/AuditLogExportService";
import { AuditLogExportSettings } from "Common/Server/Utils/AuditLog/Export/AuditLogExportSettings";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import ConnectorErrorMessage from "Common/Server/Utils/SecurityEvent/ConnectorErrorMessage";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import {
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationKind,
  getAuditLogExportDestinationDefinition,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AuditLogExporter from "../AuditLogExporter";
import { AuditLogExportDeliveryReceipt } from "../Destinations/Types";

/*
 * Testing an audit log export before anything real is sent:
 *
 *   POST /audit-log-export/test           a project's export (Project Owner or Admin)
 *   POST /audit-log-export/instance/test  the instance's (master admins)
 *
 * which delivers ONE test entry (action "Test") to the destination: a file
 * written to a fixed name in the bucket's folder, overwritten by every
 * test; a request to the webhook; a syslog message. The answer is
 * { isSuccessful, message }, and a failure says what is wrong in words an
 * operator can act on (S3's AccessDenied: allow s3:PutObject on the folder).
 *
 * The body is either
 *   { exportId, config?, secrets? } - a saved export, with the edit form's
 *     unsaved values over it by the rule a save applies (a secret value
 *     replaces the stored one, "" or undefined keeps it, null removes it);
 *     the stored secrets are read here and never returned; or
 *   { destinationType, config, secrets } - settings never saved, so the
 *     create form can test before storing anything.
 *
 * Same gate as setting an export up: a project's test asks exactly what
 * creating an export in the project asks (the role, the plan, the Enterprise
 * Edition - checkCallerMayCreate), before anything is read as OneUptime;
 * the instance's is a master admin's, and never names a project.
 *
 * Routes only, no router.use() (ee/Tests/Server/ModuleShape.test.ts).
 */

const router: ExpressRouter = Express.getRouter();

function readBody(body: unknown): JSONObject {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as JSONObject)
    : {};
}

function readOptionalObject(value: JSONValue | undefined): unknown {
  return value === null ? undefined : value;
}

// What a person reads when the test entry arrived, and where to look for it.
export function describeTestSuccess(data: {
  definition: AuditLogExportDestinationDefinition;
  receipt: AuditLogExportDeliveryReceipt;
}): string {
  if (data.definition.kind === AuditLogExportDestinationKind.Files) {
    return `A test file was written to ${data.receipt.location}. Real entries are written next to it, in folders by date.`;
  }

  return `A test entry was sent to ${data.receipt.location}. Its action is Test.`;
}

/*
 * The settings to test: a saved export read as the caller first (so another
 * project's export is never found), its stored settings with the unsaved
 * ones over them; or settings never saved. Validated as a save validates
 * them, egress policy included.
 */
async function readSettingsToTest(data: {
  body: JSONObject;
  props: DatabaseCommonInteractionProps;
  projectId: ObjectID | null;
}): Promise<{ settings: AuditLogExportSettings; isInstanceExport: boolean }> {
  const exportIdValue: JSONValue | undefined = data.body["exportId"];

  if (exportIdValue === undefined || exportIdValue === null) {
    return {
      settings: await AuditLogExportServiceClass.validateSettings({
        type: data.body["destinationType"],
        config: readConfig(data.body["config"]),
        secrets: readSecrets(data.body["secrets"]),
        isInstanceExport: !data.projectId,
      }),
      isInstanceExport: !data.projectId,
    };
  }

  const exportId: string = String(exportIdValue);

  if (!ObjectID.isValidUUID(exportId)) {
    throw new BadDataException("A valid export ID is required.");
  }

  const visible: AuditLogExport | null = await AuditLogExportService.findOneBy({
    query: data.projectId
      ? { _id: exportId, projectId: data.projectId }
      : { _id: exportId },
    select: { _id: true, projectId: true },
    props: data.props,
  });

  if (data.projectId) {
    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: visible?.projectId,
      projectId: data.projectId,
    });
  } else if (!visible || visible.projectId) {
    // The instance's route tests the instance's exports only.
    throw new BadDataException("The export no longer exists.");
  }

  const stored: AuditLogExport | null = await AuditLogExportService.findOneById(
    {
      id: new ObjectID(exportId),
      select: {
        _id: true,
        projectId: true,
        destinationType: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    },
  );

  if (!stored || !stored.destinationType) {
    throw new BadDataException("The export no longer exists.");
  }

  const config: JSONValue | undefined = readOptionalObject(
    data.body["config"],
  ) as JSONValue | undefined;

  return {
    settings: await AuditLogExportServiceClass.validateSettings({
      type: stored.destinationType,
      config:
        config !== undefined ? readConfig(config) : readConfig(stored.config),
      secrets: AuditLogExportServiceClass.mergeSecrets({
        type: stored.destinationType,
        stored: stored.secrets,
        provided: readOptionalObject(data.body["secrets"]),
      }),
      isInstanceExport: AuditLogExportServiceClass.isInstanceExport(stored),
    }),
    isInstanceExport: AuditLogExportServiceClass.isInstanceExport(stored),
  };
}

function readConfig(value: unknown): JSONObject {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  if (typeof value === "string") {
    try {
      return readConfig(JSON.parse(value));
    } catch {
      throw new BadDataException("Configuration must be a JSON object.");
    }
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException("Configuration must be a JSON object.");
  }

  return value as JSONObject;
}

function readSecrets(value: unknown): JSONObject {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new BadDataException("Credentials must be a JSON object.");
  }

  return value as JSONObject;
}

/*
 * What the two routes answer, without the request around it, so the suites
 * can ask it as any caller. A refusal of the caller throws (the route answers
 * it as an error); a test that ran answers { isSuccessful, message }.
 */
export class AuditLogExportTest {
  private static async run(data: {
    body: JSONObject;
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID | null;
  }): Promise<JSONObject> {
    const { settings, isInstanceExport } = await readSettingsToTest({
      body: data.body,
      props: data.props,
      projectId: data.projectId,
    });

    const definition: AuditLogExportDestinationDefinition =
      getAuditLogExportDestinationDefinition(settings.type)!;

    let receipt: AuditLogExportDeliveryReceipt;

    try {
      receipt = await AuditLogExporter.sendTest({
        settings,
        isInstanceExport,
        projectId: data.projectId,
      });
    } catch (error) {
      return {
        isSuccessful: false,
        message: ConnectorErrorMessage.toMessage(error),
      };
    }

    return {
      isSuccessful: true,
      message: describeTestSuccess({ definition, receipt }),
    };
  }

  /*
   * A project's test asks exactly what creating an export in the project
   * asks - Project Owner or Admin, the Enterprise plan on OneUptime Cloud,
   * the Enterprise Edition with audit logs when self-hosted - before it
   * reads anything as OneUptime.
   */
  public static async testProjectExport(data: {
    body: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    const projectId: ObjectID = CommonAPI.assertAuthenticatedProjectMember(
      data.props,
    );

    const probe: AuditLogExport = new AuditLogExport();
    probe.name = "Test";
    await AuditLogExportService.checkCallerMayCreate({
      data: probe,
      props: data.props,
    });

    return this.run({
      body: readBody(data.body),
      props: data.props,
      projectId,
    });
  }

  // The instance's, for a master admin (the route's middleware has said so).
  public static async testInstanceExport(data: {
    body: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<JSONObject> {
    // Enterprise configuration: only while the license includes audit logs.
    EnterpriseEdition.assertFeatureAvailableSync(EnterpriseFeature.AuditLogs);

    return this.run({
      body: readBody(data.body),
      props: { ...data.props, isMasterAdmin: true },
      projectId: null,
    });
  }
}

router.post(
  "/audit-log-export/test",
  UserMiddleware.getUserMiddleware,
  UserMiddleware.requireUserAuthentication,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      return Response.sendJsonObjectResponse(
        req,
        res,
        await AuditLogExportTest.testProjectExport({ body: req.body, props }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/audit-log-export/instance/test",
  MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
  UserMiddleware.getUserMiddleware,
  async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      return Response.sendJsonObjectResponse(
        req,
        res,
        await AuditLogExportTest.testInstanceExport({ body: req.body, props }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
