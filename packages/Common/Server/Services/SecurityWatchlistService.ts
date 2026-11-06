import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/SecurityWatchlist";
import ThreatIntelFeed from "../../Models/DatabaseModels/ThreatIntelFeed";
import ThreatIntelFeedService from "./ThreatIntelFeedService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SecurityWatchlists from "../Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE,
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistShape,
  SecurityWatchlistSource,
  getSecurityWatchlistImportUrlProblem,
  getSecurityWatchlistNameKey,
  getSecurityWatchlistNameProblem,
  getSecurityWatchlistProblem,
  isSecurityWatchlistImportSchedule,
  normalizeSecurityWatchlistImportUrl,
  normalizeSecurityWatchlistName,
} from "../../Types/SecurityEvent/SecurityWatchlist";
import OneUptimeDate from "../../Types/Date";
import {
  WatchlistReader,
  describeWatchlistReaders,
} from "../../Types/SecurityEvent/SecurityWatchlistFilter";

/*
 * The feed a write names, under either of its names: the id column, or the
 * relation a form's dropdown sends ({ _id }). Undefined when the write names
 * none; null when it clears it.
 */
export function getWrittenThreatIntelFeedId(
  data: JSONObject,
): string | null | undefined {
  if (data["threatIntelFeedId"] !== undefined) {
    return RelationValueUtil.getRelationId(data["threatIntelFeedId"]);
  }

  if (data["threatIntelFeed"] === undefined) {
    return undefined;
  }

  return RelationValueUtil.getRelationId(data["threatIntelFeed"]);
}

/*
 * A project's watchlists (Types/SecurityEvent/SecurityWatchlist): each
 * checked as the form checks it, its name unique in the project whatever
 * the case, at most SECURITY_WATCHLISTS_PER_PROJECT_MAX of them.
 *
 * Rules, Security Events monitors and hunts read a list by its name, so a
 * list one of them reads keeps it: it is neither renamed nor deleted while
 * one names it - the refusal says which (SecurityWatchlists.findReaders).
 * What a list holds and where its values come from are chosen when it is
 * created (its values were checked against them); a list that follows a
 * feed may follow another feed, and a list read from an address may be
 * read from another, on another schedule.
 */
export class Service extends ProjectReferencesService<Model> {
  /*
   * The creates and updates that start a list's reads from its address
   * again: a new list read from an address, a new address or schedule.
   * When it is next read is OneUptime's to write, once the write has passed
   * every check (onCreatePermitted, onUpdatePermitted): no caller writes it.
   */
  private readonly createsReadingFromUrl: WeakSet<CreateBy<Model>> =
    new WeakSet<CreateBy<Model>>();
  private readonly updatesRestartingReads: WeakSet<UpdateBy<Model>> =
    new WeakSet<UpdateBy<Model>>();

  public constructor() {
    super(Model);
  }

