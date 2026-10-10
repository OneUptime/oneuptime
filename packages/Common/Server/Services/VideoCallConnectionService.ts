import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/VideoCallConnection";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import VideoCallAuthMethod, {
  isVideoCallOAuth,
} from "../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallMeeting from "../../Types/VideoCall/VideoCallMeeting";
import VideoCallProvider, {
  getVideoCallProviderDisplayName,
} from "../../Types/VideoCall/VideoCallProvider";
import { VideoCallProviderDefinition } from "../../Types/VideoCall/VideoCallProviderCatalog";
import VideoCallConnectionSettingsUtil, {
  VideoCallConnectionSettings,
} from "../Utils/VideoCall/VideoCallConnectionSettings";
import VideoCallMeetingFactory from "../Utils/VideoCall/VideoCallMeetingFactory";
import { VideoCallMeetingRequest } from "../Utils/VideoCall/VideoCallMeetingRequest";
import VideoCallHttpClient from "../Utils/VideoCall/VideoCallHttpClient";
import VideoCallOAuthUtil, {
  VideoCallOAuthApp,
  VideoCallOAuthGrant,
  VideoCallOAuthSecrets,
} from "../Utils/VideoCall/OAuth/VideoCallOAuth";
import VideoCallOAuthApps from "../Utils/VideoCall/OAuth/VideoCallOAuthApps";
import VideoCallOAuthTokenStore from "../Utils/VideoCall/OAuth/VideoCallOAuthTokenStore";
import logger, { LogAttributes } from "../Utils/Logger";
import { redactLogString } from "../Utils/LogRedaction";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

// A last error long enough to act on, short enough for a table cell.
const MAX_LAST_ERROR_LENGTH: number = 1000;

// A sign-in a deleted connection held, for withdrawing it once nothing else uses it.
interface DeletedSignIn {
  provider: VideoCallProvider;
  accountId: string;
  secrets: VideoCallOAuthSecrets;
}

