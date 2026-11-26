import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import { MarkdownText } from "../../../Utils/Markdown/FeedMarkdown";
import FeedPersonName from "../Feed/FeedPersonName";

/*
 * The server-side half of the SLO feed: the few things a feed writer needs
 * that touch the database or the process, kept out of the pure markdown
 * module (Common/Utils/Slo/SloFeedMarkdown.ts) so that module stays importable
 * anywhere.
 */
export default class SloFeedUtil {
  /*
   * SLO ids whose default burn rate rules are being seeded right now, counted
   * so that an overlapping seed of the same id can never clear the flag early.
   */
  private static seedingSloIds: Map<string, number> = new Map<string, number>();

  /*
   * Runs `seed` while marking the SLO as "being seeded", so the burn rate rule
   * service can tell the rules OneUptime adds on create from rules a person
   * adds later - the seeded rules are already described by the SLO's own
   * "created" item and must not post more items underneath it. (Rules a
   * person adds with "Add recommended rules" are added later, outside this
   * flag, and post their items like any rule added by hand.)
   *
   * Why this signal and not the create's props: seeding writes as root with
   * no user, but so do workflows and other automations whose rules DO deserve
   * an item, so "root and no user" would silently drop those. This signal is
   * exact instead. Seeding runs inside the SLO's onCreateSuccess, before the
   * create has returned, so no API caller can know the new SLO's id yet - any
   * burn rate rule created for that id while the flag is set came from the
   * create path itself. The flag is per process, which is enough: the seeding
   * call and the rule's onCreateSuccess run in the same call stack.
   */
  public static async runWhileSeedingDefaultBurnRateRules<T>(data: {
    sloId: ObjectID;
    seed: () => Promise<T>;
  }): Promise<T> {
    const key: string = data.sloId.toString();

    SloFeedUtil.seedingSloIds.set(
      key,
      (SloFeedUtil.seedingSloIds.get(key) || 0) + 1,
    );

    try {
      return await data.seed();
    } finally {
      const remaining: number = (SloFeedUtil.seedingSloIds.get(key) || 1) - 1;

      if (remaining <= 0) {
        SloFeedUtil.seedingSloIds.delete(key);
      } else {
        SloFeedUtil.seedingSloIds.set(key, remaining);
      }
    }
  }

  public static isSeedingDefaultBurnRateRules(
    sloId: ObjectID | undefined | null,
  ): boolean {
    if (!sloId) {
      return false;
    }

    return SloFeedUtil.seedingSloIds.has(sloId.toString());
  }

  /*
   * The rows a delete hook read up front, narrowed to the ones the delete
   * really removed.
   *
   * onBeforeDelete reads the rows the delete removes and holds the delete to
   * them (DatabaseService.findRowsAndHoldDeleteToThem), but the delete asks
   * the caller's permission once more and may find fewer of them - a row
   * removed in between, a permission taken away - and onDeleteSuccess still
   * runs when it matched nothing. DatabaseService hands onDeleteSuccess the
   * ids it actually deleted, so only those rows are described.
   */
  public static getRowsActuallyDeleted<TModel extends DatabaseBaseModel>(data: {
    rows: Array<TModel>;
    deletedIds: Array<ObjectID>;
  }): Array<TModel> {
    return DatabaseService.getRowsDeleted(data);
  }

  /*
   * A person in an SLO's feed - the acting user, an owner added or removed
   * - as every feed entry names them (FeedPersonName): a member by their
   * name, else the part of their address before the "@", linked to their
   * page; someone only invited to the project by the name typed for them,
   * else "someone who hasn't joined the project yet", as text - never an
   * address (#10668, #10669). The name is placed as text (mdText), so
   * `x](https://evil)` cannot re-point the link.
   *
   * Unlike UserService.getUserMarkdownString it returns null when there is
   * no such user, so callers can fall back to "no user" wording rather than
   * printing an empty link.
   */
  public static async getUserMarkdown(data: {
    userId: ObjectID | undefined | null;
    projectId: ObjectID;
  }): Promise<MarkdownText | null> {
    /*
     * An undefined id is not a harmless lookup: the id key would drop out of
     * the WHERE clause and match an arbitrary user.
     */
    if (!data.userId) {
      return null;
    }

    const markdown: MarkdownText = await FeedPersonName.getMarkdown({
      userId: data.userId,
      projectId: data.projectId,
    });

    return markdown.isEmpty() ? null : markdown;
  }

  /*
   * Built here from the dashboard URL rather than through MonitorService, which
   * reaches back into the SLO services through the monitor rule engine.
   */
  public static getMonitorLinkInDashboard(data: {
    dashboardUrl: URL;
    projectId: ObjectID;
    monitorId: ObjectID | string;
  }): string {
    return URL.fromString(data.dashboardUrl.toString())
      .addRoute(
        `/${data.projectId.toString()}/monitors/${data.monitorId.toString()}`,
      )
      .toString();
  }
}
