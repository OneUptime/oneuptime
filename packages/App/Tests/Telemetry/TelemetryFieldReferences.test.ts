import { EXCEPTION_FIELD_ALIASES } from "../../FeatureSet/Dashboard/src/Utils/ExceptionsSearchQuery";
import {
  EXCEPTION_SEARCH_FIELDS,
  findExceptionSavedViewFieldReferences,
  TelemetryFieldReference,
} from "Common/Utils/Telemetry/TelemetryFieldReferences";
import { TelemetryFieldPart } from "Common/Types/Telemetry/TelemetryFieldReaders";
import { describe, expect, test } from "@jest/globals";

/*
 * AN EXCEPTION SAVED VIEW'S SEARCH, READ AS THE EXCEPTIONS LIST READS IT
 * (#10433).
 *
 * The lookup of what reads a log's or a span's fields reads an Exceptions
 * saved view's search to find the attributes it filters on: every field
 * the list's search knows by name (the Dashboard's EXCEPTION_FIELD_ALIASES:
 * type, service, env, class...) is a column of the exception, never an
 * attribute, and every other key is an attribute of the span's exception
 * event. The lookup keeps its own list in Common (EXCEPTION_SEARCH_FIELDS),
 * since the server cannot import the Dashboard: held here to the list's,
 * so a field the search learns is not read as an attribute a scrub rule
 * could break.
 */

describe("an Exceptions saved view's search, read as the list reads it", () => {
  test("knows exactly the fields the Exceptions search knows by name", () => {
    expect([...EXCEPTION_SEARCH_FIELDS].sort()).toEqual(
      Object.keys(EXCEPTION_FIELD_ALIASES).sort(),
    );
  });

  test.each(Object.keys(EXCEPTION_FIELD_ALIASES))(
    "%s: is the exception's own column, not an attribute a rule could hide",
    (field: string) => {
      const references: Array<TelemetryFieldReference> =
        findExceptionSavedViewFieldReferences({
          query: { search: `${field}:checkout` },
        });

      expect(
        references.filter((reference: TelemetryFieldReference): boolean => {
          return (
            reference.part === TelemetryFieldPart.Attributes &&
            reference.key === field
          );
        }),
      ).toEqual([]);
    },
  );

  test("any other key is an attribute of the exception, which a rule can hide", () => {
    const references: Array<TelemetryFieldReference> =
      findExceptionSavedViewFieldReferences({
        query: { search: "user.email:alice@example.com" },
      });

    expect(
      references.some((reference: TelemetryFieldReference): boolean => {
        return (
          reference.part === TelemetryFieldPart.Attributes &&
          reference.key === "user.email"
        );
      }),
    ).toBe(true);
  });
});
