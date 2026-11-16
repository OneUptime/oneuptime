import ApiKeyService, { ResolvedApiKey } from "../Services/ApiKeyService";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectService from "../Services/ProjectService";
import UserService from "../Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ProjectBlockedException from "../../Types/Exception/ProjectBlockedException";
import ObjectID from "../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../Types/Permission";
import UserType from "../../Types/UserType";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import User from "../../Models/DatabaseModels/User";
import APIKeyAccessPermission from "../Utils/APIKey/AccessPermission";
import MasterApiKey from "../Utils/MasterApiKey";
import PlanCutoffCredentialAccess from "../Utils/Billing/PlanCutoffCredentialAccess";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import { PlanCutoffCredential } from "../../Types/Billing/PlanCutoffCredentials";
import PaymentRequiredException from "../../Types/Exception/PaymentRequiredException";

export default class ProjectMiddleware {
  /*
   * What the audit trail calls the instance-wide master API key. It has no
   * row in ApiKey - it is a column on GlobalConfig - so there is no id or
   * name to record, and without a label a change made with it reads as the
   * master admin user having made it by hand.
   */
  public static readonly MASTER_API_KEY_AUDIT_NAME: string = "Master API Key";

  @CaptureSpan()
  public static getProjectId(req: ExpressRequest): ObjectID | null {
    let projectId: ObjectID | null = null;
    if (req.params && req.params["projectId"]) {
      projectId = new ObjectID(req.params["projectId"]);
    } else if (req.params && req.params["tenantid"]) {
      projectId = new ObjectID(req.params["tenantid"]);
    } else if (req.query && req.query["tenantid"]) {
      projectId = new ObjectID(req.query["tenantid"] as string);
    } else if (req.headers && req.headers["tenantid"]) {
      // Header keys are automatically transformed to lowercase
      projectId = new ObjectID(req.headers["tenantid"] as string);
    } else if (req.headers && req.headers["projectid"]) {
      // Header keys are automatically transformed to lowercase
      projectId = new ObjectID(req.headers["projectid"] as string);
    } else if (req.body && req.body.projectId) {
      projectId = new ObjectID(req.body.projectId as string);
    }

    return projectId;
  }

  /*
   * The `apikey` header exactly as it arrived, or null when it was never
   * sent at all. Node lower-cases header names, and a caller that sends the
   * header twice arrives here as one comma-joined string — never a usable
   * key, but unmistakably a caller who meant to authenticate by key.
   *
   * An empty or whitespace-only value is a header that WAS sent. Keeping that
   * distinct from "absent" is the whole point of this helper; see hasApiKey.
   */
  private static getRawApiKeyHeader(req: ExpressRequest): string | null {
    const rawHeader: string | Array<string> | undefined =
      req.headers?.["apikey"];

    if (rawHeader === undefined) {
      return null;
    }

    return Array.isArray(rawHeader) ? rawHeader.join(",") : rawHeader;
  }

  @CaptureSpan()
  public static getApiKey(req: ExpressRequest): ObjectID | null {
    const rawHeader: string | null = ProjectMiddleware.getRawApiKeyHeader(req);

    if (rawHeader === null) {
      return null;
    }

    const apiKey: string = rawHeader.trim();

    /*
     * Every API key is a uuid (Utils/APIKey/HashedApiKey), so a value that
     * is not one is no key: rejected here, with `Invalid API Key`, before
     * anything is hashed or read for it. `ApiKey.apiKey` was a Postgres
     * `uuid` column, where a non-UUID value made the lookup raise "invalid
     * input syntax for type uuid" and answer 500; it holds the key's hash
     * now (#8902), and the shape is still the one a key has.
     */
    if (!ObjectID.isValidUUID(apiKey)) {
      return null;
    }

    return new ObjectID(apiKey);
  }

