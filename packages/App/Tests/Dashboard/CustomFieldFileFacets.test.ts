import {
  buildCustomFieldFacetQuery,
  buildCustomFieldFacets,
  FILE_CUSTOM_FIELD_HAS_FILES,
  FILE_CUSTOM_FIELD_NO_FILES,
  FILE_CUSTOM_FIELD_OPTIONS,
  FILE_FACET_OPERATORS,
  getCustomFieldFacetKind,
  getCustomFieldFacetOperators,
  getCustomFieldFacetOptions,
  isDateCustomField,
  mergeCustomFieldQueryValue,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldFacets";
import { FilterOperator } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import IsNull from "Common/Types/BaseDatabase/IsNull";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import { CustomFieldDefinition } from "Common/Types/CustomField/CustomFieldDefinition";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A File or Multiple files field in the facet bar asks one question: does
 * the record hold files there - "incidents with no postmortem attached".
 * A file's name is no value to pick from a list, and an emptied file field
 * loses its key on the record (CustomFieldFiles), so "has files" is a key
 * that is set and "no files" one that is not. The option values are the URL
 * and saved-view vocabulary, so they are pinned.
 */

const POSTMORTEM: CustomFieldDefinition = {
  name: "Postmortem",
  customFieldType: CustomFieldType.File,
};

const EVIDENCE: CustomFieldDefinition = {
  name: "Evidence",
  customFieldType: CustomFieldType.MultipleFiles,
};

type QueryForFunction = (
  definition: CustomFieldDefinition,
  values: Array<string>,
  operator: FilterOperator,
) => JSONObject | undefined;

const queryFor: QueryForFunction = (
  definition: CustomFieldDefinition,
  values: Array<string>,
  operator: FilterOperator,
): JSONObject | undefined => {
  return buildCustomFieldFacetQuery({
    definition: definition,
    values: values,
    operator: operator,
  });
};

describe("the chip of a file field", () => {
  test.each([POSTMORTEM, EVIDENCE])(
    "$customFieldType is a choice of Has files or No files, with the one operator is",
    (definition: CustomFieldDefinition) => {
      expect(getCustomFieldFacetKind(definition)).toBe("options");
      expect(getCustomFieldFacetOptions(definition)).toBe(
        FILE_CUSTOM_FIELD_OPTIONS,
      );
      expect(getCustomFieldFacetOperators(definition)).toBe(
        FILE_FACET_OPERATORS,
      );
      expect(isDateCustomField(definition)).toBe(false);
    },
  );

  test("its options and their values, as links and saved views name them", () => {
    expect(FILE_CUSTOM_FIELD_HAS_FILES).toBe("has-files");
    expect(FILE_CUSTOM_FIELD_NO_FILES).toBe("no-files");
    expect(FILE_CUSTOM_FIELD_OPTIONS).toEqual([
      { value: "has-files", label: "Has files" },
      { value: "no-files", label: "No files" },
    ]);
    expect(FILE_FACET_OPERATORS).toEqual(["is"]);
  });

  test("is drawn with a paper clip, as one choice, writing the customFields column", () => {
    const [postmortem, evidence]: Array<ResourceFacet> = buildCustomFieldFacets(
      [POSTMORTEM, EVIDENCE],
    );

    for (const facet of [postmortem!, evidence!]) {
      expect(facet.icon).toBe(IconProp.PaperClip);
      expect(facet.type).toBe("options");
      expect(facet.isMultiSelect).toBe(false);
      expect(facet.options).toEqual(FILE_CUSTOM_FIELD_OPTIONS);
      expect(facet.supportedOperators).toEqual(["is"]);
      expect(facet.queryField).toBe("customFields");
    }
  });
});

describe("what a file chip asks the database", () => {
  test("Has files: the field's key is set", () => {
    const query: JSONObject | undefined = queryFor(
      POSTMORTEM,
      [FILE_CUSTOM_FIELD_HAS_FILES],
      "is",
    );

    expect(Object.keys(query!)).toEqual(["Postmortem"]);
    expect(query!["Postmortem"]).toBeInstanceOf(NotNull);
  });

  test("No files: the field's key is not set", () => {
    expect(
      queryFor(EVIDENCE, [FILE_CUSTOM_FIELD_NO_FILES], "is")!["Evidence"],
    ).toBeInstanceOf(IsNull);
  });

  test("both choices, or neither, constrain nothing", () => {
    expect(
      queryFor(
        POSTMORTEM,
        [FILE_CUSTOM_FIELD_HAS_FILES, FILE_CUSTOM_FIELD_NO_FILES],
        "is",
      ),
    ).toBeUndefined();
    expect(queryFor(POSTMORTEM, [], "is")).toBeUndefined();
    // A value that is neither - a file's name in an old link - neither.
    expect(queryFor(POSTMORTEM, ["report.pdf"], "is")).toBeUndefined();
  });

  test("is not turns the question round", () => {
    expect(
      queryFor(POSTMORTEM, [FILE_CUSTOM_FIELD_HAS_FILES], "is_not")![
        "Postmortem"
      ],
    ).toBeInstanceOf(IsNull);
    expect(
      queryFor(POSTMORTEM, [FILE_CUSTOM_FIELD_NO_FILES], "is_not")![
        "Postmortem"
      ],
    ).toBeInstanceOf(NotNull);
  });

  test("a saved view's is empty and is not empty read the same way", () => {
    expect(queryFor(POSTMORTEM, [], "is_empty")!["Postmortem"]).toBeInstanceOf(
      IsNull,
    );
    expect(
      queryFor(POSTMORTEM, [], "is_not_empty")!["Postmortem"],
    ).toBeInstanceOf(NotNull);
  });

  test("never compares a file field to a value: no name, id or JSON reaches the query", () => {
    for (const operator of ["is", "is_not"] as Array<FilterOperator>) {
      const query: JSONObject | undefined = queryFor(
        EVIDENCE,
        [FILE_CUSTOM_FIELD_HAS_FILES],
        operator,
      );
      const predicate: unknown = query!["Evidence"];

      expect(predicate instanceof IsNull || predicate instanceof NotNull).toBe(
        true,
      );
    }
  });

  test("a file chip and another chip share the column", () => {
    const merged: unknown = mergeCustomFieldQueryValue(
      queryFor(POSTMORTEM, [FILE_CUSTOM_FIELD_NO_FILES], "is"),
      { Team: "Payments" },
    );

    expect(Object.keys(merged as JSONObject).sort()).toEqual([
      "Postmortem",
      "Team",
    ]);
    expect((merged as JSONObject)["Postmortem"]).toBeInstanceOf(IsNull);
  });

  test("the chip's own toQueryValue asks the same", () => {
    const [facet]: Array<ResourceFacet> = buildCustomFieldFacets([POSTMORTEM]);

    expect(
      (facet!.toQueryValue!([FILE_CUSTOM_FIELD_HAS_FILES], "is") as JSONObject)[
        "Postmortem"
      ],
    ).toBeInstanceOf(NotNull);
  });
});
