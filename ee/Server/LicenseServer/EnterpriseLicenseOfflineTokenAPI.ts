import EnterpriseLicense from "Common/Models/DatabaseModels/EnterpriseLicense";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import EnterpriseLicenseService from "Common/Server/Services/EnterpriseLicenseService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import EnterpriseLicenseAPI from "./EnterpriseLicenseAPI";
import LicenseSigner, { LicenseSigningState } from "./LicenseSigner";

/*
 * POST /enterprise-license/:enterpriseLicenseId/offline-token {instanceId}
 *
 * For an Enterprise installation that cannot reach oneuptime.com: a master
 * admin of OneUptime Cloud downloads a signed (EdDSA) license token bound to
 * that installation's instance id, and the customer pastes it into their
 * Admin Dashboard. The installation verifies it offline against the keys its
 * release trusts, and rejects it on any other instance.
 *
 * Master admins only, OneUptime Cloud only (the LicenseServer area mounts this
 * router only when billing is enabled, and the handler checks again). Answers
 * 400 with a clear reason when EdDSA signing is not configured - the legacy
 * token cannot be verified offline, so there is nothing useful to hand out.
 *
 * A plain router: routes only, no router.use() layers (see EnterpriseArea).
 */

export const OFFLINE_LICENSE_TOKEN_ROUTE: string =
  "/enterprise-license/:enterpriseLicenseId/offline-token";

// OneUptime instance ids are UUIDs (GlobalConfig.instanceId, an ObjectID).
const INSTANCE_ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface OfflineLicenseTokenResponse {
  token: string;
  kid: string;
  licenseId: string;
  instanceId: string;
  expiresAt: string;
}

export default class EnterpriseLicenseOfflineTokenAPI {
  public router: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();

    this.router.post(
      OFFLINE_LICENSE_TOKEN_ROUTE,
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const body: OfflineLicenseTokenResponse =
            await EnterpriseLicenseOfflineTokenAPI.issueToken({
              licenseId: req.params["enterpriseLicenseId"],
              instanceId: (req.body as Record<string, unknown> | undefined)?.[
                "instanceId"
              ],
            });

          return Response.sendJsonObjectResponse(req, res, {
            token: body.token,
            kid: body.kid,
            licenseId: body.licenseId,
            instanceId: body.instanceId,
            expiresAt: body.expiresAt,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  /*
   * The instance id as the installation stores it (lower-case UUID), or a
   * 400. The token's instanceId claim is compared with the installation's own
   * id byte for byte, so it is normalised here rather than trusted as typed.
   */
  public static parseInstanceId(value: unknown): string {
    const instanceId: string =
      typeof value === "string" ? value.trim().toLowerCase() : "";

    if (!INSTANCE_ID_PATTERN.test(instanceId)) {
      throw new BadDataException(
        "instanceId must be the instance ID (a UUID) of the OneUptime installation the offline license token is for.",
      );
    }

    return instanceId;
  }

  public static async issueToken(data: {
    licenseId: unknown;
    instanceId: unknown;
  }): Promise<OfflineLicenseTokenResponse> {
    if (!IsBillingEnabled) {
      throw new BadDataException(
        "Offline license tokens are issued only by OneUptime Cloud.",
      );
    }

    const instanceId: string = EnterpriseLicenseOfflineTokenAPI.parseInstanceId(
      data.instanceId,
    );

    const signingState: LicenseSigningState = LicenseSigner.getState();

    if (!LicenseSigner.isEdDsaEnabled() || !signingState.kid) {
      throw new BadDataException(LicenseSigner.getOfflineUnavailableMessage());
    }

    const rawLicenseId: string =
      typeof data.licenseId === "string" ? data.licenseId.trim() : "";

    if (!ObjectID.isValidUUID(rawLicenseId)) {
      throw new BadDataException("Enterprise license not found");
    }

    const licenseId: ObjectID = new ObjectID(rawLicenseId);

    const license: EnterpriseLicense | null =
      await EnterpriseLicenseService.findOneById({
        id: licenseId,
        select: {
          _id: true,
          companyName: true,
          licenseKey: true,
          expiresAt: true,
          userLimit: true,
          isEvaluationLicense: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!license) {
      throw new BadDataException("Enterprise license not found");
    }

    const token: string = LicenseSigner.signOfflineToken({
      subject: EnterpriseLicenseAPI.getTokenSubject(license),
      instanceId,
    });

    // Never the token itself: it is a portable license.
    logger.info(
      `Enterprise license server: issued an offline license token for license ${licenseId.toString()} bound to instance ${instanceId}.`,
    );

    return {
      token,
      kid: signingState.kid,
      licenseId: licenseId.toString(),
      instanceId,
      expiresAt: (license.expiresAt as Date).toISOString(),
    };
  }
}
