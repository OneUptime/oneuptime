import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import {
  NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS,
  NetworkDeviceAssetSource,
  getNetworkDeviceManufacturer,
} from "../../../Utils/NetworkDevice/NetworkDeviceAssetFacts";
import { FindOperator, Raw } from "typeorm";

/*
 * THE DEVICES LIST'S VENDOR FILTER, ON THE MAKER THE LIST SHOWS (OneUptime
 * issue #9363).
 *
 * The Vendor / Model column does not show the `vendor` column. It shows the
 * device's asset facts' maker (NetworkDeviceAssetFacts): a vendor saved on
 * the device, else the platform its sysDescr names, else its sysObjectID
 * enterprise's vendor - an SNMP agent's name never counts - else, since
 * #9359, the maker its row on the Discovered Devices list names, kept with
 * its source in `discoveredDetails`. The filter used to compare the `vendor`
 * column alone, so a maker that came from discovery, or one read off the
 * sysDescr, showed in the column and was never found by the filter.
 *
 * The filter now asks the same question of the same function, on the
 * server, the way the Discovered Devices filters do (#9361): the project's
 * devices' maker inputs (NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS) are read
 * a page at a time (buildManufacturerInputsStatement), each device's maker is
 * worked out by getNetworkDeviceManufacturer - the column's own - and the
 * filter becomes a condition on the ids of the devices that match it
 * (buildMatchingIdsCondition). The list, its count and "select every
 * matching device" all read that condition, with every other filter.
 *
 * The maker is worked out in TypeScript rather than in SQL on purpose: the
 * sysObjectID enterprise table and the sysDescr parser it relies on exist
 * only there, and a second copy in SQL would drift from the column.
 */

// The query key the Vendor filter sends.
export const NETWORK_DEVICE_VENDOR_QUERY_KEY: string = "vendor";

// How many devices one read of the inputs returns.
export const MANUFACTURER_INPUTS_PAGE_SIZE: number = 2000;

export type ShownVendorMatcher = (shownVendor: string | undefined) => boolean;

export type ManufacturerInputsQueryRunner = (
  sql: string,
  params: Array<unknown>,
) => Promise<Array<Record<string, unknown>>>;

export interface ManufacturerInputsStatement {
  sql: string;
  params: Array<unknown>;
}

function normalize(value: unknown): string {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase();
}

/*
 * What the Vendor filter's value asks of the maker the list shows, or null
 * when the value is no filter this answers (it is then left on the column,
 * as before). Every comparison ignores case and surrounding spaces, as the
 * column's text operators do; "is not" and "does not contain" also match a
 * device the list names no maker for, as an empty cell is not the maker.
 */
export function readShownVendorMatcher(
  value: unknown,
): ShownVendorMatcher | null {
  const has: (shown: string | undefined) => boolean = (
    shown: string | undefined,
  ): boolean => {
    return normalize(shown).length > 0;
  };

  if (value instanceof IsNull || value === null) {
    return (shown: string | undefined): boolean => {
      return !has(shown);
    };
  }

  if (value instanceof NotNull) {
    return has;
  }

  if (value instanceof Search) {
    const needle: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return has(shown) && normalize(shown).includes(needle);
    };
  }

  if (value instanceof NotContains) {
    const needle: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return !has(shown) || !normalize(shown).includes(needle);
    };
  }

  if (value instanceof StartsWith) {
    const needle: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return has(shown) && normalize(shown).startsWith(needle);
    };
  }

  if (value instanceof EndsWith) {
    const needle: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return has(shown) && normalize(shown).endsWith(needle);
    };
  }

  if (value instanceof EqualTo) {
    const wanted: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return has(shown) && normalize(shown) === wanted;
    };
  }

  if (value instanceof NotEqual) {
    const unwanted: string = normalize(value.toString());
    return (shown: string | undefined): boolean => {
      return !has(shown) || normalize(shown) !== unwanted;
    };
  }

  if (value instanceof Includes) {
    const wanted: Set<string> = new Set<string>(
      value.values.map((item: unknown): string => {
        return normalize(item);
      }),
    );
    return (shown: string | undefined): boolean => {
      return has(shown) && wanted.has(normalize(shown));
    };
  }

  if (typeof value === "string") {
    const wanted: string = normalize(value);
    return (shown: string | undefined): boolean => {
      return has(shown) && normalize(shown) === wanted;
    };
  }

  return null;
}

/*
 * One page of a project's devices, with the columns their maker is worked
 * out from, after `afterDeviceId` in id order. Deleted devices are never
 * listed; archived ones are, and the list's own filter on them still
 * applies beside this one.
 */
