import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import { XCP_NG_INVENTORY_SELECT } from "../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * THE READS OF AN XCP-NG POOL'S INVENTORY: its hosts, VMs, storage
 * repositories and virtual disks (XcpNgResource), as the pool's pages read
 * them through ModelAPI - every column they draw (XCP_NG_INVENTORY_SELECT),
 * by name. Apart from the pure helpers (Pages/XcpNg/Utils), so the rules,
 * the lists' words and the topology never pull in an API client.
 */

async function listRows(
  query: Record<string, unknown>,
  limit: number = LIMIT_PER_PROJECT,
  extraSelect: Record<string, boolean> = {},
): Promise<Array<XcpNgResource>> {
  const result: ListResult<XcpNgResource> =
    await ModelAPI.getList<XcpNgResource>({
      modelType: XcpNgResource,
      query: query,
      skip: 0,
      limit: limit,
      // The lists' own select, unless the page asks for more.
      select:
        Object.keys(extraSelect).length > 0
          ? { ...XCP_NG_INVENTORY_SELECT, ...extraSelect }
          : XCP_NG_INVENTORY_SELECT,
      sort: {
        name: SortOrder.Ascending,
      },
    });
  return result.data;
}

/**
 * Every inventory row of a pool, or those of one kind: what exists in the
 * pool now, the same rows the side menu's counts are recounted from, so a
 * page can never disagree with its badge.
 */
export async function fetchXcpNgInventoryRows(options: {
  xcpNgPoolId: ObjectID;
  kind?: XcpNgResourceKind | undefined;
}): Promise<Array<XcpNgResource>> {
  const query: Record<string, unknown> = {
    xcpNgPoolId: options.xcpNgPoolId,
  };
  if (options.kind) {
    query["kind"] = options.kind;
  }
  return listRows(query);
}

/**
 * One object by its UUID (the detail route's parameter), or null when the
 * pool no longer reports it or never did.
 */
export async function fetchXcpNgInventoryRow(options: {
  xcpNgPoolId: ObjectID;
  kind: XcpNgResourceKind;
  externalId: string;
  /*
   * What only the part's own page draws - a host's missing patches - on
   * top of what every list does.
   */
  extraSelect?: Record<string, boolean> | undefined;
}): Promise<XcpNgResource | null> {
  const rows: Array<XcpNgResource> = await listRows(
    {
      xcpNgPoolId: options.xcpNgPoolId,
      kind: options.kind,
      externalId: options.externalId,
    },
    1,
    options.extraSelect || {},
  );
  return rows[0] || null;
}

/**
 * What one host holds, in one read: the VMs it runs (control domain
 * included) and its local storage repositories - every row that names it
 * as its host.
 */
export async function fetchXcpNgRowsOnHost(options: {
  xcpNgPoolId: ObjectID;
  hostExternalId: string;
}): Promise<Array<XcpNgResource>> {
  if (!options.hostExternalId) {
    return [];
  }
  return listRows({
    xcpNgPoolId: options.xcpNgPoolId,
    parentHostExternalId: options.hostExternalId,
  });
}

/**
 * A VM's virtual disks, or a storage repository's: the VDI rows that name
 * it.
 */
export async function fetchXcpNgVirtualDisks(options: {
  xcpNgPoolId: ObjectID;
  vmExternalId?: string | undefined;
  storageRepositoryExternalId?: string | undefined;
}): Promise<Array<XcpNgResource>> {
  const query: Record<string, unknown> = {
    xcpNgPoolId: options.xcpNgPoolId,
    kind: XcpNgResourceKind.VDI,
  };
  if (options.vmExternalId) {
    query["vmExternalId"] = options.vmExternalId;
  }
  if (options.storageRepositoryExternalId) {
    query["storageRepositoryExternalId"] = options.storageRepositoryExternalId;
  }
  if (!options.vmExternalId && !options.storageRepositoryExternalId) {
    return [];
  }
  return listRows(query);
}
