import DataAssetOwnerTeam from "../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataPipelineOwnerTeam from "../../../Models/DatabaseModels/DataPipelineOwnerTeam";
import DataPipelineOwnerUser from "../../../Models/DatabaseModels/DataPipelineOwnerUser";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DATA_ATTENTION_KIND_ORDER,
  DataAttentionItem,
  DataAttentionKind,
  getDataAttentionOwnerKey,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssueOwner,
  DataObservabilityIssuesRequest,
  DataObservabilityIssuesResponse,
  DataObservabilityStoreSummary,
  DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE,
  MAX_DATA_OBSERVABILITY_ISSUES_PAGE,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DataAssetOwnerTeamService from "../../Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../Services/DataAssetOwnerUserService";
import DataPipelineOwnerTeamService from "../../Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "../../Services/DataPipelineOwnerUserService";
import DataProductService from "../../Services/DataProductService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * THE ISSUES PAGE: EVERYTHING THAT NEEDS SOMEONE, FILTERED (#6549).
 *
 * The Overview's Needs Attention shows the twenty most urgent items; Issues
 * lists every one, worst first, a page at a time, filtered on the server:
 *
 *   - by kind (a failed run, a failing check, a late table, ...);
 *   - by database: the database itself, its tables and their checks;
 *   - by owner: someone who owns the item - a table's owners, and a
 *     check's through its table, a pipeline's (#6551) and a data product's -
 *     or No owner, for what can have owners and has none;
 *   - by whether anyone was told: an alert about it is open, or none is.
 *
 * The items are the attention reader's, read as whoever asked
 * (DataObservabilityAttentionReader, DataObservabilityReadScope), so a
 * private alert is named only to those who may see it and a narrowed role
 * lists only what it may read. Owners are read with the caller's own
 * permissions too, as the rows' own owner lines are: someone who may not read
 * who owns a table is offered no owner to filter by, and filtering by owner
 * finds nothing for them.
 */

// The most owner rows read for one page: far more than the items' owners.
const MAX_OWNER_ROWS_READ: number = 5_000;

// Each owned item's owners, by its owner key ("asset:<id>"); null for a kind whose owners could not be read.
export type IssueOwnersByKey = Map<
  string,
  Array<DataObservabilityIssueOwner>
> | null;

interface OwnerRow {
  subjectKey: string;
  owner: DataObservabilityIssueOwner;
}

function userOwner(user: User | undefined): DataObservabilityIssueOwner | null {
  if (!user?.id) {
    return null;
  }

  return {
    key: `user:${user.id.toString()}`,
    kind: "user",
    id: user.id.toString(),
    name: user.name?.toString() || user.email?.toString() || "",
  };
}

function teamOwner(team: Team | undefined): DataObservabilityIssueOwner | null {
  if (!team?.id) {
    return null;
  }

  return {
    key: `team:${team.id.toString()}`,
    kind: "team",
    id: team.id.toString(),
    name: team.name?.toString() || "",
  };
}

// The owner filter's value: an owner's key, or No owner.
export function isIssueOwnerFilter(value: string): boolean {
  if (value === DATA_OBSERVABILITY_NO_OWNER_FILTER) {
    return true;
  }

  const [kind, id] = value.split(":");

  return (
    (kind === "user" || kind === "team") &&
    typeof id === "string" &&
    ObjectID.isValidUUID(id) &&
    value.split(":").length === 2
  );
}

export default class DataObservabilityIssues {
  // What a request asks for, its filters checked: a malformed one is refused, never read as no filter.
  public static readRequest(body: JSONObject): DataObservabilityIssuesRequest {
    const request: DataObservabilityIssuesRequest = {};

    if (body["kinds"] !== undefined && body["kinds"] !== null) {
      if (!Array.isArray(body["kinds"])) {
        throw new BadDataException("Name the kinds as a list.");
      }

      const given: Array<unknown> = body["kinds"] as Array<unknown>;

      /*
       * An empty list asks for every kind. A kind this server does not know
       * - a newer page's - matches nothing, rather than everything.
       */
      if (given.length > 0) {
        request.kinds = given.filter(
          (kind: unknown): kind is DataAttentionKind => {
            return (
              typeof kind === "string" &&
              (DATA_ATTENTION_KIND_ORDER as ReadonlyArray<string>).includes(
                kind,
              )
            );
          },
        );
      }
    }

    if (body["dataStoreId"] !== undefined && body["dataStoreId"] !== null) {
      if (
        typeof body["dataStoreId"] !== "string" ||
        !ObjectID.isValidUUID(body["dataStoreId"])
      ) {
        throw new BadDataException("Name the database by its ID.");
      }

      request.dataStoreId = body["dataStoreId"];
    }

    if (body["owner"] !== undefined && body["owner"] !== null) {
      if (typeof body["owner"] !== "string" || !isIssueOwnerFilter(body["owner"])) {
        throw new BadDataException(
          'Name the owner as "user:<id>" or "team:<id>", or "none" for no owner.',
        );
      }

      request.owner = body["owner"];
    }

    if (body["alert"] !== undefined && body["alert"] !== null) {
      if (
        !(Object.values(DataObservabilityIssueAlertFilter) as Array<unknown>).includes(
          body["alert"],
        )
      ) {
        throw new BadDataException(
          'Say whether an alert is open: "open" or "none".',
        );
      }

      request.alert = body["alert"] as DataObservabilityIssueAlertFilter;
    }

    const skip: unknown = body["skip"];
    const limit: unknown = body["limit"];

    request.skip =
      typeof skip === "number" && Number.isInteger(skip) && skip > 0
        ? skip
        : 0;
    request.limit =
      typeof limit === "number" && Number.isInteger(limit) && limit > 0
        ? Math.min(limit, MAX_DATA_OBSERVABILITY_ISSUES_PAGE)
        : DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE;

    return request;
  }

  // Whether an item is about this database: the database itself, a table of it, or a check of one.
  public static isOfStore(data: {
    item: DataAttentionItem;
    dataStoreId: string;
    storeIdByCheckId: Map<string, string>;
  }): boolean {
    if (data.item.dataStoreId === data.dataStoreId) {
      return true;
    }

    return Boolean(
      data.item.dataCheckId &&
        data.storeIdByCheckId.get(data.item.dataCheckId) === data.dataStoreId,
    );
  }

  /*
   * Whether an item has the owner the filter names. An item nothing can own
   * here - a database, a reconciliation - matches no owner filter, and one
   * whose owners could not be read is never called ownerless.
   */
  public static hasOwner(data: {
    item: DataAttentionItem;
    owner: string;
    ownersByKey: IssueOwnersByKey;
  }): boolean {
    const key: string | null = getDataAttentionOwnerKey(data.item);

    if (!key || !data.ownersByKey) {
      return false;
    }

    const owners: Array<DataObservabilityIssueOwner> | undefined =
      data.ownersByKey.get(key);

    if (owners === undefined) {
      // Not read: not known to have none.
      return false;
    }

    if (data.owner === DATA_OBSERVABILITY_NO_OWNER_FILTER) {
      return owners.length === 0;
    }

    return owners.some((owner: DataObservabilityIssueOwner): boolean => {
      return owner.key === data.owner;
    });
  }

  // The items that match every filter, in the order given: worst first.
  public static filter(data: {
    items: Array<DataAttentionItem>;
    request: DataObservabilityIssuesRequest;
    storeIdByCheckId: Map<string, string>;
    ownersByKey: IssueOwnersByKey;
  }): Array<DataAttentionItem> {
    const { request } = data;

    return data.items.filter((item: DataAttentionItem): boolean => {
      if (request.kinds && !request.kinds.includes(item.kind)) {
        return false;
      }

      if (
        request.dataStoreId &&
        !this.isOfStore({
          item,
          dataStoreId: request.dataStoreId,
          storeIdByCheckId: data.storeIdByCheckId,
        })
      ) {
        return false;
      }

      if (
        request.alert === DataObservabilityIssueAlertFilter.Open &&
        !item.alert
      ) {
        return false;
      }

      if (
        request.alert === DataObservabilityIssueAlertFilter.None &&
        item.alert
      ) {
        return false;
      }

      if (
        request.owner &&
        !this.hasOwner({
          item,
          owner: request.owner,
          ownersByKey: data.ownersByKey,
        })
      ) {
        return false;
      }

      return true;
    });
  }

  public static async answer(data: {
    request: DataObservabilityIssuesRequest;
    items: Array<DataAttentionItem>;
    storeIdByCheckId: Map<string, string>;
    stores: Array<DataObservabilityStoreSummary>;
    reader: DatabaseCommonInteractionProps;
  }): Promise<DataObservabilityIssuesResponse> {
    const ownersByKey: IssueOwnersByKey = await this.readOwners({
      items: data.items,
      reader: data.reader,
    });
    const matching: Array<DataAttentionItem> = this.filter({
      items: data.items,
      request: data.request,
      storeIdByCheckId: data.storeIdByCheckId,
      ownersByKey,
    });
    const skip: number = data.request.skip || 0;
    const limit: number =
      data.request.limit || DEFAULT_DATA_OBSERVABILITY_ISSUES_PAGE;

    return {
      items: matching.slice(skip, skip + limit),
      count: matching.length,
      totalCount: data.items.length,
      skip,
      limit,
      stores: data.stores,
      owners: this.getOwnerChoices(ownersByKey),
    };
  }

  // Everyone who owns one of the items, each once, by name.
  public static getOwnerChoices(
    ownersByKey: IssueOwnersByKey,
  ): Array<DataObservabilityIssueOwner> {
    const byKey: Map<string, DataObservabilityIssueOwner> = new Map();

    for (const owners of ownersByKey?.values() || []) {
      for (const owner of owners) {
        if (!byKey.has(owner.key)) {
          byKey.set(owner.key, owner);
        }
      }
    }

    return Array.from(byKey.values()).sort(
      (a: DataObservabilityIssueOwner, b: DataObservabilityIssueOwner) => {
        return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
      },
    );
  }

  /*
   * Who owns each item that can have owners, read with the caller's own
   * permissions. A kind whose owners the caller may not read leaves the
   * whole answer unknown (null): no owner choices, and an owner filter
   * that finds nothing, rather than every item called ownerless.
   */
  public static async readOwners(data: {
    items: Array<DataAttentionItem>;
    reader: DatabaseCommonInteractionProps;
  }): Promise<IssueOwnersByKey> {
    const assetIds: Set<string> = new Set();
    const pipelineIds: Set<string> = new Set();
    const productIds: Set<string> = new Set();

    for (const item of data.items) {
      const key: string | null = getDataAttentionOwnerKey(item);

      if (!key) {
        continue;
      }

      const [kind, id] = key.split(":") as [string, string];

      if (kind === "asset") {
        assetIds.add(id);
      } else if (kind === "pipeline") {
        pipelineIds.add(id);
      } else if (kind === "product") {
        productIds.add(id);
      }
    }

    const ownersByKey: Map<string, Array<DataObservabilityIssueOwner>> =
      new Map();

    // Every owned item is known to have none until a row says otherwise.
    for (const id of assetIds) {
      ownersByKey.set(`asset:${id}`, []);
    }

    for (const id of pipelineIds) {
      ownersByKey.set(`pipeline:${id}`, []);
    }

    for (const id of productIds) {
      ownersByKey.set(`product:${id}`, []);
    }

    try {
      const rows: Array<OwnerRow> = [
        ...(await this.readAssetOwners(Array.from(assetIds), data.reader)),
        ...(await this.readPipelineOwners(
          Array.from(pipelineIds),
          data.reader,
        )),
        ...(await this.readProductOwners(Array.from(productIds), data.reader)),
      ];

      for (const row of rows) {
        const owners: Array<DataObservabilityIssueOwner> =
          ownersByKey.get(row.subjectKey) || [];

        if (
          !owners.some((owner: DataObservabilityIssueOwner): boolean => {
            return owner.key === row.owner.key;
          })
        ) {
          owners.push(row.owner);
        }

        ownersByKey.set(row.subjectKey, owners);
      }
    } catch (error) {
      logger.debug(
        `Data Observability: the owners of the issues could not be read for this caller: ${error}`,
      );
      return null;
    }

    return ownersByKey;
  }

  private static async readAssetOwners(
    ids: Array<string>,
    reader: DatabaseCommonInteractionProps,
  ): Promise<Array<OwnerRow>> {
    if (ids.length === 0) {
      return [];
    }

    const [users, teams]: [Array<DataAssetOwnerUser>, Array<DataAssetOwnerTeam>] =
      await Promise.all([
        DataAssetOwnerUserService.findBy({
          query: { dataAssetId: QueryHelper.any(ids) },
          select: {
            dataAssetId: true,
            user: { _id: true, name: true, email: true },
          },
          skip: 0,
          limit: MAX_OWNER_ROWS_READ,
          props: reader,
        }),
        DataAssetOwnerTeamService.findBy({
          query: { dataAssetId: QueryHelper.any(ids) },
          select: { dataAssetId: true, team: { _id: true, name: true } },
          skip: 0,
          limit: MAX_OWNER_ROWS_READ,
          props: reader,
        }),
      ]);

    return [
      ...users.map((row: DataAssetOwnerUser): OwnerRow | null => {
        const owner: DataObservabilityIssueOwner | null = userOwner(row.user);
        return owner && row.dataAssetId
          ? { subjectKey: `asset:${row.dataAssetId.toString()}`, owner }
          : null;
      }),
      ...teams.map((row: DataAssetOwnerTeam): OwnerRow | null => {
        const owner: DataObservabilityIssueOwner | null = teamOwner(row.team);
        return owner && row.dataAssetId
          ? { subjectKey: `asset:${row.dataAssetId.toString()}`, owner }
          : null;
      }),
    ].filter((row: OwnerRow | null): row is OwnerRow => {
      return row !== null;
    });
  }

  private static async readPipelineOwners(
    ids: Array<string>,
    reader: DatabaseCommonInteractionProps,
  ): Promise<Array<OwnerRow>> {
    if (ids.length === 0) {
      return [];
    }

    const [users, teams]: [
      Array<DataPipelineOwnerUser>,
      Array<DataPipelineOwnerTeam>,
    ] = await Promise.all([
      DataPipelineOwnerUserService.findBy({
        query: { dataPipelineId: QueryHelper.any(ids) },
        select: {
          dataPipelineId: true,
          user: { _id: true, name: true, email: true },
        },
        skip: 0,
        limit: MAX_OWNER_ROWS_READ,
        props: reader,
      }),
      DataPipelineOwnerTeamService.findBy({
        query: { dataPipelineId: QueryHelper.any(ids) },
        select: { dataPipelineId: true, team: { _id: true, name: true } },
        skip: 0,
        limit: MAX_OWNER_ROWS_READ,
        props: reader,
      }),
    ]);

    return [
      ...users.map((row: DataPipelineOwnerUser): OwnerRow | null => {
        const owner: DataObservabilityIssueOwner | null = userOwner(row.user);
        return owner && row.dataPipelineId
          ? { subjectKey: `pipeline:${row.dataPipelineId.toString()}`, owner }
          : null;
      }),
      ...teams.map((row: DataPipelineOwnerTeam): OwnerRow | null => {
        const owner: DataObservabilityIssueOwner | null = teamOwner(row.team);
        return owner && row.dataPipelineId
          ? { subjectKey: `pipeline:${row.dataPipelineId.toString()}`, owner }
          : null;
      }),
    ].filter((row: OwnerRow | null): row is OwnerRow => {
      return row !== null;
    });
  }

  private static async readProductOwners(
    ids: Array<string>,
    reader: DatabaseCommonInteractionProps,
  ): Promise<Array<OwnerRow>> {
    if (ids.length === 0) {
      return [];
    }

    const products: Array<DataProduct> = await DataProductService.findBy({
      query: { _id: QueryHelper.any(ids) },
      select: {
        _id: true,
        ownerUser: { _id: true, name: true, email: true },
        ownerTeam: { _id: true, name: true },
      },
      skip: 0,
      limit: ids.length,
      props: reader,
    });
    const rows: Array<OwnerRow> = [];

    for (const product of products) {
      if (!product.id) {
        continue;
      }

      const subjectKey: string = `product:${product.id.toString()}`;

      for (const owner of [
        userOwner(product.ownerUser),
        teamOwner(product.ownerTeam),
      ]) {
        if (owner) {
          rows.push({ subjectKey, owner });
        }
      }
    }

    return rows;
  }
}