export function buildManufacturerInputsStatement(data: {
  projectId: ObjectID;
  afterDeviceId?: string | undefined;
  limit: number;
}): ManufacturerInputsStatement {
  const params: Array<unknown> = [data.projectId.toString()];
  const filters: Array<string> = [
    `d."projectId" = $1::uuid`,
    `d."deletedAt" IS NULL`,
  ];

  if (data.afterDeviceId) {
    params.push(data.afterDeviceId);
    filters.push(`d."_id" > $${params.length}::uuid`);
  }

  params.push(Math.max(1, Math.floor(data.limit)));

  const columns: string = NETWORK_DEVICE_MANUFACTURER_INPUT_COLUMNS.map(
    (column: string): string => {
      return `d."${column}"`;
    },
  ).join(", ");

  return {
    sql: `SELECT d."_id"::text AS "_id", ${columns}
FROM "NetworkDevice" d
WHERE ${filters.join("\n  AND ")}
ORDER BY d."_id" ASC
LIMIT $${params.length}`,
    params: params,
  };
}

/*
 * The ids of the project's devices whose maker, as the list shows it,
 * matches. Reads every device of the project once, a page at a time.
 */
export async function findDeviceIdsByShownVendor(data: {
  projectId: ObjectID;
  matcher: ShownVendorMatcher;
  runQuery: ManufacturerInputsQueryRunner;
  pageSize?: number | undefined;
}): Promise<Array<string>> {
  const pageSize: number = data.pageSize || MANUFACTURER_INPUTS_PAGE_SIZE;
  const matching: Array<string> = [];
  let afterDeviceId: string | undefined = undefined;

  for (;;) {
    const statement: ManufacturerInputsStatement =
      buildManufacturerInputsStatement({
        projectId: data.projectId,
        afterDeviceId: afterDeviceId,
        limit: pageSize,
      });

    const rows: Array<Record<string, unknown>> = await data.runQuery(
      statement.sql,
      statement.params,
    );

    for (const row of rows) {
      const id: string = String(row["_id"] || "");

      if (!id) {
        continue;
      }

      afterDeviceId = id;

      if (
        data.matcher(
          getNetworkDeviceManufacturer(row as NetworkDeviceAssetSource),
        )
      ) {
        matching.push(id);
      }
    }

    if (rows.length < pageSize) {
      return matching;
    }
  }
}

/*
 * The condition the filter becomes: the device is one of these. It is held
 * on the vendor key, where the filter was, and names the row's id through
 * the table alias TypeORM hands it (`NetworkDevice.vendor`), as
 * QueryHelper.multiSearch does; TypeORM quotes both. No ids matches no
 * device.
 */
export function buildMatchingIdsCondition(
  ids: Array<string>,
): FindOperator<unknown> {
  const rid: string = Text.generateRandomText(10);

  return Raw(
    (alias: string): string => {
      const tableAlias: string | undefined = alias.includes(".")
        ? alias.split(".")[0]
        : undefined;
      const idColumn: string = tableAlias ? `${tableAlias}._id` : `_id`;

      return `(${idColumn} = ANY(CAST(:${rid} AS uuid[])))`;
    },
    { [rid]: ids },
  ) as FindOperator<unknown>;
}

/*
 * The project a read is about: the caller's tenant, else the project the
 * query names. Undefined when neither says - a read across projects keeps
 * the column's filter, as there is no single project to read.
 */
export function readQueryProjectId(data: {
  tenantId?: ObjectID | undefined;
  isMultiTenantRequest?: boolean | undefined;
  query: Record<string, unknown>;
}): ObjectID | undefined {
  if (data.tenantId && !data.isMultiTenantRequest) {
    return data.tenantId;
  }

  const projectId: unknown = data.query["projectId"];

  if (projectId instanceof ObjectID) {
    return projectId;
  }

  if (typeof projectId === "string" && ObjectID.isValidUUID(projectId)) {
    return new ObjectID(projectId);
  }

  return undefined;
}

/*
 * The query, with its Vendor filter answered on the maker the list shows. A
 * new query: the one given is left as it was. Unchanged when the query has
 * no Vendor filter, one this does not answer, or no single project.
 */
export async function withShownVendorFilter<TQuery>(data: {
  query: TQuery;
  tenantId?: ObjectID | undefined;
  isMultiTenantRequest?: boolean | undefined;
  runQuery: ManufacturerInputsQueryRunner;
}): Promise<TQuery> {
  if (!data.query || typeof data.query !== "object") {
    return data.query;
  }

  const query: Record<string, unknown> = data.query as Record<string, unknown>;

  if (!(NETWORK_DEVICE_VENDOR_QUERY_KEY in query)) {
    return data.query;
  }

  const value: unknown = query[NETWORK_DEVICE_VENDOR_QUERY_KEY];

  if (value === undefined || value instanceof FindOperator) {
    return data.query;
  }

  const matcher: ShownVendorMatcher | null = readShownVendorMatcher(value);
  const projectId: ObjectID | undefined = readQueryProjectId({
    tenantId: data.tenantId,
    isMultiTenantRequest: data.isMultiTenantRequest,
    query: query,
  });

  if (!matcher || !projectId) {
    return data.query;
  }

  const ids: Array<string> = await findDeviceIdsByShownVendor({
    projectId: projectId,
    matcher: matcher,
    runQuery: data.runQuery,
  });

  return {
    ...query,
    [NETWORK_DEVICE_VENDOR_QUERY_KEY]: buildMatchingIdsCondition(ids),
  } as TQuery;
}