  /*
   * Presence, not usability — deliberately NOT `Boolean(this.getApiKey(req))`.
   *
   * A request carrying an empty or malformed `ApiKey` header is a caller
   * trying to authenticate by key and getting it wrong. Answering false here
   * routed it down the anonymous path, where it failed much later with
   * "A user should be logged in to <op> record of <Model>." — an error about
   * session auth, raised against a caller who never attempted session auth,
   * naming a model as though the model were what went wrong. It reads as an
   * RBAC bug in whichever resource happened to be asked for, and has been
   * reported as one more than once (issues #1754, #3004). An unset shell
   * variable, a client that sends the header blank, and our own CLI's
   * partial-credential path all land here.
   *
   * Claim the request instead, so it fails as `Invalid API Key`.
   */
  @CaptureSpan()
  public static hasApiKey(req: ExpressRequest): boolean {
    return ProjectMiddleware.getRawApiKeyHeader(req) !== null;
  }

  @CaptureSpan()
  public static hasProjectID(req: ExpressRequest): boolean {
    return Boolean(this.getProjectId(req));
  }

  /*
   * Whether the given key is the instance-wide master API key
   * (Admin Dashboard → Settings → API Key) and that key is currently enabled.
   * The master key has root/master-admin access, so this is shared with
   * MasterAdminAuthorization to let the key reach master-admin-only endpoints
   * (e.g. OneUptime Health) as well.
   *
   * The key is stored hashed (#7901), so the server's settings row is read
   * by its id, and the key presented is compared with what it holds by
   * MasterApiKey.matches: its hash against the hash stored, in constant
   * time - or, for a key stored before keys were hashed and not hashed yet
   * by the HashMasterApiKey data migration, the key against the key. The
   * key never goes into a query, so no query log can hold it.
   */
  @CaptureSpan()
  public static async isMasterApiKey(apiKey: ObjectID): Promise<boolean> {
    /*
     * A value that is not a uuid is never the master key - no key ever was
     * one - so callers can safely fall through to other auth, and nothing is
     * read for it.
     */
    if (!MasterApiKey.normalize(apiKey)) {
      return false;
    }

    const globalConfig: GlobalConfig | null =
      await GlobalConfigService.findOneBy({
        query: {
          _id: ObjectID.getZeroObjectID().toString(),
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isMasterApiKeyEnabled: true,
          masterApiKey: true,
        },
      });

    if (!globalConfig || globalConfig.isMasterApiKeyEnabled !== true) {
      return false;
    }

    return MasterApiKey.matches({
      presentedKey: apiKey,
      storedValue: globalConfig.masterApiKey?.toString(),
    });
  }

