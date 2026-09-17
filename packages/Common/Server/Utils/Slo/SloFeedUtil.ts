import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { escapeMarkdownInline } from "../../../Utils/Markdown/MarkdownEscape";
import UserService from "../../Services/UserService";

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
   * service can tell the two rules OneUptime adds on create from rules a
   * person adds later - the seeded pair is already described by the SLO's own
   * "created" item and must not post two more items underneath it.
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
   * The caller's query pinned to the caller's project, for the reads a feed
   * hook makes in onBeforeUpdate / onBeforeDelete.
   *
   * Both hooks run BEFORE DatabaseService applies the caller's permissions to
   * the query, so the raw query read as root there can match rows in a
   * project the caller cannot see. Those rows are never described - the
   * writers only post for the ids the permission-checked write touched - but
   * they should not be read either. Without a tenant (a root automation) the
   * query already is the whole truth and is left exactly as it is.
   */
  public static getTenantPinnedQuery<TQuery>(data: {
    query: TQuery;
    tenantId: ObjectID | undefined | null;
  }): TQuery {
    if (!data.tenantId) {
      return data.query;
    }

    return {
      ...(data.query as unknown as Record<string, unknown>),
      projectId: data.tenantId,
    } as unknown as TQuery;
  }

  /*
   * The rows a delete hook read up front, narrowed to the ones the delete
   * really removed.
   *
   * onBeforeDelete reads before permissions are applied, and onDeleteSuccess
   * still runs when the permission-checked delete matched nothing. Describing
   * every row read up front would let a delete that names another project's
   * row - and so deletes nothing - post "removed" onto that project's SLO
   * feed in the caller's name. DatabaseService hands onDeleteSuccess the ids
   * it actually deleted, so only those rows are described.
   */
  public static getRowsActuallyDeleted<TModel extends DatabaseBaseModel>(data: {
    rows: Array<TModel>;
    deletedIds: Array<ObjectID>;
  }): Array<TModel> {
    // Postgres renders uuids lower-case whatever case a caller wrote them in.
    const deletedIds: Set<string> = new Set<string>(
      data.deletedIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    return data.rows.filter((row: TModel): boolean => {
      const id: string | undefined = row.id?.toString().toLowerCase();

      return id !== undefined && deletedIds.has(id);
    });
  }

  /*
   * "Jane Doe" - or the email when the user never set a name - escaped for
   * the middle of a markdown sentence. Empty when the user has neither.
   */
  public static getUserDisplayName(user: User | null | undefined): string {
    if (!user) {
      return "";
    }

    const name: string = user.name?.toString().trim() || "";
    const email: string = user.email?.toString().trim() || "";

    return escapeMarkdownInline(name || email).trim();
  }

  /*
   * `[Jane Doe](<dashboard link to the user>)` for the acting user of a feed
   * item. UserService.getUserMarkdownString interpolates the name raw, and a
   * user's name is theirs to set - `x](https://evil)` would re-point the link
   * in every SLO feed they touch - so the SLO feed builds its own.
   *
   * Returns null when there is no such user, so callers can fall back to "no
   * user" wording rather than printing an empty link.
   */
  public static async getUserMarkdown(data: {
    userId: ObjectID | undefined | null;
    projectId: ObjectID;
  }): Promise<string | null> {
    /*
     * An undefined id is not a harmless lookup: the id key would drop out of
     * the WHERE clause and match an arbitrary user.
     */
    if (!data.userId) {
      return null;
    }

    const user: User | null = await UserService.findOneById({
      id: data.userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return null;
    }

    const displayName: string = SloFeedUtil.getUserDisplayName(user) || "User";

    const link: URL = await UserService.getUserLinkInDashboard(
      data.projectId,
      data.userId,
    );

    return `[${displayName}](${link.toString()})`;
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
