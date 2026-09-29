/*
 * Shared access to the workflow /model-schema/:tableName endpoint.
 *
 * Three builder inputs are backed by a model's column list — the field picker
 * for Select arguments, the query builder for Query arguments, and the record
 * form for create/update arguments — and all three want the same fetch, the
 * same loading and error handling, and the same column shape.
 */

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../Types/JSON";
import { WORKFLOW_URL } from "../../Config";
import API from "../../Utils/API/API";
import { useEffect, useState } from "react";

/**
 * A column as the endpoint describes it. `type` is deliberately a bare string
 * rather than the server-side TableColumnType enum, so this file stays on the
 * browser side of the wire format.
 */
export interface ModelSchemaColumn {
  id: string;
  title: string;
  description?: string;
  type: string;
  isRelation: boolean;
  relatedTableName?: string | undefined;
  relatedColumns?: Array<ModelSchemaColumn> | undefined;
  /*
   * Present from the endpoint, absent on anything cached or hand-built before
   * they existed, so every reader must treat them as optional.
   */
  required?: boolean | undefined;
  hasDefault?: boolean | undefined;
  isTenantColumn?: boolean | undefined;
  example?: string | undefined;
  placeholder?: string | undefined;
}

/**
 * Which permission list the endpoint should gate columns on.
 *
 * "read" is the default and is what a Select or Query argument wants. "write"
 * is for create/update payloads, and is not a superset: a write-only column
 * (MonitorSecret.secretValue declares `read: []`) appears only under "write".
 */
export type ModelSchemaAccess = "read" | "write";

export interface ModelSchemaState {
  columns: Array<ModelSchemaColumn> | null;
  isLoading: boolean;
  error: string | null;
}

export type FetchModelSchemaFunction = (
  tableName: string,
  access?: ModelSchemaAccess,
) => Promise<Array<ModelSchemaColumn>>;

export const fetchModelSchema: FetchModelSchemaFunction = async (
  tableName: string,
  access: ModelSchemaAccess = "read",
): Promise<Array<ModelSchemaColumn>> => {
  const url: URL = URL.fromString(WORKFLOW_URL.toString()).addRoute(
    `/model-schema/${encodeURIComponent(tableName)}`,
  );

  /*
   * Only sent when it is not the default, so the read requests the field picker
   * and query builder make keep the exact URL they had.
   */
  if (access === "write") {
    url.addQueryParam("access", "write");
  }

  const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.get<JSONObject>({ url });

  if (result instanceof HTTPErrorResponse) {
    throw result;
  }

  const data: JSONObject = result.data as JSONObject;

  return (data["columns"] as unknown as Array<ModelSchemaColumn>) || [];
};

export type UseModelSchemaFunction = (
  tableName: string | undefined,
  access?: ModelSchemaAccess,
) => ModelSchemaState;

/**
 * Load a model's columns, once per table name.
 *
 * Never throws: a failure leaves `columns` as an empty array and puts the
 * message in `error`, so a caller can fall back to its JSON editor rather than
 * showing the builder a blank panel.
 */
export const useModelSchema: UseModelSchemaFunction = (
  tableName: string | undefined,
  access: ModelSchemaAccess = "read",
): ModelSchemaState => {
  const [columns, setColumns] = useState<Array<ModelSchemaColumn> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(tableName));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tableName) {
      setColumns([]);
      setIsLoading(false);
      return;
    }

    let cancelled: boolean = false;

    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const loaded: Array<ModelSchemaColumn> = await fetchModelSchema(
          tableName,
          access,
        );

        if (cancelled) {
          return;
        }

        setColumns(loaded);
      } catch (err) {
        if (cancelled) {
          return;
        }

        setError(API.getFriendlyMessage(err));
        setColumns([]);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
    // Re-fetches when the gate changes: the two access modes return different columns.
  }, [tableName, access]);

  return { columns: columns, isLoading: isLoading, error: error };
};

/*
 * Column types that hold a single scalar the builder can sensibly type into a
 * box. Everything else (relations, JSON blobs, buffers, monitor steps) needs
 * the JSON editor.
 *
 * These are spelled with the enum, not with string literals, because the wire
 * carries the enum's *values* and several of them differ from the member name
 * that reads like the obvious literal: ShortText is "Text", ObjectID is
 * "Object ID", PositiveNumber is "Positive Number", LongURL is "URL". Written
 * out by hand this list silently classified the two most-declared non-relation
 * types as non-scalar, and the tests that covered it pinned the same mistake.
 */
const SCALAR_COLUMN_TYPES: Array<string> = [
  TableColumnType.ShortText,
  TableColumnType.LongText,
  TableColumnType.VeryLongText,
  TableColumnType.Slug,
  TableColumnType.Email,
  TableColumnType.Phone,
  TableColumnType.Color,
  TableColumnType.Domain,
  TableColumnType.Name,
  TableColumnType.Description,
  TableColumnType.ObjectID,
  TableColumnType.Number,
  TableColumnType.SmallNumber,
  TableColumnType.BigNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.BigPositiveNumber,
  TableColumnType.Boolean,
  TableColumnType.Date,
  TableColumnType.Password,
  TableColumnType.HashedString,
  TableColumnType.Port,
  TableColumnType.LongURL,
  TableColumnType.ShortURL,
  TableColumnType.IP,
  TableColumnType.Version,
  TableColumnType.Markdown,
  TableColumnType.HTML,
  TableColumnType.JavaScript,
  TableColumnType.CSS,
  TableColumnType.OTP,
];

const NUMERIC_COLUMN_TYPES: Array<string> = [
  TableColumnType.Number,
  TableColumnType.SmallNumber,
  TableColumnType.BigNumber,
  TableColumnType.PositiveNumber,
  TableColumnType.SmallPositiveNumber,
  TableColumnType.BigPositiveNumber,
  TableColumnType.Port,
];

export type IsScalarColumnFunction = (column: ModelSchemaColumn) => boolean;

export const isScalarColumn: IsScalarColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return !column.isRelation && SCALAR_COLUMN_TYPES.includes(column.type);
};

export type IsNumericColumnFunction = (column: ModelSchemaColumn) => boolean;

export const isNumericColumn: IsNumericColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return !column.isRelation && NUMERIC_COLUMN_TYPES.includes(column.type);
};

export type IsBooleanColumnFunction = (column: ModelSchemaColumn) => boolean;

export const isBooleanColumn: IsBooleanColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return !column.isRelation && column.type === TableColumnType.Boolean;
};

/**
 * Columns a create must be given a value for.
 *
 * Mirrors the server's own rule in DatabaseService.checkRequiredFields —
 * required, minus anything carrying a default — and additionally drops the
 * project column, which the workflow runner stamps itself
 * (ModelArguments.applyTenantColumn) and which a builder must never type.
 * Relations are left out because a row holds one scalar.
 */
export type RequiredWritableColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
) => Array<ModelSchemaColumn>;

export const requiredWritableColumns: RequiredWritableColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
): Array<ModelSchemaColumn> => {
  return columns.filter((column: ModelSchemaColumn) => {
    return (
      Boolean(column.required) &&
      !column.hasDefault &&
      !column.isTenantColumn &&
      !column.isRelation
    );
  });
};

export type FindColumnFunction = (
  columns: Array<ModelSchemaColumn>,
  columnId: string,
) => ModelSchemaColumn | undefined;

export const findColumn: FindColumnFunction = (
  columns: Array<ModelSchemaColumn>,
  columnId: string,
): ModelSchemaColumn | undefined => {
  return columns.find((column: ModelSchemaColumn) => {
    return column.id === columnId;
  });
};
