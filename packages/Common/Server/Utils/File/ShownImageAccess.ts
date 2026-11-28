import InMemoryTTLCache from "../../Infrastructure/InMemoryTTLCache";
import AccessTokenService from "../../Services/AccessTokenService";
import DatabaseService from "../../Services/DatabaseService";
import TeamMemberService from "../../Services/TeamMemberService";
import CallerPlan from "../Billing/CallerPlan";
import { normalizeFileId } from "./FileOwnership";
import MarkdownFiles from "./MarkdownFiles";
import ShownImages, { RecordShowingImage } from "./ShownImages";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getModelTypeByName } from "../../../Models/DatabaseModels/Index";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Exception from "../../../Types/Exception/Exception";
import {
  canShowImages,
  COMMON_MARKDOWN_RECORD_TABLE_NAMES,
} from "../../../Types/File/MarkdownRecords";
import ObjectID from "../../../Types/ObjectID";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * WHETHER AN INLINE IMAGE IS SHOWN TO A PERSON BY A RECORD THEY MAY READ
 * (#11478).
 *
 * The image route serves a private image of a project to a member who can
 * open the project (FileViewerAccess) only when one of the records of the
 * project that show it (ShownImages) is theirs to read, and shows it to
 * them as they read it:
 *
 *   - each record is read as the person, through its table's own service,
 *     with the props a request of theirs to the project carries - their
 *     permissions there, their teams, the project's plan - so every table,
 *     column, label, owned-record and private-record rule of a read of it
 *     applies, exactly as on the page that shows it;
 *   - of each record, only the columns that can show images they may read
 *     are read (MarkdownFiles.readShownTokens), and the image must be named
 *     in what was read: a record that no longer shows it, or shows it only
 *     in a column they may not read, opens nothing.
 *
 * Kept for SHOWN_TO_FOR_MS, per person: the props of their request to a
 * project, what each record shows them, and the answer for each image - so
 * a page that draws twenty images of one incident reads the incident once,
 * and the same page drawn again reads nothing. The records are read once
 * however many images ask for them at the same moment. Who can open the
 * project is asked again on every request, before any of it
 * (FileViewerAccess): someone who has left the project opens nothing.
 */

// How long what a person may read decides their images.
export const SHOWN_TO_FOR_MS: number = 30_000;

export default class ShownImageAccess {
  // The answer for each person and image.
  private static answers: InMemoryTTLCache<boolean> =
    new InMemoryTTLCache<boolean>(20_000);

  // What each record shows each person: its image tokens.
  private static shownTo: InMemoryTTLCache<Array<string>> =
    new InMemoryTTLCache<Array<string>>(20_000);

  // The props of each person's requests to each project.
  private static propsOf: InMemoryTTLCache<DatabaseCommonInteractionProps> =
    new InMemoryTTLCache<DatabaseCommonInteractionProps>(5_000);

  // Reads on their way, shared by every image that asks for the same.
  private static reading: Map<string, Promise<unknown>> = new Map();

  /**
   * Whether a record of the project shows the image to the person: the
   * records that show it (ShownImages), each read as them until one does.
   * `permission` is what they hold in the project, as their request to it
   * was granted. A record of a table they may not read shows them nothing;
   * a read that fails for another reason throws.
   */
  public static async isShownTo(data: {
    userId: ObjectID;
    projectId: ObjectID;
    permission: UserTenantAccessPermission;
    file: { fileId: ObjectID | string; token: string };
  }): Promise<boolean> {
    const fileId: string = normalizeFileId(data.file.fileId);

    if (!fileId || !data.file.token) {
      return false;
    }

    const answerKey: string = this.getKey(data.userId, data.projectId, fileId);
    const known: boolean | undefined = this.answers.get(answerKey);

    if (known !== undefined) {
      return known;
    }

    // Kept before the shared run ends, so nobody who asks after it reads again.
    return await this.once(answerKey, async (): Promise<boolean> => {
      const answer: boolean = await this.decide({ ...data, fileId: fileId });

      this.answers.set(answerKey, answer, SHOWN_TO_FOR_MS);

      return answer;
    });
  }

  private static async decide(data: {
    userId: ObjectID;
    projectId: ObjectID;
    permission: UserTenantAccessPermission;
    fileId: string;
    file: { token: string };
  }): Promise<boolean> {
    const records: Array<RecordShowingImage> = await ShownImages.findRecords({
      fileId: data.fileId,
      projectId: data.projectId,
    });

    if (records.length === 0) {
      return false;
    }

    const props: DatabaseCommonInteractionProps = await this.getProps(data);

    for (const [tableName, recordIds] of this.groupByTable(records)) {
      const shown: Map<string, Array<string>> = await this.readShownTo({
        tableName: tableName,
        recordIds: recordIds,
        projectId: data.projectId,
        props: props,
      });

      for (const tokens of shown.values()) {
        if (tokens.includes(data.file.token)) {
          return true;
        }
      }
    }

    return false;
  }

  /*
   * The props a request of the person's to the project carries
   * (UserMiddleware, CommonAPI): their permission there, their global
   * permission, their teams in the project, and the project's plan.
   */
  public static async getProps(data: {
    userId: ObjectID;
    projectId: ObjectID;
    permission: UserTenantAccessPermission;
  }): Promise<DatabaseCommonInteractionProps> {
    const key: string = this.getKey(data.userId, data.projectId, "props");
    const known: DatabaseCommonInteractionProps | undefined =
      this.propsOf.get(key);

    if (known) {
      return known;
    }

    return await this.once(
      key,
      async (): Promise<DatabaseCommonInteractionProps> => {
        const [globalPermission, teamIds]: [
          UserGlobalAccessPermission | null,
          Array<ObjectID>,
        ] = await Promise.all([
          AccessTokenService.getUserGlobalAccessPermission(data.userId),
          TeamMemberService.getTeamIdsForUser(data.userId, data.projectId),
        ]);

        const props: DatabaseCommonInteractionProps = await CallerPlan.withPlan(
          {
            userId: data.userId,
            userType: UserType.User,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: data.permission,
            },
            ...(globalPermission
              ? { userGlobalAccessPermission: globalPermission }
              : {}),
            userTeamIds: teamIds,
          },
        );

        this.propsOf.set(key, props, SHOWN_TO_FOR_MS);

        return props;
      },
    );
  }

  /*
   * The records by table, each table and record once, the tables people
   * paste images into most first, then the rest as they came: the first
   * that shows the image to the person ends the search.
   */
  public static groupByTable(
    records: Array<RecordShowingImage>,
  ): Array<[string, Array<string>]> {
    const byTable: Map<string, Array<string>> = new Map();

    for (const record of records) {
      const ids: Array<string> = byTable.get(record.tableName) || [];

      if (!ids.includes(record.recordId)) {
        ids.push(record.recordId);
      }

      byTable.set(record.tableName, ids);
    }

    const rank: (tableName: string) => number = (tableName: string): number => {
      const index: number =
        COMMON_MARKDOWN_RECORD_TABLE_NAMES.indexOf(tableName);

      return index === -1 ? COMMON_MARKDOWN_RECORD_TABLE_NAMES.length : index;
    };

    // Stable: tables of the same rank keep the order they came in.
    return Array.from(byTable.entries()).sort(
      (
        left: [string, Array<string>],
        right: [string, Array<string>],
      ): number => {
        return rank(left[0]) - rank(right[0]);
      },
    );
  }

  /*
   * The tokens each of these records shows the person: kept, or read as
   * them. A record they may not read shows them none.
   */
  private static async readShownTo(data: {
    tableName: string;
    recordIds: Array<string>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<string>>> {
    const shown: Map<string, Array<string>> = new Map();
    const pending: Array<string> = [];

    const keyOf: (recordId: string) => string = (recordId: string): string => {
      return this.getKey(
        data.props.userId,
        data.projectId,
        `${data.tableName}|${recordId}`,
      );
    };

    for (const recordId of data.recordIds) {
      const known: Array<string> | undefined = this.shownTo.get(
        keyOf(recordId),
      );

      if (known) {
        shown.set(recordId, known);
      } else {
        pending.push(recordId);
      }
    }

    if (pending.length === 0) {
      return shown;
    }

    const read: Map<string, Array<string>> = await this.once(
      keyOf(pending.join(",")),
      async (): Promise<Map<string, Array<string>>> => {
        const tokensOf: Map<string, Array<string>> = await this.readAsPerson({
          ...data,
          recordIds: pending,
        });

        // Kept before the shared read ends, so nobody after it reads again.
        for (const recordId of pending) {
          this.shownTo.set(
            keyOf(recordId),
            tokensOf.get(recordId) || [],
            SHOWN_TO_FOR_MS,
          );
        }

        return tokensOf;
      },
    );

    for (const recordId of pending) {
      shown.set(recordId, read.get(recordId) || []);
    }

    return shown;
  }

  /*
   * The records read as the person, through the table's own service: what
   * its read refuses - a table they may not read - shows them nothing. A
   * table without a service of its own is not read at all: a plain service
   * would leave out the read hooks that keep private records to their
   * owners.
   */
  private static async readAsPerson(data: {
    tableName: string;
    recordIds: Array<string>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<string>>> {
    const service: DatabaseService<BaseModel> | null = this.getServiceOf(
      data.tableName,
    );

    if (!service) {
      return new Map();
    }

    let shown: Map<string, Set<string>>;

    try {
      shown = await MarkdownFiles.readShownTokens({
        service: service,
        recordIds: data.recordIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        projectId: data.projectId,
        props: data.props,
      });
    } catch (err) {
      // A read the person's permissions refuse: none of it is theirs.
      if (err instanceof Exception) {
        return new Map();
      }

      throw err;
    }

    const tokens: Map<string, Array<string>> = new Map();

    for (const [recordId, shownTokens] of shown) {
      tokens.set(recordId, Array.from(shownTokens));
    }

    return tokens;
  }

  /*
   * A record table's own service, every service loaded first. Null for a
   * table whose records show no images, or that has no service of its own.
   */
  public static getServiceOf(
    tableName: string,
  ): DatabaseService<BaseModel> | null {
    const modelType: { new (): BaseModel } | null =
      getModelTypeByName(tableName);

    if (!modelType || !canShowImages(new modelType())) {
      return null;
    }

    if (!DatabaseService.getServiceOf(modelType)) {
      // Each service is its model's own once it is built: build them all.
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/Index");
    }

    return DatabaseService.getServiceOf(modelType);
  }

  /*
   * One run of `work` for everyone who asks for the same thing while it
   * runs: the images of one page ask at the same moment.
   */
  private static async once<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const running: Promise<unknown> | undefined = this.reading.get(key);

    if (running) {
      return (await running) as T;
    }

    const started: Promise<T> = work();

    this.reading.set(key, started);

    try {
      return await started;
    } finally {
      this.reading.delete(key);
    }
  }

  private static getKey(
    userId: ObjectID | null | undefined,
    projectId: ObjectID,
    what: string,
  ): string {
    return [normalizeFileId(userId), normalizeFileId(projectId), what].join(
      "|",
    );
  }

  // Forgets every answer: the next image of each person is decided again.
  public static forget(): void {
    this.answers.clear();
    this.shownTo.clear();
    this.propsOf.clear();
    this.reading.clear();
  }
}
