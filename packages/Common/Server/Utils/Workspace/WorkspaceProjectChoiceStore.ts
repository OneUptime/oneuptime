import crypto from "crypto";
import GlobalCache from "../../Infrastructure/GlobalCache";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceProjectChoice } from "./WorkspaceProjectResolution";

/*
 * WHICH PROJECT A REQUEST IS FOR: THE REQUEST, KEPT BEHIND THE BUTTONS THAT
 * ASK.
 *
 * A Slack workspace or a Microsoft 365 organization can be connected to more
 * than one OneUptime project. A request nothing ties to one of them - no
 * record, no channel only one of them owns, a person connected in several -
 * asks its person which, with a button for each project they are in
 * (SlackProjectChoice, MicrosoftTeamsProjectChoice), and is made again in
 * the one they choose. Until a button is pressed the request is kept here,
 * on the server:
 *
 *   - behind an opaque random token the buttons carry, keyed by the token's
 *     SHA-256, so a read of the cache yields no token a press could carry;
 *   - with who made it - the workspace, and their own chat account - and
 *     the projects offered, named, in the order the buttons show them;
 *   - for thirty minutes (EXPIRES_IN_SECONDS).
 *
 * A press spends it (take): once, in one atomic step, and only when it is
 * the person who made it, in the workspace they made it in, choosing a
 * project that was offered. Anything else spends nothing and says why
 * (WorkspaceProjectChoiceRefusal), so the person whose request it is can
 * still choose. What the request was, each chat writes and reads back
 * itself.
 *
 * A project chosen can also be remembered here under a key of the chat's
 * own (rememberProject): the project chosen in a conversation with
 * OneUptime AI, for its follow-ups, and the project somebody chose for
 * their Slack Home. The key is a hash of its parts, which name nobody.
 */

// What a press of one of the buttons names.
export interface WorkspaceProjectChoicePress {
  projectId: ObjectID;
  // The kept request's token.
  token: string;
}

// A request kept behind the buttons, as the chat that asked reads it.
export interface WorkspaceProjectChoiceRecord<TRequest> {
  // The workspace it was made in: a Slack team id, a Microsoft tenant id.
  workspaceId: string;
  // Who made it: a Slack user id, a Microsoft Entra object id.
  workspaceUserId: string;
  // The projects offered, named, in the order the buttons show them.
  choices: Array<WorkspaceProjectChoice>;
  request: TRequest;
}

// Why a press spent nothing.
export enum WorkspaceProjectChoiceRefusal {
  /*
   * Nothing is kept behind its token: chosen already, past its thirty
   * minutes, never handed out, or a cache that cannot be read.
   */
  Gone = "Gone",
  // The request is somebody else's, or another workspace's.
  NotTheirs = "NotTheirs",
  // A project the buttons did not offer: an edited press.
  NotOffered = "NotOffered",
}

export type WorkspaceProjectChoiceTaken<TRequest> =
  | {
      isTaken: true;
      record: WorkspaceProjectChoiceRecord<TRequest>;
      // The project chosen, as it was offered.
      choice: WorkspaceProjectChoice;
    }
  | {
      isTaken: false;
      refusal: WorkspaceProjectChoiceRefusal;
    };

// 32 random bytes, as base64url writes them.
const TOKEN_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;

export default class WorkspaceProjectChoiceStore {
  /*
   * Thirty minutes: as long as Slack takes answers at the response_url of
   * the request, where what it asked for is still answered once its
   * project is chosen - and long enough to choose in Microsoft Teams.
   */
  public static readonly EXPIRES_IN_SECONDS: number = 30 * 60;

  /*
   * The most projects offered: Slack takes 25 buttons in a row of them, and
   * more than that is no longer a choice one reads through. Somebody in
   * more is answered as before, with the projects named.
   */
  public static readonly MAX_CHOICES: number = 25;

  // The most a button's text holds: Slack's limit, which Teams shows whole.
  public static readonly BUTTON_TITLE_MAX_LENGTH: number = 75;

  // What a button carries: "<project id>:<token>".
  public static getChoiceValue(press: WorkspaceProjectChoicePress): string {
    return `${press.projectId.toString()}:${press.token}`;
  }

  // What a button's value names; null for anything that is not one.
  public static readChoice(value: unknown): WorkspaceProjectChoicePress | null {
    if (typeof value !== "string") {
      return null;
    }

    const separator: number = value.indexOf(":");

    if (separator < 0) {
      return null;
    }

    const projectId: string = value.substring(0, separator);
    const token: string = value.substring(separator + 1);

    if (!ObjectID.isValidUUID(projectId) || !TOKEN_PATTERN.test(token)) {
      return null;
    }

    return { projectId: new ObjectID(projectId), token: token };
  }

