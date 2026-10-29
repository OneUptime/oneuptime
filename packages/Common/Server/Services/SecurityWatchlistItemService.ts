import ProjectReferencesService from "./ProjectReferencesService";
import AuditLogService from "./AuditLogService";
import SecurityWatchlistService from "./SecurityWatchlistService";
import Model from "../../Models/DatabaseModels/SecurityWatchlistItem";
import SecurityWatchlist from "../../Models/DatabaseModels/SecurityWatchlist";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportProblem,
  SecurityWatchlistImportResult,
  SecurityWatchlistImportValue,
  SecurityWatchlistSource,
  countSecurityWatchlistValues,
  getSecurityWatchlistNoteProblem,
  getSecurityWatchlistSizeProblem,
  getSecurityWatchlistValueKey,
  getSecurityWatchlistValueProblem,
  normalizeSecurityWatchlistNote,
  normalizeSecurityWatchlistValue,
  parseSecurityWatchlistImport,
} from "../../Types/SecurityEvent/SecurityWatchlist";

// Rows written per INSERT of an import.
const IMPORT_INSERT_BATCH_SIZE: number = 500;

// Audit entries written at once for an import's new values.
const IMPORT_AUDIT_CONCURRENCY: number = 10;

// The lines an import's answer names, at most: enough to fix a file by.
export const SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN: number = 20;

/*
 * What an import's batch insert needs of the table's repository: TypeORM's
 * insert, which writes many rows in one statement and answers their ids.
 */
interface BatchInsert {
  insert: (rows: Array<Model>) => Promise<{ identifiers: Array<JSONObject> }>;
}

/*
 * The list a write names, under either of its names: the id column, or the
 * relation. Undefined when the write names none; null when it clears it.
 */
export function getWrittenWatchlistId(
  data: JSONObject,
): string | null | undefined {
  if (data["securityWatchlistId"] !== undefined) {
    return RelationValueUtil.getRelationId(data["securityWatchlistId"]);
  }

  if (data["securityWatchlist"] === undefined) {
    return undefined;
  }

  return RelationValueUtil.getRelationId(data["securityWatchlist"]);
}

// What an import did, for the person who made it.
export interface SecurityWatchlistImportSummary {
  added: number;
  removed: number;
  // Values the list already held.
  unchanged: number;
  // Lines that repeated a value of an earlier line.
  duplicates: number;
  // Lines left out, and why: the first SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN.
  problems: Array<SecurityWatchlistImportProblem>;
  problemCount: number;
  // What the list holds now.
  valueCount: number;
}