  @CaptureSpan()
  public static async isValidProjectIdAndApiKeyMiddleware(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let tenantId: ObjectID | null = this.getProjectId(req);

      const apiKey: ObjectID | null = this.getApiKey(req);

      if (tenantId) {
        (req as OneUptimeRequest).tenantId = tenantId;

        // Tag the current span with project context for observability
        SpanUtil.addAttributesToCurrentSpan({
          projectId: tenantId.toString(),
        });
      }

      if (!apiKey) {
        /*
         * Separate "no header at all" from "header sent, but unusable".
         * getUserMiddleware only routes here once the header is present, so
         * in practice it is always the second: an empty value from an unset
         * variable, a non-UUID string, or duplicate headers that Node joined
         * into a comma-separated list.
         */
        if (ProjectMiddleware.hasApiKey(req)) {
          throw new BadDataException("Invalid API Key");
        }

        throw new BadDataException(
          "API Key not found in the request header. Please provide a valid API Key in the request header.",
        );
      }

      /*
       * Cached lookup — see ApiKeyService.findApiKey. Hot path for any
       * automated caller hitting the API by key.
       */
      const apiKeyRow: ResolvedApiKey | null =
        await ApiKeyService.findApiKey(apiKey);

      if (apiKeyRow) {
        /*
         * A blocked project's keys are refused, whatever they may do and
         * whatever the project's plan: a master admin blocked the project
         * (Admin Dashboard > Projects), and until it is unblocked nothing
         * but a master admin acts in it. Asked first, at the one door every
         * API-key request goes through - the CLI, Terraform and the MCP
         * server's API-key mode included. Cached per server
         * (ProjectService.isProjectBlocked); a lookup that fails is an
         * error, not a pass.
         */
        if (await ProjectService.isProjectBlocked(apiKeyRow.projectId)) {
          throw new ProjectBlockedException();
        }

        /*
         * A project's API keys work only while it is on the plan that sells
         * them (Types/Billing/PlanCutoffCredentials). Below it - after a
         * downgrade - the key is refused here, with a 402 that names the
         * plan, before anything is read with it: this is the one door every
         * API-key request goes through, so every route behind it, and
         * everything built on the API (Terraform, the CLI, the MCP server's
         * API-key mode), is covered at once. The key itself is untouched
         * and works again as soon as the project is back on the plan.
         * Billing off: no plans, nothing to refuse.
         */
        const planRefusal: PaymentRequiredException | null =
          await PlanCutoffCredentialAccess.getRefusal({
            projectId: apiKeyRow.projectId,
            credential: PlanCutoffCredential.ApiKey,
          });

        if (planRefusal) {
          throw planRefusal;
        }

        tenantId = apiKeyRow.projectId;

        (req as OneUptimeRequest).tenantId = tenantId;
        (req as OneUptimeRequest).userType = UserType.API;

        /*
         * Which key this is, for the audit trail. A key request carries no
         * userId, so these two are the only thing that lets an audit entry
         * tell one key's changes from another's. Nothing below reads them.
         */
        (req as OneUptimeRequest).apiKeyId = apiKeyRow.id;

        if (apiKeyRow.name) {
          (req as OneUptimeRequest).apiKeyName = apiKeyRow.name;
        }

        /*
         * The two halves of an API key's authority. The global half is the
         * fixed marker set every key carries (see APIKeyAccessPermission); the
         * per-key grants an administrator actually configured are read from
         * ApiKeyPermission just below. That second half is what the long-lived
         * "TODO: Add API key permissions" here was asking for, and it is done -
         * the TODO outlived the work.
         */
        (req as OneUptimeRequest).userGlobalAccessPermission =
          await APIKeyAccessPermission.getDefaultApiGlobalPermission(tenantId);

        const userTenantAccessPermission: UserTenantAccessPermission | null =
          await APIKeyAccessPermission.getApiTenantAccessPermission(
            tenantId,
            apiKeyRow.id,
          );

        if (userTenantAccessPermission) {
          (req as OneUptimeRequest).userTenantAccessPermission = {};
          (
            (req as OneUptimeRequest)
              .userTenantAccessPermission as Dictionary<UserTenantAccessPermission>
          )[tenantId.toString()] = userTenantAccessPermission;

          return next();
        }
      }

      if (!apiKeyRow) {
        // check master key.
        const isMasterApiKey: boolean =
          await ProjectMiddleware.isMasterApiKey(apiKey);

        if (isMasterApiKey) {
          (req as OneUptimeRequest).userType = UserType.MasterAdmin;
          (req as OneUptimeRequest).apiKeyName =
            ProjectMiddleware.MASTER_API_KEY_AUDIT_NAME;

          // get master admin user

          const user: User | null = await UserService.findOneBy({
            query: {
              isMasterAdmin: true,
            },
            select: {
              _id: true,
              email: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException(
              "Master Admin user not found. Please make sure you have created a master admin user.",
            );
          }

          (req as OneUptimeRequest).userAuthorization = {
            userId: user.id!,
            isMasterAdmin: true,
            email: user.email!,
            name: user.name!,
            isGlobalLogin: true,
          };

          return next();
        }
      }

      if (apiKey) {
        // If we have an API key but no tenant ID, we throw an error.
        throw new BadDataException("Invalid API Key");
      }

      if (!tenantId) {
        throw new BadDataException(
          "ProjectID not found in the request header.",
        );
      }

      throw new BadDataException("Invalid Project ID or API Key");
    } catch (err) {
      /*
       * Record on THIS middleware's own @CaptureSpan span before handing the
       * error to Express. The decorator sees a normal return (we call
       * next(err) rather than rethrowing — Express 4 does not catch a
       * rejection from an async middleware), so its recorder never runs and
       * without this the error is invisible on the span it actually belongs
       * to. Goes through SpanUtil so the event is typed by class name rather
       * than by HTTP status, and so a rejected credential produces a `fault`
       * event instead of an Issue.
       */
      SpanUtil.recordExceptionOnCurrentSpan(err);
      next(err);
    }
  }
}