  /*
   * Keeps a request behind a new token, for EXPIRES_IN_SECONDS, and gives
   * the token back. `request` is what the chat reads back with take's
   * readRequest. Throws when it cannot be kept: the chat then answers as it
   * did before it could ask.
   */
  @CaptureSpan()
  public static async keep(data: {
    namespace: string;
    workspaceId: string;
    workspaceUserId: string;
    choices: Array<WorkspaceProjectChoice>;
    request: JSONObject;
  }): Promise<string> {
    const token: string = crypto.randomBytes(32).toString("base64url");

    await GlobalCache.setString(
      data.namespace,
      WorkspaceProjectChoiceStore.hash(token),
      JSON.stringify({
        workspaceId: data.workspaceId,
        workspaceUserId: data.workspaceUserId,
        choices: data.choices.map(
          (choice: WorkspaceProjectChoice): JSONObject => {
            return {
              projectId: choice.projectId.toString(),
              name: choice.name,
            };
          },
        ),
        request: data.request,
      }),
      { expiresInSeconds: WorkspaceProjectChoiceStore.EXPIRES_IN_SECONDS },
    );

    return token;
  }

  /*
   * The request behind a press, spent: once, by the person who made it
   * (`workspaceUserId`), in the workspace it was made in, for a project it
   * offered. Otherwise nothing is spent, and the refusal says why - the
   * person whose request it is can still choose. `readRequest` reads the
   * chat's request back: null for one it did not write, which is gone.
   * Never throws: a cache that cannot be read is gone.
   */
  @CaptureSpan()
  public static async take<TRequest>(data: {
    namespace: string;
    press: WorkspaceProjectChoicePress;
    workspaceId: string | undefined;
    workspaceUserId: string | undefined;
    readRequest: (request: JSONObject) => TRequest | null;
  }): Promise<WorkspaceProjectChoiceTaken<TRequest>> {
    const key: string = WorkspaceProjectChoiceStore.hash(data.press.token);

    try {
      const record: WorkspaceProjectChoiceRecord<TRequest> | null =
        WorkspaceProjectChoiceStore.parse(
          await GlobalCache.getString(data.namespace, key),
          data.readRequest,
        );

      if (!record) {
        return WorkspaceProjectChoiceStore.refused(
          WorkspaceProjectChoiceRefusal.Gone,
        );
      }

      if (
        !data.workspaceId ||
        !data.workspaceUserId ||
        record.workspaceId !== data.workspaceId ||
        record.workspaceUserId !== data.workspaceUserId
      ) {
        return WorkspaceProjectChoiceStore.refused(
          WorkspaceProjectChoiceRefusal.NotTheirs,
        );
      }

      if (
        !WorkspaceProjectChoiceStore.getChoice(record, data.press.projectId)
      ) {
        return WorkspaceProjectChoiceStore.refused(
          WorkspaceProjectChoiceRefusal.NotOffered,
        );
      }

      // Spent in one atomic step: a second press finds nothing.
      const spent: WorkspaceProjectChoiceRecord<TRequest> | null =
        WorkspaceProjectChoiceStore.parse(
          await GlobalCache.getAndDeleteString(data.namespace, key),
          data.readRequest,
        );
      const choice: WorkspaceProjectChoice | undefined = spent
        ? WorkspaceProjectChoiceStore.getChoice(spent, data.press.projectId)
        : undefined;

      if (!spent || !choice) {
        return WorkspaceProjectChoiceStore.refused(
          WorkspaceProjectChoiceRefusal.Gone,
        );
      }

      return { isTaken: true, record: spent, choice: choice };
    } catch (err) {
      logger.error("Could not read the request a project choice is for.");
      logger.error(err);
      return WorkspaceProjectChoiceStore.refused(
        WorkspaceProjectChoiceRefusal.Gone,
      );
    }
  }

  // The choice of `projectId` among a record's; undefined when not offered.
  public static getChoice(
    record: { choices: Array<WorkspaceProjectChoice> },
    projectId: ObjectID,
  ): WorkspaceProjectChoice | undefined {
    return record.choices.find((choice: WorkspaceProjectChoice): boolean => {
      return (
        choice.projectId.toString().toLowerCase() ===
        projectId.toString().toLowerCase()
      );
    });
  }

  // A button's text: the project's name, cut to what a button holds.
  public static getButtonTitle(name: string): string {
    const max: number = WorkspaceProjectChoiceStore.BUTTON_TITLE_MAX_LENGTH;

    return name.length > max ? `${name.substring(0, max - 1)}…` : name;
  }