/*
 * The values of the watchlists a team keeps (SecurityWatchlistItem): each
 * checked against what its list holds, once per list whatever the case, and
 * a list at most SECURITY_WATCHLIST_VALUES_MAX values (100 of them patterns,
 * 100 ranges). A list that follows a threat intel feed takes none: the feed
 * keeps its values. The list's own count (SecurityWatchlist.valueCount)
 * follows every write.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private async readWatchlist(
    watchlistId: ObjectID,
  ): Promise<SecurityWatchlist> {
    const watchlist: SecurityWatchlist | null =
      await SecurityWatchlistService.findOneById({
        id: watchlistId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          entityType: true,
          source: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!watchlist) {
      throw new BadDataException("Choose the watchlist the value goes on.");
    }

    return watchlist;
  }

  // A list that follows a feed takes no value of anyone's.
  private static assertKeptByHand(watchlist: SecurityWatchlist): void {
    if (watchlist.source === SecurityWatchlistSource.ThreatIntelFeed) {
      throw new BadDataException(
        "This watchlist follows a threat intel feed, which keeps its values. To keep values by hand, create a watchlist of your own.",
      );
    }
  }

  // The values a list holds, with their ids.
  private async readListValues(watchlistId: ObjectID): Promise<Array<Model>> {
    return await this.findAllBy({
      query: {
        securityWatchlistId: watchlistId,
      },
      select: {
        _id: true,
        value: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Whether the list takes these values: none it holds already (whatever
   * the case), and the list as it would then be within its limits.
   */
  private static assertListTakes(data: {
    watchlist: SecurityWatchlist;
    existing: Array<{ id?: string | undefined; value: string }>;
    adding: Array<{ id?: string | undefined; value: string }>;
  }): void {
    const existingByKey: Map<string, string | undefined> = new Map();

    for (const item of data.existing) {
      existingByKey.set(getSecurityWatchlistValueKey(item.value), item.id);
    }

    for (const item of data.adding) {
      const key: string = getSecurityWatchlistValueKey(item.value);

      if (existingByKey.has(key) && existingByKey.get(key) !== item.id) {
        throw new BadDataException(
          `${data.watchlist.name || "This watchlist"} already holds ${item.value}.`,
        );
      }
    }

    const sizeProblem: string | null = getSecurityWatchlistSizeProblem(
      countSecurityWatchlistValues({
        values: [
          ...data.existing
            .filter((item: { id?: string | undefined }): boolean => {
              return !data.adding.some(
                (added: { id?: string | undefined }): boolean => {
                  return Boolean(item.id) && added.id === item.id;
                },
              );
            })
            .map((item: { value: string }): string => {
              return item.value;
            }),
          ...data.adding.map((item: { value: string }): string => {
            return item.value;
          }),
        ],
        entityType: data.watchlist.entityType,
      }),
    );

    if (sizeProblem) {
      throw new BadDataException(sizeProblem);
    }
  }

  private static assertValueFits(data: {
    value: unknown;
    note: unknown;
    watchlist: SecurityWatchlist;
  }): void {
    const problem: string | null =
      getSecurityWatchlistValueProblem({
        value: data.value,
        entityType: data.watchlist.entityType,
      }) || getSecurityWatchlistNoteProblem(data.note);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * The list's count, as it stands: read again after every write rather
   * than added to, so a write that failed half way, or two at once, leave
   * it right.
   */
  public async recountWatchlist(watchlistId: ObjectID): Promise<number> {
    const count: PositiveNumber = await this.countBy({
      query: {
        securityWatchlistId: watchlistId,
      },
      props: {
        isRoot: true,
      },
    });

    await SecurityWatchlistService.updateOneById({
      id: watchlistId,
      data: {
        valueCount: count.toNumber(),
      },
      props: {
        isRoot: true,
      },
    });

    return count.toNumber();
  }

  // Each list's count after a write that touched them; a failure is logged, never the write's.
  private async recountWatchlists(watchlistIds: Array<string>): Promise<void> {
    for (const watchlistId of Array.from(new Set(watchlistIds))) {
      try {
        await this.recountWatchlist(new ObjectID(watchlistId));
      } catch (error) {
        logger.error(
          `SecurityWatchlistItemService: could not count the values of watchlist ${watchlistId}:`,
        );
        logger.error(error);
      }
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: JSONObject = createBy.data as unknown as JSONObject;
    const watchlistId: string | null | undefined = getWrittenWatchlistId(data);

    if (!watchlistId) {
      throw new BadDataException("Choose the watchlist the value goes on.");
    }

    const watchlist: SecurityWatchlist = await this.readWatchlist(
      new ObjectID(watchlistId),
    );

    Service.assertKeptByHand(watchlist);

    createBy.data.value = normalizeSecurityWatchlistValue(createBy.data.value);

    if (createBy.data.note !== undefined && createBy.data.note !== null) {
      createBy.data.note = normalizeSecurityWatchlistNote(createBy.data.note);
    }

    Service.assertValueFits({
      value: createBy.data.value,
      note: createBy.data.note,
      watchlist,
    });

    // The list by its id column, however the write named it.
    RelationIdUtil.stamp(
      data as unknown as Record<string, unknown>,
      ["securityWatchlistId", "securityWatchlist"],
      new ObjectID(watchlistId),
    );

    const existing: Array<Model> = await this.readListValues(
      new ObjectID(watchlistId),
    );

    Service.assertListTakes({
      watchlist,
      existing: existing.map((item: Model) => {
        return { id: item.id?.toString(), value: item.value || "" };
      }),
      adding: [{ value: createBy.data.value }],
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.securityWatchlistId) {
      await this.recountWatchlists([
        createdItem.securityWatchlistId.toString(),
      ]);
    }

    return createdItem;
  }

  /*
   * A value changed is checked as a new one is, against its own list and
   * the list's other values. A value never moves to another list (its list
   * takes no update).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["value"] !== undefined) {
      data["value"] = normalizeSecurityWatchlistValue(data["value"]);
    }

    if (typeof data["note"] === "string") {
      data["note"] = normalizeSecurityWatchlistNote(data["note"]);
    }

    if (data["value"] === undefined && data["note"] === undefined) {
      return { updateBy, carryForward: null };
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        securityWatchlistId: true,
        value: true,
        note: true,
      },
    );

    if (data["value"] !== undefined && rows.length > 1) {
      throw new BadDataException(
        "A watchlist holds each value once: change one value at a time.",
      );
    }

    for (const row of rows) {
      if (!row.securityWatchlistId) {
        continue;
      }

      const watchlist: SecurityWatchlist = await this.readWatchlist(
        row.securityWatchlistId,
      );

      const value: unknown =
        data["value"] !== undefined ? data["value"] : row.value;

      Service.assertValueFits({
        value,
        note: data["note"] !== undefined ? data["note"] : row.note,
        watchlist,
      });

      if (data["value"] !== undefined) {
        const existing: Array<Model> = await this.readListValues(
          row.securityWatchlistId,
        );

        Service.assertListTakes({
          watchlist,
          existing: existing.map((item: Model) => {
            return { id: item.id?.toString(), value: item.value || "" };
          }),
          adding: [{ id: row.id?.toString(), value: String(value || "") }],
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  // The lists whose values a delete removes, for their counts after it.
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        securityWatchlistId: true,
      },
    );

    const watchlistIds: Array<string> = rows
      .map((row: Model): string => {
        return row.securityWatchlistId?.toString() || "";
      })
      .filter(Boolean);

    return { deleteBy, carryForward: watchlistIds };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const watchlistIds: Array<string> = Array.isArray(onDelete.carryForward)
      ? (onDelete.carryForward as Array<string>)
      : [];

    await this.recountWatchlists(watchlistIds);

    return onDelete;
  }

  /*
   * IMPORT: a file or a paste of values (parseSecurityWatchlistImport) put
   * on a list the team keeps - added to what it holds, or replacing it.
   *
   * `props` are the caller's: the list is read as them (a list they cannot
   * read is not found), and the values a replace removes are deleted as
   * them, through the delete every value goes through. The API has already
   * asked that they may add values (and remove them, for a replace).
   *
   * New values are written in batches rather than one create each - an
   * import is thousands of values, each already checked here - and each
   * is audited as a create is. Lines that are not values of the list are
   * left out and named in the answer; a list the import would take past
   * its limits is refused whole, and so is a replace with nothing in it
   * (to empty a list, delete its values).
   */
  @CaptureSpan()
  public async importValues(data: {
    watchlistId: ObjectID;
    text: string;
    mode: SecurityWatchlistImportMode;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityWatchlistImportSummary> {
    if ((data.text || "").length > SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS) {
      throw new BadDataException(
        "An import is at most 4 MB. Split the file, or import it in parts.",
      );
    }

    const watchlist: SecurityWatchlist | null =
      await SecurityWatchlistService.findOneById({
        id: data.watchlistId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          entityType: true,
          source: true,
        },
        props: data.props,
      });

    if (!watchlist || !watchlist.id || !watchlist.projectId) {
      throw new BadDataException("Watchlist not found.");
    }

    Service.assertKeptByHand(watchlist);

    const parsed: SecurityWatchlistImportResult = parseSecurityWatchlistImport({
      text: data.text,
      entityType: watchlist.entityType,
    });

    if (
      data.mode === SecurityWatchlistImportMode.Replace &&
      parsed.values.length === 0
    ) {
      throw new BadDataException(
        "The import has no values to replace the list with. To empty a list, delete its values.",
      );
    }

    const existing: Array<Model> = await this.readListValues(watchlist.id);
    const existingByKey: Map<string, Model> = new Map();

    for (const item of existing) {
      existingByKey.set(getSecurityWatchlistValueKey(item.value), item);
    }

    const importedKeys: Set<string> = new Set(
      parsed.values.map((item: SecurityWatchlistImportValue): string => {
        return getSecurityWatchlistValueKey(item.value);
      }),
    );

    const toAdd: Array<SecurityWatchlistImportValue> = parsed.values.filter(
      (item: SecurityWatchlistImportValue): boolean => {
        return !existingByKey.has(getSecurityWatchlistValueKey(item.value));
      },
    );

    const toRemove: Array<Model> =
      data.mode === SecurityWatchlistImportMode.Replace
        ? existing.filter((item: Model): boolean => {
            return !importedKeys.has(getSecurityWatchlistValueKey(item.value));
          })
        : [];

    const kept: Array<Model> = existing.filter((item: Model): boolean => {
      return !toRemove.includes(item);
    });

    // The list as the import leaves it, within its limits.
    const sizeProblem: string | null = getSecurityWatchlistSizeProblem(
      countSecurityWatchlistValues({
        values: [
          ...kept.map((item: Model): string => {
            return item.value || "";
          }),
          ...toAdd.map((item: SecurityWatchlistImportValue): string => {
            return item.value;
          }),
        ],
        entityType: watchlist.entityType,
      }),
    );

    if (sizeProblem) {
      throw new BadDataException(sizeProblem);
    }

    if (toRemove.length > 0) {
      await this.deleteBy({
        query: {
          projectId: watchlist.projectId,
          securityWatchlistId: watchlist.id,
          _id: new Includes(
            toRemove.map((item: Model): string => {
              return item.id!.toString();
            }),
          ),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });
    }

    try {
      await this.insertImportedValues({
        watchlist,
        values: toAdd,
        props: data.props,
      });
    } finally {
      // Whatever was written, the count says so.
      await this.recountWatchlists([watchlist.id.toString()]);
    }

    const valueCount: number = (
      await this.countBy({
        query: {
          securityWatchlistId: watchlist.id,
        },
        props: {
          isRoot: true,
        },
      })
    ).toNumber();

    return {
      added: toAdd.length,
      removed: toRemove.length,
      unchanged: parsed.values.length - toAdd.length,
      duplicates: parsed.duplicates,
      problems: parsed.problems.slice(
        0,
        SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN,
      ),
      problemCount: parsed.problems.length,
      valueCount,
    };
  }

  // An import's new values: written in batches, each audited as a create.
  private async insertImportedValues(data: {
    watchlist: SecurityWatchlist;
    values: Array<SecurityWatchlistImportValue>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const created: Array<Model> = [];

    for (
      let start: number = 0;
      start < data.values.length;
      start += IMPORT_INSERT_BATCH_SIZE
    ) {
      const batch: Array<Model> = data.values
        .slice(start, start + IMPORT_INSERT_BATCH_SIZE)
        .map((item: SecurityWatchlistImportValue): Model => {
          const row: Model = new Model();
          row.projectId = data.watchlist.projectId!;
          row.securityWatchlistId = data.watchlist.id!;
          row.value = item.value;

          if (item.note) {
            row.note = item.note;
          }

          if (data.props.userId) {
            row.createdByUserId = data.props.userId;
          }

          return row;
        });

      const repository: BatchInsert =
        this.getRepository() as unknown as BatchInsert;
      const result: { identifiers: Array<JSONObject> } =
        await repository.insert(batch);

      batch.forEach((row: Model, index: number): void => {
        const identifier: JSONObject | undefined = result.identifiers[index];

        if (identifier && identifier["_id"]) {
          row._id = String(identifier["_id"]);
        }

        created.push(row);
      });
    }

    // Each new value in the audit log, as a value added by hand would be.
    for (
      let start: number = 0;
      start < created.length;
      start += IMPORT_AUDIT_CONCURRENCY
    ) {
      await Promise.all(
        created
          .slice(start, start + IMPORT_AUDIT_CONCURRENCY)
          .map(async (row: Model): Promise<void> => {
            await AuditLogService.recordCreate({
              model: this.getModel(),
              createdItem: row,
              props: data.props,
            });
          }),
      );
    }
  }
}

export default new Service();