/*
 * Validation happens at save time, so a connection that saves is one a call
 * can be started with: a wrong key, a missing secret or a malformed id
 * reaches the person configuring it, not a responder in the middle of an
 * incident. Secrets are stored encrypted and never returned; an update
 * merges what it sends over what is stored (VideoCallConnectionSettings).
 *
 * A connection made by signing in (authMethod OAuth) is created only by the
 * sign-in itself (connectWithSignIn, from VideoCallOAuthAPI), never through
 * the API, and its secrets - the sign-in's tokens - are written only by the
 * sign-in and VideoCallOAuthTokenStore. An edit changes its name and the
 * settings a sign-in leaves to pick, and nothing else.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const config: JSONObject = VideoCallConnectionSettingsUtil.parseJsonObject(
      createBy.data.config,
      "Configuration",
    );
    const secrets: JSONObject = VideoCallConnectionSettingsUtil.parseJsonObject(
      createBy.data.secrets,
      "Credentials",
    );

    const authMethod: unknown = createBy.data.authMethod;

    if (isVideoCallOAuth(authMethod)) {
      /*
       * Only the sign-in makes one: its tokens are what the provider
       * answered, and nobody can type those in.
       */
      if (!createBy.props.isRoot) {
        throw new BadDataException(
          `A connection made by signing in is created by signing in: use Connect on ${getVideoCallProviderDisplayName(createBy.data.provider)} in Project Settings > Video Calls.`,
        );
      }

      const settings: VideoCallConnectionSettings =
        VideoCallConnectionSettingsUtil.validateOAuth({
          provider: createBy.data.provider,
          config,
        });

      if (!VideoCallOAuthUtil.readSecrets(secrets)) {
        throw new BadDataException(
          "A connection made by signing in needs the sign-in's tokens.",
        );
      }

      createBy.data.provider = settings.provider;
      createBy.data.config = settings.config;
      createBy.data.secrets = JSON.stringify(secrets);
      createBy.data.authMethod = VideoCallAuthMethod.OAuth;

      return { createBy, carryForward: null };
    }

    if (
      authMethod !== undefined &&
      authMethod !== null &&
      authMethod !== VideoCallAuthMethod.AppCredentials
    ) {
      throw new BadDataException(
        `Auth method must be ${VideoCallAuthMethod.AppCredentials}. A connection made by signing in is created by signing in.`,
      );
    }

    const settings: VideoCallConnectionSettings =
      VideoCallConnectionSettingsUtil.validate({
        provider: createBy.data.provider,
        config,
        secrets,
        requireRequiredSecrets: true,
      });

    createBy.data.provider = settings.provider;
    createBy.data.config = settings.config;
    createBy.data.secrets = JSON.stringify(settings.secrets);
    // A meeting link signs in to nothing.
    createBy.data.authMethod =
      settings.provider === VideoCallProvider.CustomLink
        ? (null as unknown as VideoCallAuthMethod)
        : VideoCallAuthMethod.AppCredentials;

    return { createBy, carryForward: null };
  }

  /*
   * The provider of a connection is fixed: its config and secrets mean
   * nothing to another provider. Provided secrets are merged over the stored
   * ones (a value replaces, "" or undefined keeps, null removes), and the
   * merged settings are validated and re-encrypted.
   */
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    /*
     * Read through a plain JSON view: the typed partial of a model with JSON
     * columns is recursive enough that TypeScript gives up instantiating it,
     * and the values are validated by hand anyway.
     */
    const incoming: JSONObject = updateBy.data as unknown as JSONObject;

    if (incoming["provider"] !== undefined) {
      throw new BadDataException(
        "The provider of a video call connection cannot be changed. Create a new connection instead.",
      );
    }

    const touchesSettings: boolean =
      incoming["config"] !== undefined || incoming["secrets"] !== undefined;

    if (!touchesSettings) {
      return { updateBy, carryForward: null };
    }

    // The one connection an update names by its id.
    const connectionId: string | undefined = Service.getOneRowIdNamedBy(
      updateBy.query,
    )?.toString();

    if (!connectionId || !ObjectID.isValidUUID(connectionId)) {
      throw new BadDataException(
        "Configuration and credentials can only be updated one connection at a time.",
      );
    }

    const current: Model | null = await this.findOneById({
      id: new ObjectID(connectionId),
      select: {
        _id: true,
        provider: true,
        authMethod: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider) {
      throw new BadDataException("The video call connection no longer exists.");
    }

    if (isVideoCallOAuth(current.authMethod)) {
      /*
       * Its secrets are the sign-in's, written only by the sign-in and the
       * token store. Writing them back from here could put back a refresh
       * token Zoom has already retired, so this update leaves them alone.
       */
      if (incoming["secrets"] !== undefined) {
        const title: string = getVideoCallProviderDisplayName(current.provider);

        throw new BadDataException(
          `The credentials of a connection made by signing in are kept by OneUptime. To sign in again, reconnect ${title} in Project Settings > Video Calls.`,
        );
      }

      incoming["config"] = VideoCallConnectionSettingsUtil.validateOAuth({
        provider: current.provider,
        config: VideoCallConnectionSettingsUtil.parseJsonObject(
          incoming["config"],
          "Configuration",
        ),
      }).config;

      return { updateBy, carryForward: null };
    }

    const config: JSONObject =
      incoming["config"] !== undefined
        ? VideoCallConnectionSettingsUtil.parseJsonObject(
            incoming["config"],
            "Configuration",
          )
        : VideoCallConnectionSettingsUtil.parseJsonObject(
            current.config,
            "Configuration",
          );

    const mergedSecrets: JSONObject =
      VideoCallConnectionSettingsUtil.mergeSecrets({
        definition: VideoCallConnectionSettingsUtil.getDefinitionOrThrow(
          current.provider,
        ),
        stored: VideoCallConnectionSettingsUtil.parseJsonObject(
          current.secrets,
          "Credentials",
        ),
        provided:
          incoming["secrets"] !== undefined
            ? VideoCallConnectionSettingsUtil.parseJsonObject(
                incoming["secrets"],
                "Credentials",
              )
            : {},
      });

    const settings: VideoCallConnectionSettings =
      VideoCallConnectionSettingsUtil.validate({
        provider: current.provider,
        config,
        secrets: mergedSecrets,
        requireRequiredSecrets: true,
      });

    incoming["config"] = settings.config;
    incoming["secrets"] = JSON.stringify(settings.secrets);

    return { updateBy, carryForward: null };
  }

  /*
   * The decrypted settings of a stored connection, read as root. They are
   * credentials: never serialize the result into a response or a log.
   */
  @CaptureSpan()
  public async getSettings(data: {
    connectionId: ObjectID;
    projectId: ObjectID;
  }): Promise<{
    connection: Model;
    settings: VideoCallConnectionSettings;
  }> {
    const connection: Model | null = await this.findOneBy({
      query: {
        _id: data.connectionId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        provider: true,
        authMethod: true,
        connectedAccount: true,
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!connection || !connection.provider) {
      throw new BadDataException(
        "The video call connection no longer exists. Pick another one, or connect a provider again in Project Settings > Video Calls.",
      );
    }

    return {
      connection,
      settings: {
        provider: VideoCallConnectionSettingsUtil.getDefinitionOrThrow(
          connection.provider,
        ).provider,
        config: VideoCallConnectionSettingsUtil.parseJsonObject(
          connection.config,
          "Configuration",
        ),
        secrets: VideoCallConnectionSettingsUtil.parseJsonObject(
          connection.secrets,
          "Credentials",
        ),
        authMethod: isVideoCallOAuth(connection.authMethod)
          ? VideoCallAuthMethod.OAuth
          : undefined,
      },
    };
  }

  /*
   * How a meeting is created with a stored connection's sign-in: the token
   * store, for a connection made by signing in. Undefined for any other.
   */
  public getOAuthAccess(data: {
    connection: Model;
    http?: VideoCallHttpClient | undefined;
  }): ReturnType<typeof VideoCallOAuthTokenStore.getAccess> | undefined {
    if (
      !isVideoCallOAuth(data.connection.authMethod) ||
      !data.connection.id ||
      !data.connection.provider
    ) {
      return undefined;
    }

    return VideoCallOAuthTokenStore.getAccess({
      connectionId: data.connection.id,
      provider: data.connection.provider,
      accountLabel: data.connection.connectedAccount || "",
      http: data.http,
    });
  }

  /*
   * Starts one call with a stored connection and records how it went on the
   * connection: when it last started a call, or why it could not. The
   * failure is rethrown for the caller to report where it was asked for.
   */
  @CaptureSpan()
  public async startMeeting(data: {
    connectionId: ObjectID;
    projectId: ObjectID;
    request: VideoCallMeetingRequest;
    http?: VideoCallHttpClient | undefined;
  }): Promise<{ meeting: VideoCallMeeting; connection: Model }> {
    const { connection, settings } = await this.getSettings({
      connectionId: data.connectionId,
      projectId: data.projectId,
    });

    try {
      const meeting: VideoCallMeeting =
        await VideoCallMeetingFactory.createMeeting({
          settings,
          request: data.request,
          http: data.http,
          oauth: this.getOAuthAccess({ connection, http: data.http }),
        });

      await this.recordOutcome({
        connectionId: data.connectionId,
        error: null,
      });

      return { meeting, connection };
    } catch (error) {
      await this.recordOutcome({
        connectionId: data.connectionId,
        error: Service.getErrorMessage(error),
      });

      throw error;
    }
  }

  public static getErrorMessage(error: unknown): string {
    const message: string =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "The call could not be started.";

    const redacted: string = redactLogString(message || "");

    return redacted.length > MAX_LAST_ERROR_LENGTH
      ? `${redacted.substring(0, MAX_LAST_ERROR_LENGTH - 1)}…`
      : redacted;
  }

  /*
   * A sign-in that could not be refreshed, recorded on every connection that
   * shares it, so the Video Calls page says so the day it happens. Never
   * throws.
   */
  @CaptureSpan()
  public async recordSignInProblem(data: {
    provider: VideoCallProvider;
    accountId?: string | undefined;
    connectionId: ObjectID;
    error: unknown;
  }): Promise<void> {
    try {
      const update: { lastError: string; lastErrorAt: Date } = {
        lastError: Service.getErrorMessage(data.error),
        lastErrorAt: new Date(),
      };

      if (data.accountId) {
        await this.updateBy({
          query: {
            provider: data.provider,
            authMethod: VideoCallAuthMethod.OAuth,
            connectedAccountId: data.accountId,
          },
          data: update,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true, ignoreHooks: true },
        });
      } else {
        await this.updateOneById({
          id: data.connectionId,
          data: update,
          props: { isRoot: true, ignoreHooks: true },
        });
      }
    } catch (err) {
      logger.error(
        `Could not record a video call connection's sign-in problem: ${err}`,
        {
          videoCallConnectionId: data.connectionId.toString(),
        } as LogAttributes,
      );
    }
  }

  /*
   * Saves what a sign-in came back with: on the connection being
   * reconnected, on this project's connection already signed in as the
   * account, or on a new one - and on every connection signed in as the same
   * account anywhere, since the account has one sign-in
   * (VideoCallOAuthTokenStore). Returns the project's connection.
   */
  @CaptureSpan()
  public async connectWithSignIn(data: {
    projectId: ObjectID;
    userId: ObjectID;
    provider: VideoCallProvider;
    grant: VideoCallOAuthGrant;
    // Reconnect: the connection to sign in again.
    connectionId?: ObjectID | undefined;
  }): Promise<Model> {
    const definition: VideoCallProviderDefinition =
      VideoCallConnectionSettingsUtil.getDefinitionOrThrow(data.provider);
    const accountId: string = data.grant.account.externalUserId;
    const accountLabel: string = Service.truncate(
      data.grant.account.label,
      ColumnLength.ShortText,
    );
    const secrets: string = JSON.stringify(
      VideoCallOAuthUtil.toSecrets({
        tokens: data.grant.tokens,
        account: data.grant.account,
      }),
    );
    const logAttributes: LogAttributes = {
      projectId: data.projectId.toString(),
    } as LogAttributes;

    const mutex: SemaphoreMutex | null =
      await VideoCallOAuthTokenStore.takeLock({
        signInKey: VideoCallOAuthTokenStore.getSignInKey({
          provider: data.provider,
          accountId,
          connectionId: data.connectionId || data.projectId,
        }),
        logAttributes,
      });

    try {
      let connection: Model | null = null;

      if (data.connectionId) {
        connection = await this.findOneBy({
          query: { _id: data.connectionId, projectId: data.projectId },
          select: { _id: true, name: true, provider: true, authMethod: true },
          props: { isRoot: true },
        });

        if (
          !connection ||
          connection.provider !== data.provider ||
          !isVideoCallOAuth(connection.authMethod)
        ) {
          throw new BadDataException(
            `The ${definition.title} connection to reconnect no longer exists.`,
          );
        }
      } else {
        connection = await this.findOneBy({
          query: {
            projectId: data.projectId,
            provider: data.provider,
            authMethod: VideoCallAuthMethod.OAuth,
            connectedAccountId: accountId,
          },
          select: { _id: true, name: true, provider: true, authMethod: true },
          props: { isRoot: true },
        });
      }

      if (connection?.id) {
        await this.updateOneById({
          id: connection.id,
          data: {
            secrets,
            connectedAccount: accountLabel,
            connectedAccountId: accountId,
            lastError: null as unknown as string,
            lastErrorAt: null as unknown as Date,
          },
          props: { isRoot: true, ignoreHooks: true },
        });
      } else {
        const model: Model = new Model();
        model.projectId = data.projectId;
        model.name = await this.getUnusedName({
          projectId: data.projectId,
          name: definition.title,
        });
        model.provider = data.provider;
        model.authMethod = VideoCallAuthMethod.OAuth;
        model.config = {};
        model.secrets = secrets;
        model.connectedAccount = accountLabel;
        model.connectedAccountId = accountId;
        model.createdByUserId = data.userId;

        connection = await this.create({
          data: model,
          props: { isRoot: true },
        });
      }

      // The account's other connections, in any project: its sign-in is this one now.
      await this.updateBy({
        query: {
          provider: data.provider,
          authMethod: VideoCallAuthMethod.OAuth,
          connectedAccountId: accountId,
        },
        data: {
          secrets,
          connectedAccount: accountLabel,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true, ignoreHooks: true },
      });

      return connection;
    } finally {
      await VideoCallOAuthTokenStore.giveBack(mutex, logAttributes);
    }
  }

  /*
   * What someone removing OneUptime from their account at the provider
   * leaves behind (Zoom's app_deauthorized): nothing of theirs. Every
   * connection signed in as the account loses its sign-in and who it was,
   * and says how to connect again. Returns how many.
   */
  @CaptureSpan()
  public async removeSignIn(data: {
    provider: VideoCallProvider;
    accountId: string;
    reason: string;
  }): Promise<number> {
    if (!data.accountId) {
      return 0;
    }

    return await this.updateBy({
      query: {
        provider: data.provider,
        authMethod: VideoCallAuthMethod.OAuth,
        connectedAccountId: data.accountId,
      },
      data: {
        secrets: JSON.stringify({}),
        connectedAccount: null as unknown as string,
        connectedAccountId: null as unknown as string,
        lastError: data.reason,
        lastErrorAt: new Date(),
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  /*
   * The sign-ins the deleted connections held, for onDeleteSuccess to
   * withdraw at the provider once nothing else uses them.
   */
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const onDelete: OnDelete<Model> = await super.onBeforeDelete(deleteBy);
    const signIns: Array<DeletedSignIn> = [];

    try {
      const connections: Array<Model> = await this.findBy({
        query: {
          ...deleteBy.query,
          authMethod: VideoCallAuthMethod.OAuth,
        },
        select: {
          _id: true,
          provider: true,
          secrets: true,
          connectedAccountId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const connection of connections) {
        const secrets: VideoCallOAuthSecrets | null =
          VideoCallOAuthUtil.readSecrets(
            VideoCallConnectionSettingsUtil.parseJsonObject(
              connection.secrets,
              "Credentials",
            ),
          );

        if (connection.provider && connection.connectedAccountId && secrets) {
          signIns.push({
            provider: connection.provider,
            accountId: connection.connectedAccountId,
            secrets,
          });
        }
      }
    } catch (err) {
      logger.error(
        `Could not read the sign-ins of video call connections being deleted: ${err}`,
      );
    }

    return {
      deleteBy: onDelete.deleteBy,
      carryForward: { ...(onDelete.carryForward || {}), signIns },
    };
  }

  /*
   * Withdraws each deleted connection's sign-in at the provider, unless
   * another connection still uses it. Best effort, never throws: the
   * connection is gone either way, and the person can remove OneUptime from
   * their account themselves.
   */
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const result: OnDelete<Model> = await super.onDeleteSuccess(
      onDelete,
      itemIdsBeforeDelete,
    );
    const signIns: Array<DeletedSignIn> =
      (onDelete.carryForward as { signIns?: Array<DeletedSignIn> } | null)
        ?.signIns || [];
    const withdrawn: Set<string> = new Set();

    for (const signIn of signIns) {
      const key: string = `${signIn.provider}-${signIn.accountId}`;

      if (withdrawn.has(key)) {
        continue;
      }

      withdrawn.add(key);

      try {
        const stillUsed: number = (
          await this.countBy({
            query: {
              provider: signIn.provider,
              authMethod: VideoCallAuthMethod.OAuth,
              connectedAccountId: signIn.accountId,
            },
            props: { isRoot: true },
          })
        ).toNumber();

        if (stillUsed > 0) {
          continue;
        }

        const app: VideoCallOAuthApp | null = VideoCallOAuthApps.get(
          signIn.provider,
        );

        await app?.revoke(signIn.secrets);
      } catch (err) {
        logger.warn(
          `Could not withdraw the sign-in of a deleted video call connection: ${Service.getErrorMessage(err)}`,
        );
      }
    }

    return result;
  }

  // The provider's name, or "<name> 2", "<name> 3": one no connection in the project has.
  private async getUnusedName(data: {
    projectId: ObjectID;
    name: string;
  }): Promise<string> {
    const connections: Array<Model> = await this.findBy({
      query: { projectId: data.projectId },
      select: { _id: true, name: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const taken: Set<string> = new Set(
      connections.map((connection: Model): string => {
        return (connection.name || "").trim().toLowerCase();
      }),
    );

    if (!taken.has(data.name.toLowerCase())) {
      return data.name;
    }

    for (let count: number = 2; count < 1000; count++) {
      const candidate: string = `${data.name} ${count}`;

      if (!taken.has(candidate.toLowerCase())) {
        return candidate;
      }
    }

    return data.name;
  }

  private static truncate(value: string, maxLength: number): string {
    const trimmed: string = (value || "").trim();

    return trimmed.length > maxLength
      ? `${trimmed.substring(0, maxLength - 1)}…`
      : trimmed;
  }

  /*
   * Never throws: how a call went is bookkeeping, and must not turn a call
   * that started into one that failed.
   */
  private async recordOutcome(data: {
    connectionId: ObjectID;
    error: string | null;
  }): Promise<void> {
    try {
      await this.updateOneById({
        id: data.connectionId,
        data: data.error
          ? {
              lastError: data.error,
              lastErrorAt: new Date(),
            }
          : {
              lastCallStartedAt: new Date(),
              lastError: null as unknown as string,
              lastErrorAt: null as unknown as Date,
            },
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (err) {
      logger.error(
        `Could not record the outcome of a video call on its connection: ${err}`,
        {
          videoCallConnectionId: data.connectionId.toString(),
        } as LogAttributes,
      );
    }
  }
}

export default new Service();