  /*
   * "A or B", "A, B or C": the projects of a question's text, as a
   * notification shows it.
   */
  public static getNameList(choices: Array<WorkspaceProjectChoice>): string {
    const names: Array<string> = choices.map(
      (choice: WorkspaceProjectChoice): string => {
        return choice.name;
      },
    );

    return names.length > 1
      ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]!}`
      : names[0] || "";
  }

  /*
   * Remembers a project chosen, under the chat's own key (`keyParts`, kept
   * only as their hash), for `expiresInSeconds`; remembering again replaces
   * it and starts its time again. Never throws: what is not remembered is
   * asked again.
   */
  @CaptureSpan()
  public static async rememberProject(data: {
    namespace: string;
    keyParts: Array<string>;
    projectId: ObjectID;
    expiresInSeconds: number;
  }): Promise<void> {
    try {
      await GlobalCache.setString(
        data.namespace,
        WorkspaceProjectChoiceStore.getKey(data.keyParts),
        data.projectId.toString(),
        { expiresInSeconds: data.expiresInSeconds },
      );
    } catch (err) {
      logger.debug(`Could not remember a chosen project (${data.namespace}).`);
      logger.debug(err);
    }
  }

  /*
   * The project remembered under the chat's key; null for none. Whether the
   * person may still act there is read by the chat, every time. Never
   * throws: a cache that cannot be read remembers none.
   */
  @CaptureSpan()
  public static async getRememberedProject(data: {
    namespace: string;
    keyParts: Array<string>;
  }): Promise<ObjectID | null> {
    try {
      const projectId: string | null = await GlobalCache.getString(
        data.namespace,
        WorkspaceProjectChoiceStore.getKey(data.keyParts),
      );

      return projectId && ObjectID.isValidUUID(projectId)
        ? new ObjectID(projectId)
        : null;
    } catch (err) {
      logger.debug(
        `Could not read a remembered project choice (${data.namespace}).`,
      );
      logger.debug(err);
      return null;
    }
  }

  // The fields of `object` named, those that hold text or a yes or no.
  public static pickText(
    object: JSONObject,
    fields: ReadonlyArray<string>,
  ): JSONObject {
    const picked: JSONObject = {};

    for (const field of fields) {
      const value: unknown = object[field];

      if (typeof value === "string" || typeof value === "boolean") {
        picked[field] = value;
      }
    }

    return picked;
  }

  // `value` as an object, when it is one (not an array).
  public static asObject(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }

  // Whether `value` is text, and not empty.
  public static isText(value: unknown): boolean {
    return typeof value === "string" && value.length > 0;
  }

  // `value` when it is text that is not empty; undefined otherwise.
  public static textOrUndefined(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
  }

  // The hex SHA-256 of `value`.
  public static hash(value: string): string {
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  private static getKey(keyParts: Array<string>): string {
    return WorkspaceProjectChoiceStore.hash(JSON.stringify(keyParts));
  }

  private static refused<TRequest>(
    refusal: WorkspaceProjectChoiceRefusal,
  ): WorkspaceProjectChoiceTaken<TRequest> {
    return { isTaken: false, refusal: refusal };
  }

  // A kept request, read back: null for anything keep did not write.
  private static parse<TRequest>(
    raw: string | null,
    readRequest: (request: JSONObject) => TRequest | null,
  ): WorkspaceProjectChoiceRecord<TRequest> | null {
    if (!raw) {
      return null;
    }

    let stored: unknown;

    try {
      stored = JSON.parse(raw);
    } catch {
      return null;
    }

    const record: JSONObject | undefined =
      WorkspaceProjectChoiceStore.asObject(stored);
    const request: JSONObject | undefined =
      WorkspaceProjectChoiceStore.asObject(record?.["request"]);

    if (
      !record ||
      !request ||
      !WorkspaceProjectChoiceStore.isText(record["workspaceId"]) ||
      !WorkspaceProjectChoiceStore.isText(record["workspaceUserId"]) ||
      !Array.isArray(record["choices"])
    ) {
      return null;
    }

    const choices: Array<WorkspaceProjectChoice> = [];

    for (const entry of record["choices"] as JSONArray) {
      const choice: JSONObject | undefined =
        WorkspaceProjectChoiceStore.asObject(entry);

      if (
        !choice ||
        typeof choice["projectId"] !== "string" ||
        !ObjectID.isValidUUID(choice["projectId"]) ||
        !WorkspaceProjectChoiceStore.isText(choice["name"])
      ) {
        return null;
      }

      choices.push({
        projectId: new ObjectID(choice["projectId"]),
        name: choice["name"] as string,
      });
    }

    const parsedRequest: TRequest | null = readRequest(request);

    if (choices.length === 0 || !parsedRequest) {
      return null;
    }

    return {
      workspaceId: record["workspaceId"] as string,
      workspaceUserId: record["workspaceUserId"] as string,
      choices: choices,
      request: parsedRequest,
    };
  }
}
