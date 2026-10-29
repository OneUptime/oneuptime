import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AffectedResourceKind } from "../../../Types/AffectedResources/AffectedResourceSearch";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { MAX_LINKED_AFFECTED_RESOURCES } from "../../../Types/Workflow/AffectedResourcesSetting";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import {
  AFFECTED_RESOURCE_KIND_SEARCH_SPECS,
  AffectedResourceKindSearchSpec,
  getAffectedResourceKindService,
} from "./AffectedResourceSearch";

/*
 * WHAT A NAME, AN ADDRESS OR AN ID NAMES, ACROSS EVERY KIND OF RESOURCE.
 *
 * Issue #5341: a workflow's Create One Incident or Create One Alert links
 * the record to the resources its Affected Resources setting names - an
 * alert from another tool names its host as "WAN-RTR-01" or "10.0.4.1", not
 * by a OneUptime ID. Each reference is looked for in every kind asked for,
 * whole and without regard to case:
 *
 *   - an ID (a UUID) is the resource with that ID;
 *   - anything else is a resource called so - its name, a network device's
 *     polled address or DNS name, a host's agent-reported name or one of
 *     its addresses, a cloud resource's provider ID ("i-0abc...").
 *
 * A reference can name several resources - a host and a network device
 * both called "core-01" - and every one is linked: that is what was
 * written. Archived resources are not, nor anything the caller may not
 * read: every kind is read with the caller's props, so labels and owned
 * scope hold. Never throws for what it is given; a kind that cannot be
 * read is said once, and a reference nothing matched is said by name.
 */

// One column a reference is compared with, and how.
interface ReferenceColumn {
  column: string;
  // "text": the whole value; "list": one value of a comma-separated list.
  match: "text" | "list";
}

/*
 * The columns besides the name a kind is known by. Kept to identifiers -
 * an address, an agent's host name, a provider's ID - so a reference never
 * links a resource just because a description mentions it.
 */
export const AFFECTED_RESOURCE_REFERENCE_COLUMNS: Readonly<
  Partial<Record<AffectedResourceKind, Array<ReferenceColumn>>>
> = {
  [AffectedResourceKind.Host]: [
    { column: "hostIdentifier", match: "text" },
    { column: "hostIpAddresses", match: "list" },
  ],
  [AffectedResourceKind.NetworkDevice]: [
    { column: "hostname", match: "text" },
    { column: "dnsName", match: "text" },
  ],
  [AffectedResourceKind.CloudResource]: [
    { column: "providerResourceId", match: "text" },
  ],
};

export interface ResolvedAffectedResource {
  kind: AffectedResourceKind;
  id: string;
  name: string;
  // The reference that named it, as written.
  reference: string;
}

export interface AffectedResourceReferenceResolution {
  resolved: Array<ResolvedAffectedResource>;
  // The references nothing readable matched, as written.
  notFound: Array<string>;
  // The kinds the caller may not read, each once.
  unreadableKinds: Array<AffectedResourceKind>;
  // How many matches were past MAX_LINKED_AFFECTED_RESOURCES.
  leftOverCap: number;
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

function readText(row: BaseModel, column: string): string {
  const value: unknown = (row as unknown as Record<string, unknown>)[column];

  return typeof value === "string" ? value : "";
}

// The values a comma-separated list holds, each trimmed and lower-cased.
function readListValues(text: string): Array<string> {
  return text
    .split(",")
    .map((value: string): string => {
      return value.trim().toLowerCase();
    })
    .filter((value: string): boolean => {
      return value.length > 0;
    });
}

export default class AffectedResourceReferences {
  // The columns a kind's references are compared with: its name, then more.
  public static getReferenceColumns(
    kind: AffectedResourceKind,
  ): Array<ReferenceColumn> {
    return [
      { column: "name", match: "text" },
      ...(AFFECTED_RESOURCE_REFERENCE_COLUMNS[kind] || []),
    ];
  }

  // Which of `references` this row matches, by any of the kind's columns.
  public static getMatchedReferences(data: {
    kind: AffectedResourceKind;
    row: BaseModel;
    references: Array<string>;
  }): Array<string> {
    const id: string = data.row._id?.toString().toLowerCase() || "";
    const values: Set<string> = new Set<string>();

    for (const column of AffectedResourceReferences.getReferenceColumns(
      data.kind,
    )) {
      const text: string = readText(data.row, column.column);

      if (column.match === "list") {
        for (const value of readListValues(text)) {
          values.add(value);
        }
      } else if (text.trim()) {
        values.add(text.trim().toLowerCase());
      }
    }

    return data.references.filter((reference: string): boolean => {
      const key: string = reference.trim().toLowerCase();

      return key === id || values.has(key);
    });
  }

