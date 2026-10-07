import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/VideoCallConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import VideoCallMeeting from "../../Types/VideoCall/VideoCallMeeting";
import VideoCallConnectionSettingsUtil, {
  VideoCallConnectionSettings,
} from "../Utils/VideoCall/VideoCallConnectionSettings";
import VideoCallMeetingFactory from "../Utils/VideoCall/VideoCallMeetingFactory";
import { VideoCallMeetingRequest } from "../Utils/VideoCall/VideoCallMeetingRequest";
import VideoCallHttpClient from "../Utils/VideoCall/VideoCallHttpClient";
import logger, { LogAttributes } from "../Utils/Logger";
import { redactLogString } from "../Utils/LogRedaction";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

// A last error long enough to act on, short enough for a table cell.
const MAX_LAST_ERROR_LENGTH: number = 1000;

/*
 * Validation happens at save time, so a connection that saves is one a call
 * can be started with: a wrong key, a missing secret or a malformed id
 * reaches the person configuring it, not a responder in the middle of an
 * incident. Secrets are stored encrypted and never returned; an update
 * merges what it sends over what is stored (VideoCallConnectionSettings).
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

    const idFromQuery: unknown = (updateBy.query as JSONObject)["_id"];
    const connectionId: string | undefined =
      typeof idFromQuery === "string"
        ? idFromQuery
        : idFromQuery instanceof ObjectID
          ? idFromQuery.toString()
          : undefined;

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
        config: true,
        secrets: true,
      },
      props: { isRoot: true },
    });

    if (!current || !current.provider) {
      throw new BadDataException("The video call connection no longer exists.");
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
      },
    };
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