  // The words a problem is answered with: the shared rules' first, as a 400.
  public static assertValid(watchlist: SecurityWatchlistShape): void {
    const problem: string | null = getSecurityWatchlistProblem(watchlist);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  private async assertProjectHasRoom(projectId: ObjectID): Promise<void> {
    const count: PositiveNumber = await this.countBy({
      query: {
        projectId,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() >= SECURITY_WATCHLISTS_PER_PROJECT_MAX) {
      throw new BadDataException(
        `A project keeps at most ${SECURITY_WATCHLISTS_PER_PROJECT_MAX} watchlists. Delete the ones no rule reads any more.`,
      );
    }
  }

  // A feed the list follows is the project's own (ProjectReferencesService checks the id).
  private async assertFeedFollowable(feedId: string): Promise<void> {
    const feed: ThreatIntelFeed | null =
      await ThreatIntelFeedService.findOneById({
        id: new ObjectID(feedId),
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!feed) {
      throw new BadDataException("Choose the threat intel feed to follow.");
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;

    createBy.data.name = normalizeSecurityWatchlistName(createBy.data.name);

    if (typeof createBy.data.description === "string") {
      createBy.data.description = createBy.data.description.trim();
    }

    const feedId: string | null | undefined = getWrittenThreatIntelFeedId(data);
    const source: SecurityWatchlistSource =
      (createBy.data.source as SecurityWatchlistSource) ||
      SecurityWatchlistSource.Values;

    /*
     * A list read from an address reads it every hour unless it says
     * otherwise; any other list reads no address, whatever the write named.
     */
    if (source === SecurityWatchlistSource.Url) {
      createBy.data.importUrl = normalizeSecurityWatchlistImportUrl(
        createBy.data.importUrl,
      );

      if (!createBy.data.importSchedule) {
        createBy.data.importSchedule =
          DEFAULT_SECURITY_WATCHLIST_IMPORT_SCHEDULE;
      }
    } else {
      delete data["importUrl"];
      delete data["importSchedule"];
    }

    Service.assertValid({
      name: createBy.data.name,
      entityType: createBy.data.entityType,
      description: createBy.data.description,
      source,
      threatIntelFeedId: feedId,
      importUrl: createBy.data.importUrl,
      importSchedule: createBy.data.importSchedule,
    });

    if (source === SecurityWatchlistSource.Url) {
      this.createsReadingFromUrl.add(createBy);
    }

    if (source === SecurityWatchlistSource.ThreatIntelFeed && feedId) {
      await this.assertFeedFollowable(feedId);

      // The feed by its id column, however the write named it.
      RelationIdUtil.stamp(
        data as unknown as Record<string, unknown>,
        ["threatIntelFeedId", "threatIntelFeed"],
        new ObjectID(feedId),
      );
    } else if (feedId) {
      // A list kept by hand follows no feed: whatever the write named is not kept.
      RelationIdUtil.leaveOut(data as unknown as Record<string, unknown>, [
        "threatIntelFeedId",
        "threatIntelFeed",
      ]);
    }

    const projectId: ObjectID | undefined =
      createBy.data.projectId ||
      (createBy.props.tenantId as ObjectID | undefined);

    if (projectId) {
      await this.assertProjectHasRoom(projectId);
    }

    return { createBy, carryForward: null };
  }

  // A new list read from an address is read within a minute of its create.
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    if (!this.createsReadingFromUrl.has(onCreate.createBy)) {
      return;
    }

    this.createsReadingFromUrl.delete(onCreate.createBy);
    onCreate.createBy.data.nextImportAt = OneUptimeDate.getCurrentDate();
  }

  // A new address or schedule is read within a minute of the update.
  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    if (!this.updatesRestartingReads.has(updateBy)) {
      return;
    }

    this.updatesRestartingReads.delete(updateBy);
    (updateBy.data as unknown as JSONObject)["nextImportAt"] =
      OneUptimeDate.getCurrentDate();
  }

  /*
   * The address and schedule an update writes, for the lists it updates:
   * only a list read from an address reads one, and it always has a whole
   * https address and a schedule it can keep.
   */
  private async checkWrittenImport(
    updateBy: UpdateBy<Model>,
    data: JSONObject,
  ): Promise<void> {
    const writesUrl: boolean = data["importUrl"] !== undefined;
    const writesSchedule: boolean = data["importSchedule"] !== undefined;

    if (!writesUrl && !writesSchedule) {
      return;
    }

    if (writesUrl) {
      data["importUrl"] = normalizeSecurityWatchlistImportUrl(
        data["importUrl"],
      );

      const problem: string | null = getSecurityWatchlistImportUrlProblem(
        data["importUrl"],
      );

      if (problem) {
        throw new BadDataException(problem);
      }
    }

    if (
      writesSchedule &&
      !isSecurityWatchlistImportSchedule(data["importSchedule"])
    ) {
      throw new BadDataException(
        SECURITY_WATCHLIST_MESSAGES.chooseSchedule.message,
      );
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        source: true,
      },
    );

    for (const row of rows) {
      if (row.source !== SecurityWatchlistSource.Url) {
        throw new BadDataException(
          "Only a watchlist read from an address reads one. To read a list from an address, create a watchlist that does.",
        );
      }
    }

    this.updatesRestartingReads.add(updateBy);
  }

  /*
   * An update is checked as the list it leaves behind. What it holds and
   * where its values come from are the create's (their columns take no
   * update), so a list's values always fit it.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["name"] !== undefined) {
      data["name"] = normalizeSecurityWatchlistName(data["name"]);

      const problem: string | null = getSecurityWatchlistNameProblem(
        data["name"],
      );

      if (problem) {
        throw new BadDataException(problem);
      }
    }

    if (typeof data["description"] === "string") {
      data["description"] = (data["description"] as string).trim();
    }

    await this.checkWrittenImport(updateBy, data);

    const feedId: string | null | undefined = getWrittenThreatIntelFeedId(data);

    if (feedId === undefined) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        source: true,
      },
    );

    for (const row of rows) {
      if (row.source !== SecurityWatchlistSource.ThreatIntelFeed) {
        // A list kept by hand, or read from an address, follows no feed.
        if (feedId) {
          throw new BadDataException(
            row.source === SecurityWatchlistSource.Url
              ? "This watchlist is read from an address, so it follows no feed. To follow a feed, create a watchlist that does."
              : "This watchlist keeps its own values, so it follows no feed. To follow a feed, create a watchlist that does.",
          );
        }

        continue;
      }

      if (!feedId) {
        throw new BadDataException("Choose the threat intel feed to follow.");
      }
    }

    if (feedId) {
      await this.assertFeedFollowable(feedId);
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A new name, once the caller may make the update: unique in the project
   * whatever the case, and only for a list nothing reads by its old name -
   * every rule, monitor and hunt that names it would stop working.
   */
  @CaptureSpan()
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["name"] === undefined) {
      return;
    }

    const newName: string = normalizeSecurityWatchlistName(data["name"]);
    const newKey: string = getSecurityWatchlistNameKey(newName);

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        name: true,
      },
    );

    const renamed: Array<Model> = rows.filter((row: Model): boolean => {
      return getSecurityWatchlistNameKey(row.name) !== newKey;
    });

    if (renamed.length === 0) {
      // A name written again, perhaps in another case: VIP_users for vip_users.
      return;
    }

    if (renamed.length > 1) {
      throw new BadDataException(
        "Two watchlists cannot have the same name. Rename one at a time.",
      );
    }

    const row: Model = renamed[0]!;

    if (!row.projectId) {
      return;
    }

    const clash: Model | null = await this.findOneBy({
      query: {
        projectId: row.projectId,
        name: QueryHelper.findWithSameText(newName),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (clash && clash.id?.toString() !== row.id?.toString()) {
      throw new BadDataException(
        `This project already has a watchlist named ${newName}.`,
      );
    }

    const readers: Array<WatchlistReader> =
      (await SecurityWatchlists.findReaders(row.projectId)).get(
        getSecurityWatchlistNameKey(row.name),
      ) || [];

    if (readers.length > 0) {
      throw new BadDataException(
        `This watchlist is read by its name in: ${describeWatchlistReaders(
          readers,
        )}. Change the name there first, then rename the list.`,
      );
    }
  }

  /*
   * A list nothing reads any more: deleting one a rule, a monitor or a hunt
   * names would stop it, so the refusal says which still read it.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        name: true,
      },
    );

    const readersByProject: Map<
      string,
      Map<string, Array<WatchlistReader>>
    > = new Map();

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const projectKey: string = row.projectId.toString();

      if (!readersByProject.has(projectKey)) {
        readersByProject.set(
          projectKey,
          await SecurityWatchlists.findReaders(row.projectId),
        );
      }

      const readers: Array<WatchlistReader> =
        readersByProject
          .get(projectKey)!
          .get(getSecurityWatchlistNameKey(row.name)) || [];

      if (readers.length > 0) {
        throw new BadDataException(
          `${row.name || "This watchlist"} is still read by its name in: ${describeWatchlistReaders(
            readers,
          )}. Take it out of them first, then delete the list.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
