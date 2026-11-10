import { ModelColumn, modelColumns } from "./ModelColumns";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import Phone from "../../Types/Phone";
import { describe, expect, test } from "@jest/globals";
import { ValueTransformer } from "typeorm";

/*
 * modelColumns reads TypeORM's column metadata for suites outside Common
 * that cannot import typeorm (ee's AuditLogRecorderTypedValues): each column
 * as its decorator declares it, with the transformer that reads its stored
 * value.
 */
describe("modelColumns", () => {
  function columnOf(propertyName: string): ModelColumn | undefined {
    return modelColumns().find((column: ModelColumn): boolean => {
      return (
        column.model === IncomingCallPolicy &&
        column.propertyName === propertyName
      );
    });
  }

  test("reads a typed column with its transformer, which reads a stored value as the type", () => {
    const column: ModelColumn | undefined = columnOf("routingPhoneNumber");

    expect(column).toBeDefined();
    // One transformer, not a list.
    expect(column!.transformer).toBeDefined();
    expect(Array.isArray(column!.transformer)).toBe(false);

    const read: unknown = (column!.transformer as ValueTransformer).from(
      "+14155550100",
    );

    expect(read).toBeInstanceOf(Phone);
    expect((read as Phone).toString()).toBe("+14155550100");
  });

  test("reads a plain column with no transformer", () => {
    const column: ModelColumn | undefined = columnOf("name");

    expect(column).toBeDefined();
    expect(column!.transformer).toBeUndefined();
  });
});