  /*
   * The resources the references name, in the order of the kinds asked for
   * and, within a kind, by name. Each resource once, at most
   * MAX_LINKED_AFFECTED_RESOURCES of them.
   */
  public static async resolve(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    references: Array<string>;
    kinds: Array<AffectedResourceKind>;
  }): Promise<AffectedResourceReferenceResolution> {
    const resolution: AffectedResourceReferenceResolution = {
      resolved: [],
      notFound: [],
      unreadableKinds: [],
      leftOverCap: 0,
    };

    const references: Array<string> = data.references
      .map((reference: string): string => {
        return reference.trim();
      })
      .filter((reference: string): boolean => {
        return reference.length > 0;
      });

    if (references.length === 0) {
      return resolution;
    }

    const ids: Array<string> = references
      .filter((reference: string): boolean => {
        return ObjectID.isValidUUID(reference);
      })
      .map((reference: string): string => {
        return reference.toLowerCase();
      });

    const names: Array<string> = references.filter(
      (reference: string): boolean => {
        return !ObjectID.isValidUUID(reference);
      },
    );

    const matchedReferences: Set<string> = new Set<string>();
    const seen: Set<string> = new Set<string>();

    const perKind: Array<Array<BaseModel> | null> = await Promise.all(
      data.kinds.map(
        (kind: AffectedResourceKind): Promise<Array<BaseModel> | null> => {
          return AffectedResourceReferences.readKind({
            kind: kind,
            projectId: data.projectId,
            props: data.props,
            ids: ids,
            names: names,
          });
        },
      ),
    );

    data.kinds.forEach((kind: AffectedResourceKind, index: number) => {
      const rows: Array<BaseModel> | null = perKind[index] || null;

      if (rows === null) {
        if (!resolution.unreadableKinds.includes(kind)) {
          resolution.unreadableKinds.push(kind);
        }
        return;
      }

      for (const row of rows) {
        const id: string = row._id?.toString().toLowerCase() || "";

        if (!ObjectID.isValidUUID(id)) {
          continue;
        }

        const matched: Array<string> =
          AffectedResourceReferences.getMatchedReferences({
            kind: kind,
            row: row,
            references: references,
          });

        if (matched.length === 0) {
          continue;
        }

        for (const reference of matched) {
          matchedReferences.add(reference);
        }

        const key: string = `${kind}:${id}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        if (resolution.resolved.length >= MAX_LINKED_AFFECTED_RESOURCES) {
          resolution.leftOverCap++;
          continue;
        }

        resolution.resolved.push({
          kind: kind,
          id: id,
          name: readText(row, "name").trim(),
          reference: matched[0]!,
        });
      }
    });

    resolution.notFound = references.filter((reference: string): boolean => {
      return !matchedReferences.has(reference);
    });

    return resolution;
  }

  /*
   * The resources of one kind any reference names: by ID, and by each
   * column the kind is known by. Null when the caller may not read the
   * kind; an empty list when reading it failed, which is logged.
   */
  private static async readKind(data: {
    kind: AffectedResourceKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    ids: Array<string>;
    names: Array<string>;
  }): Promise<Array<BaseModel> | null> {
    const spec: AffectedResourceKindSearchSpec =
      AFFECTED_RESOURCE_KIND_SEARCH_SPECS[data.kind];
    const model: BaseModel = new spec.modelType();
    const columns: Array<ReferenceColumn> =
      AffectedResourceReferences.getReferenceColumns(data.kind).filter(
        (column: ReferenceColumn): boolean => {
          return model.hasColumn(column.column);
        },
      );

    const select: JSONObject = { _id: true };

    for (const column of columns) {
      select[column.column] = true;
    }

    const baseQuery: JSONObject = {
      projectId: data.projectId as unknown as JSONObject,
    };

    if (model.hasColumn("isArchived")) {
      baseQuery["isArchived"] = false;
    }

    const queries: Array<JSONObject> = [];

    if (data.ids.length > 0) {
      queries.push({
        ...baseQuery,
        _id: new Includes(data.ids) as unknown as JSONObject,
      });
    }

    if (data.names.length > 0) {
      for (const column of columns) {
        queries.push({
          ...baseQuery,
          [column.column]: (column.match === "list"
            ? QueryHelper.listsAnyOf(data.names)
            : QueryHelper.findWithSameTextAnyOf(
                data.names,
              )) as unknown as JSONObject,
        });
      }
    }

    if (queries.length === 0) {
      return [];
    }

    const service: {
      findBy: (data: unknown) => Promise<Array<BaseModel>>;
    } = getAffectedResourceKindService(data.kind);

    try {
      const found: Array<Array<BaseModel>> = await Promise.all(
        queries.map((query: JSONObject): Promise<Array<BaseModel>> => {
          return service.findBy({
            query: query,
            select: select,
            sort: { name: SortOrder.Ascending },
            skip: 0,
            limit: MAX_LINKED_AFFECTED_RESOURCES + 1,
            props: data.props,
          });
        }),
      );

      const rows: Array<BaseModel> = [];
      const ids: Set<string> = new Set<string>();

      for (const bucket of found) {
        for (const row of bucket) {
          const id: string = row._id?.toString() || "";

          if (id && !ids.has(id)) {
            ids.add(id);
            rows.push(row);
          }
        }
      }

      return rows.sort((a: BaseModel, b: BaseModel): number => {
        return readText(a, "name").localeCompare(readText(b, "name"));
      });
    } catch (error) {
      if (isRefusal(error)) {
        return null;
      }

      logger.error(
        `Affected resources could not be looked up in ${data.kind}: ${error}`,
      );

      return [];
    }
  }
}
