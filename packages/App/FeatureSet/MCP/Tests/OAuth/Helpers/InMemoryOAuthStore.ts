/**
 * An in-memory stand-in for the three MCP OAuth tables.
 *
 * The endpoint tests run the REAL McpOAuthClientService, McpOAuthGrantService
 * and McpOAuthTokenService - minting, hashing, expiry, the throttles - and
 * replace only the DatabaseService primitives those services call. So what is
 * under test is everything except Postgres, and this file is the part of
 * Postgres the endpoints rely on:
 *
 *   - `tokenHash` is unique;
 *   - a token's grant has to exist when it is inserted, and deleting a grant
 *     deletes its tokens (the foreign key, ON DELETE CASCADE);
 *   - compare-and-set is one indivisible step, so of two callers racing for
 *     the same row exactly one is told yes;
 *   - a read returns the columns that were selected and no others.
 *
 * Every primitive yields to the event loop before it touches the data, the
 * way a real query does, so two requests in flight interleave here the way
 * they would against a database rather than running one after the other.
 *
 * A query shape the store does not recognise throws instead of matching
 * nothing: a silently empty result would let a test pass for the wrong reason.
 */

import { jest } from "@jest/globals";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import McpOAuthClient from "Common/Models/DatabaseModels/McpOAuthClient";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import McpOAuthToken from "Common/Models/DatabaseModels/McpOAuthToken";
import McpOAuthClientService from "Common/Server/Services/McpOAuthClientService";
import McpOAuthGrantService from "Common/Server/Services/McpOAuthGrantService";
import McpOAuthTokenService from "Common/Server/Services/McpOAuthTokenService";
import McpOAuthSecret from "Common/Server/Utils/Mcp/McpOAuthSecret";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import McpOAuthTokenType from "Common/Types/Mcp/McpOAuthTokenType";
import ObjectID from "Common/Types/ObjectID";

export type StoreTable = "client" | "grant" | "token";

export type StoreOperation =
  | "create"
  | "findOneBy"
  | "findOneById"
  | "updateColumnsByIdWithoutHooks"
  | "compareAndSetColumnsByIdWithoutHooks"
  | "deleteOneBy"
  | "deleteBy";

export type StoreRow = Record<string, unknown>;

export interface StoreCall {
  table: StoreTable;
  operation: StoreOperation;
  input: Record<string, unknown>;
}

/*
 * Runs before the store performs an operation. It may throw (a failing
 * query), or wait (to hold one request still while another overtakes it).
 */
export type StoreInterceptor = (call: StoreCall) => Promise<void> | void;

interface Restorable {
  mockRestore: () => void;
}

interface TableDefinition {
  name: StoreTable;
  modelType: { new (): BaseModel };
  service: unknown;
  rows: Map<string, StoreRow>;
}

const ALL_OPERATIONS: Array<StoreOperation> = [
  "create",
  "findOneBy",
  "findOneById",
  "updateColumnsByIdWithoutHooks",
  "compareAndSetColumnsByIdWithoutHooks",
  "deleteOneBy",
  "deleteBy",
];

// What a foreign key violation looks like to the caller: a thrown query error.
export const FOREIGN_KEY_VIOLATION_MESSAGE: string =
  'insert or update on table "McpOAuthToken" violates foreign key constraint';

export const UNIQUE_VIOLATION_MESSAGE: string =
  "duplicate key value violates unique constraint";

export default class InMemoryOAuthStore {
  private tables: Record<StoreTable, TableDefinition>;
  private spies: Array<Restorable> = [];
  private interceptors: Array<{
    table: StoreTable;
    operation: StoreOperation;
    handler: StoreInterceptor;
  }> = [];

  // Every primitive the services called, in order, since the last reset.
  public calls: Array<StoreCall> = [];

  public constructor() {
    this.tables = {
      client: {
        name: "client",
        modelType: McpOAuthClient,
        service: McpOAuthClientService,
        rows: new Map<string, StoreRow>(),
      },
      grant: {
        name: "grant",
        modelType: McpOAuthGrant,
        service: McpOAuthGrantService,
        rows: new Map<string, StoreRow>(),
      },
      token: {
        name: "token",
        modelType: McpOAuthToken,
        service: McpOAuthTokenService,
        rows: new Map<string, StoreRow>(),
      },
    };
  }

