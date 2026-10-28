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
  SECURITY_WATCHLISTS_PER_PROJECT_MAX,
  SecurityWatchlistShape,
  SecurityWatchlistSource,
  getSecurityWatchlistNameKey,
  getSecurityWatchlistNameProblem,
  getSecurityWatchlistProblem,
  normalizeSecurityWatchlistName,
} from "../../Types/SecurityEvent/SecurityWatchlist";

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

// The rules that read a list, named for a refusal: up to three, then how many more.
export function describeRulesReading(
  rules: ReadonlyArray<{ name: string }>,
): string {
  const names: Array<string> = rules.map((rule: { name: string }): string => {
    return rule.name || "a rule with no name";
  });

  if (names.length <= 3) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/*
 * A project's watchlists (Types/SecurityEvent/SecurityWatchlist): each
 * checked as the form checks it, its name unique in the project whatever
 * the case, at most SECURITY_WATCHLISTS_PER_PROJECT_MAX of them.
 *
 * Rules read a list by its name, so a list a rule reads keeps it: it is
 * neither renamed nor deleted while a rule names it - the refusal says
 * which rules. What a list holds and where its values come from are chosen
 * when it is created (its values were checked against them); a list that
 * follows a feed may follow another feed.
 */
export class Service extends ProjectReferencesService<Model> {
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
    const feed: ThreatIntelFeed | null = await ThreatIntelFeedService.findOneById(
      {
        id: new ObjectID(feedId),
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      },
    );

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

    Service.assertValid({
      name: createBy.data.name,
      entityType: createBy.data.entityType,
      description: createBy.data.description,
      source,
      threatIntelFeedId: feedId,
    });

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
        // A list kept by hand follows no feed.
        if (feedId) {
          throw new BadDataException(
            "This watchlist keeps its own values, so it follows no feed. To follow a feed, create a watchlist that does.",
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
   * whatever the case, and only for a list no rule reads by its old name -
   * every rule that names it would stop running.
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

    const readers: Array<{ id: string; name: string }> =
      (await SecurityWatchlists.findRulesReading(row.projectId)).get(
        getSecurityWatchlistNameKey(row.name),
      ) || [];

    if (readers.length > 0) {
      throw new BadDataException(
        `Rules read this watchlist by its name: ${describeRulesReading(
          readers,
        )}. Change the name in those rules first, then rename the list.`,
      );
    }
  }

  /*
   * A list no rule reads any more: deleting one a rule names would stop that
   * rule, so the refusal says which rules still read it.
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
      Map<string, Array<{ id: string; name: string }>>
    > = new Map();

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      const projectKey: string = row.projectId.toString();

      if (!readersByProject.has(projectKey)) {
        readersByProject.set(
          projectKey,
          await SecurityWatchlists.findRulesReading(row.projectId),
        );
      }

      const readers: Array<{ id: string; name: string }> =
        readersByProject
          .get(projectKey)!
          .get(getSecurityWatchlistNameKey(row.name)) || [];

      if (readers.length > 0) {
        throw new BadDataException(
          `Rules still read ${row.name || "this watchlist"}: ${describeRulesReading(
            readers,
          )}. Remove it from those rules first, then delete the list.`,
        );
      }
    }

    return { deleteBy, carryForward: null };
  }
}

export default new Service();
