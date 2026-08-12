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
}

export interface ModelSchemaState {
  columns: Array<ModelSchemaColumn> | null;
  isLoading: boolean;
  error: string | null;
}

export type FetchModelSchemaFunction = (
  tableName: string,
) => Promise<Array<ModelSchemaColumn>>;

export const fetchModelSchema: FetchModelSchemaFunction = async (
  tableName: string,
): Promise<Array<ModelSchemaColumn>> => {
  const url: URL = URL.fromString(WORKFLOW_URL.toString()).addRoute(
    `/model-schema/${encodeURIComponent(tableName)}`,
  );

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
        const loaded: Array<ModelSchemaColumn> =
          await fetchModelSchema(tableName);

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
  }, [tableName]);

  return { columns: columns, isLoading: isLoading, error: error };
};

/*
 * Column types that hold a single scalar the builder can sensibly type into a
 * box. Everything else (relations, JSON blobs, buffers) needs the JSON editor.
 */
const SCALAR_COLUMN_TYPES: Array<string> = [
  "ShortText",
  "LongText",
  "VeryLongText",
  "Slug",
  "Email",
  "Phone",
  "Color",
  "Domain",
  "Name",
  "Description",
  "ObjectID",
  "Number",
  "PositiveNumber",
  "Boolean",
  "Date",
  "Password",
  "HashedString",
  "Port",
  "Hostname",
  "URL",
  "Route",
  "IP",
  "Version",
  "Markdown",
  "HTML",
  "JavaScript",
  "CSS",
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
  return column.type === "Number" || column.type === "PositiveNumber";
};

export type IsBooleanColumnFunction = (column: ModelSchemaColumn) => boolean;

export const isBooleanColumn: IsBooleanColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return column.type === "Boolean";
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