  /*
   * Replaces the database primitives of the three service singletons. Every
   * primitive is replaced, including the ones a service does not use today,
   * so a new call cannot reach a real repository unnoticed.
   */
  public install(): void {
    for (const table of Object.values(this.tables)) {
      for (const operation of ALL_OPERATIONS) {
        const spy: {
          mockImplementation: (
            implementation: (input: Record<string, unknown>) => unknown,
          ) => unknown;
          mockRestore: () => void;
        } = jest.spyOn(table.service as any, operation as never) as any;

        spy.mockImplementation(
          async (input: Record<string, unknown>): Promise<unknown> => {
            return await this.run(table, operation, input);
          },
        );

        this.spies.push(spy);
      }
    }
  }

  public uninstall(): void {
    for (const spy of this.spies) {
      spy.mockRestore();
    }

    this.spies = [];
  }

  public reset(): void {
    for (const table of Object.values(this.tables)) {
      table.rows.clear();
    }

    this.calls = [];
    this.interceptors = [];
  }

  // --- Looking at what is stored -------------------------------------------

  public rows(table: StoreTable): Array<StoreRow> {
    return Array.from(this.tables[table].rows.values());
  }

  public count(table: StoreTable): number {
    return this.tables[table].rows.size;
  }

  public row(table: StoreTable, id: ObjectID | string): StoreRow | undefined {
    return this.tables[table].rows.get(id.toString());
  }

  public requireRow(table: StoreTable, id: ObjectID | string): StoreRow {
    const row: StoreRow | undefined = this.row(table, id);

    if (!row) {
      throw new Error(`No ${table} row with id ${id.toString()}.`);
    }

    return row;
  }

  // The grant rows, newest last.
  public grants(): Array<StoreRow> {
    return this.rows("grant");
  }

  public onlyGrant(): StoreRow {
    const grants: Array<StoreRow> = this.grants();

    if (grants.length !== 1) {
      throw new Error(`Expected exactly one grant, found ${grants.length}.`);
    }

    return grants[0]!;
  }

  public tokensOfGrant(
    grantId: ObjectID | string,
    tokenType?: McpOAuthTokenType | undefined,
  ): Array<StoreRow> {
    return this.rows("token").filter((row: StoreRow): boolean => {
      return (
        String(row["mcpOAuthGrantId"]) === grantId.toString() &&
        (tokenType === undefined || row["tokenType"] === tokenType)
      );
    });
  }

  // The row a plaintext secret was stored as, whatever kind of secret it is.
  public tokenBySecret(secret: string): StoreRow | undefined {
    const hash: string = McpOAuthSecret.hash(secret);

    return this.rows("token").find((row: StoreRow): boolean => {
      return row["tokenHash"] === hash;
    });
  }

  public requireTokenBySecret(secret: string): StoreRow {
    const row: StoreRow | undefined = this.tokenBySecret(secret);

    if (!row) {
      throw new Error("No token row for that secret.");
    }

    return row;
  }

  // --- Changing what is stored, as time or another writer would ------------

  public patch(
    table: StoreTable,
    id: ObjectID | string,
    values: StoreRow,
  ): void {
    Object.assign(this.requireRow(table, id), values);
  }

  // Makes a row look as though it expired `secondsAgo` seconds ago.
  public expire(
    table: "grant" | "token",
    id: ObjectID | string,
    secondsAgo: number = 60,
  ): void {
    this.patch(table, id, {
      expiresAt: new Date(Date.now() - secondsAgo * 1000),
    });
  }

  // Deletes a grant the way a person pressing Disconnect does: with its tokens.
  public deleteGrant(grantId: ObjectID | string): void {
    this.deleteRow(this.tables.grant, grantId.toString());
  }

  // --- Steering one operation ----------------------------------------------

  public intercept(
    table: StoreTable,
    operation: StoreOperation,
    handler: StoreInterceptor,
  ): void {
    this.interceptors.push({ table, operation, handler });
  }

  public clearInterceptors(): void {
    this.interceptors = [];
  }

  public callsTo(
    table: StoreTable,
    operation: StoreOperation,
  ): Array<StoreCall> {
    return this.calls.filter((call: StoreCall): boolean => {
      return call.table === table && call.operation === operation;
    });
  }

  // --- The primitives ------------------------------------------------------

  private async run(
    table: TableDefinition,
    operation: StoreOperation,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const call: StoreCall = { table: table.name, operation, input };

    this.calls.push(call);

    // A query is a round trip: other requests get to run in the meantime.
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });

    for (const interceptor of this.interceptors.slice()) {
      if (
        interceptor.table === table.name &&
        interceptor.operation === operation
      ) {
        await interceptor.handler(call);
      }
    }

    // From here to the return there is no await: each operation is atomic.
    switch (operation) {
      case "create":
        return this.create(table, input);
      case "findOneBy":
        return this.findOneBy(table, input);
      case "findOneById":
        return this.findOneById(table, input);
      case "updateColumnsByIdWithoutHooks":
        this.update(table, input);
        return undefined;
      case "compareAndSetColumnsByIdWithoutHooks":
        return this.compareAndSet(table, input);
      case "deleteOneBy":
        return this.deleteMatching(table, input, 1);
      case "deleteBy":
        return this.deleteMatching(table, input, Number.MAX_SAFE_INTEGER);
      default:
        throw new Error(`Unsupported store operation: ${operation}`);
    }
  }

  private create(
    table: TableDefinition,
    input: Record<string, unknown>,
  ): BaseModel {
    const data: BaseModel = input["data"] as BaseModel;
    const row: StoreRow = {};

    for (const column of data.getTableColumns().columns) {
      const value: unknown = (data as unknown as StoreRow)[column];

      if (value !== undefined) {
        row[column] = value;
      }
    }

    if (table.name === "token") {
      const grantId: string = String(row["mcpOAuthGrantId"] || "");

      if (!this.tables.grant.rows.has(grantId)) {
        throw new Error(FOREIGN_KEY_VIOLATION_MESSAGE);
      }

      const isDuplicate: boolean = this.rows("token").some(
        (existing: StoreRow): boolean => {
          return existing["tokenHash"] === row["tokenHash"];
        },
      );

      if (isDuplicate) {
        throw new Error(UNIQUE_VIOLATION_MESSAGE);
      }
    }

    const id: string = ObjectID.generate().toString();
    const now: Date = new Date();

    row["_id"] = id;
    row["createdAt"] = now;
    row["updatedAt"] = now;

    table.rows.set(id, row);

    // A created row comes back whole, as DatabaseService.create returns it.
    return this.toModel(table, row, null);
  }

  private findOneById(
    table: TableDefinition,
    input: Record<string, unknown>,
  ): BaseModel | null {
    const id: unknown = input["id"];

    if (!id) {
      throw new Error("findOneById.id is required");
    }

    const row: StoreRow | undefined = table.rows.get(String(id));

    return row
      ? this.toModel(table, row, (input["select"] as StoreRow) || {})
      : null;
  }

  private findOneBy(
    table: TableDefinition,
    input: Record<string, unknown>,
  ): BaseModel | null {
    const query: StoreRow = (input["query"] as StoreRow) || {};

    const row: StoreRow | undefined = Array.from(table.rows.values()).find(
      (candidate: StoreRow): boolean => {
        return this.matches(candidate, query);
      },
    );

    return row
      ? this.toModel(table, row, (input["select"] as StoreRow) || {})
      : null;
  }

  private update(table: TableDefinition, input: Record<string, unknown>): void {
    // A row that has gone is an UPDATE that matched nothing, not an error.
    const row: StoreRow | undefined = table.rows.get(String(input["id"]));

    if (!row) {
      return;
    }

    this.write(row, input);
  }

  private compareAndSet(
    table: TableDefinition,
    input: Record<string, unknown>,
  ): boolean {
    const row: StoreRow | undefined = table.rows.get(String(input["id"]));

    if (!row) {
      return false;
    }

    const expected: StoreRow = (input["expectedData"] as StoreRow) || {};

    for (const [column, value] of Object.entries(expected)) {
      if (!this.isSameValue(row[column], value)) {
        return false;
      }
    }

    this.write(row, input);

    return true;
  }

  private write(row: StoreRow, input: Record<string, unknown>): void {
    for (const [column, value] of Object.entries(
      (input["data"] as StoreRow) || {},
    )) {
      row[column] = value;
    }

    if (!input["skipUpdateDateColumn"]) {
      row["updatedAt"] = new Date();
    }
  }

  private deleteMatching(
    table: TableDefinition,
    input: Record<string, unknown>,
    limit: number,
  ): number {
    const query: StoreRow = (input["query"] as StoreRow) || {};

    const ids: Array<string> = Array.from(table.rows.entries())
      .filter(([, row]: [string, StoreRow]): boolean => {
        return this.matches(row, query);
      })
      .map(([id]: [string, StoreRow]): string => {
        return id;
      })
      .slice(0, limit);

    for (const id of ids) {
      this.deleteRow(table, id);
    }

    return ids.length;
  }

  private deleteRow(table: TableDefinition, id: string): void {
    table.rows.delete(id);

    if (table.name !== "grant") {
      return;
    }

    // ON DELETE CASCADE.
    for (const [tokenId, token] of Array.from(
      this.tables.token.rows.entries(),
    )) {
      if (String(token["mcpOAuthGrantId"]) === id) {
        this.tables.token.rows.delete(tokenId);
      }
    }
  }

  private matches(row: StoreRow, query: StoreRow): boolean {
    return Object.entries(query).every(
      ([column, expected]: [string, unknown]): boolean => {
        if (InMemoryOAuthStore.isOperator(expected)) {
          return InMemoryOAuthStore.matchesOperator(row[column], expected);
        }

        return this.isSameValue(row[column], expected);
      },
    );
  }

  // Null-safe equality, with ids and dates compared by value.
  private isSameValue(actual: unknown, expected: unknown): boolean {
    const left: unknown = actual === undefined ? null : actual;
    const right: unknown = expected === undefined ? null : expected;

    if (left === null || right === null) {
      return left === right;
    }

    if (left instanceof Date || right instanceof Date) {
      return (
        new Date(left as Date).getTime() === new Date(right as Date).getTime()
      );
    }

    return String(left) === String(right);
  }

  /*
   * A QueryHelper operator (a TypeORM Raw find operator). Told apart by shape
   * because TypeORM is not a dependency of the App package's tests.
   */
  private static isOperator(value: unknown): value is {
    getSql: (alias: string) => string;
    objectLiteralParameters: Record<string, unknown>;
  } {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      typeof (value as { getSql?: unknown }).getSql === "function"
    );
  }

  private static matchesOperator(
    actual: unknown,
    operator: {
      getSql: (alias: string) => string;
      objectLiteralParameters: Record<string, unknown>;
    },
  ): boolean {
    const sql: string = operator.getSql("column");
    const parameters: Array<unknown> = Object.values(
      operator.objectLiteralParameters || {},
    );

    // QueryHelper.notEquals
    if (sql.includes("!=") && parameters.length === 1) {
      return String(actual) !== String(parameters[0]);
    }

    throw new Error(
      `The in-memory OAuth store does not understand this query operator: ${sql}`,
    );
  }

  /*
   * A model carrying the selected columns. `select` null means every column
   * (what create returns); otherwise only what was asked for, plus the id,
   * which a read always includes.
   */
  private toModel(
    table: TableDefinition,
    row: StoreRow,
    select: StoreRow | null,
  ): BaseModel {
    const model: BaseModel = new table.modelType();

    for (const [column, value] of Object.entries(row)) {
      if (select === null || column === "_id" || select[column]) {
        (model as unknown as StoreRow)[column] = value;
      }
    }

    return model;
  }
}

// What an audit entry would be attributed to: the props a delete was made with.
export function getDeleteProps(
  call: StoreCall,
): DatabaseCommonInteractionProps {
  return call.input["props"] as DatabaseCommonInteractionProps;
}
