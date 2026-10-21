import {
  CustomFieldFormCopy,
  MAPPED_CUSTOM_FIELD_SOURCE_COPY,
  MappedCustomFieldSourceCopy,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import {
  MAPPING_SOURCE_DEFINITION_MODELS,
  MappedCustomFieldColumns,
  getMappedCustomFieldColumns,
  getMappedCustomFieldMenuTitle,
  getMappedCustomFieldSourceCopy,
  getMappingSourceDefinitionModel,
  getNameAfterSourcePick,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/MappedCustomField";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import CUSTOM_FIELD_MAPPING_CATALOG, {
  CustomFieldMappingSourceInfo,
  getCustomFieldMappingSources,
} from "Common/Types/CustomField/CustomFieldMappingCatalog";
import CustomFieldMappingSourceResource from "Common/Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * A mapped custom field: one whose value is copied from a monitor's custom
 * field. The maintainer: "If I want to create a mapped custom field, I can go
 * to the model table header. In the more options, there should be an option
 * to create a mapped custom field. When I click on that, only show me those
 * options."
 *
 * The dialog asks for the field to copy, a name and a description; these are
 * the rules behind it, without React:
 *
 *   - which sources the catalog offers, and that each has a model to list
 *     its fields from and the text the dialog shows;
 *   - the new field is named after the field it copies, unless a name was
 *     typed in;
 *   - it is saved with the type, and a dropdown's options, of the field it
 *     copies - the server accepts a mapping only between fields of one type,
 *     and only when every source option is offered here too;
 *   - a source field that is gone, or has no type, is refused with a
 *     sentence saying so.
 */

const MONITOR: CustomFieldMappingSourceInfo = getCustomFieldMappingSources(
  "IncidentCustomField",
)[0]!;

const DROPDOWN_OPTIONS: string = JSON.stringify([
  { label: "us-east-1", color: "#4f46e5" },
  { label: "eu-west-1" },
]);

describe("the sources a field can be mapped from", () => {
  test("alerts, incidents and scheduled maintenance events copy from their monitor", () => {
    expect(Object.keys(CUSTOM_FIELD_MAPPING_CATALOG).sort()).toEqual([
      "AlertCustomField",
      "IncidentCustomField",
      "ScheduledMaintenanceCustomField",
    ]);

    for (const table of Object.keys(CUSTOM_FIELD_MAPPING_CATALOG)) {
      expect(
        getCustomFieldMappingSources(table).map(
          (source: CustomFieldMappingSourceInfo) => {
            return source.resource;
          },
        ),
      ).toEqual([CustomFieldMappingSourceResource.Monitor]);
    }
  });

  test("every source has a model its fields are listed from", () => {
    for (const sources of Object.values(CUSTOM_FIELD_MAPPING_CATALOG)) {
      for (const source of sources) {
        expect(getMappingSourceDefinitionModel(source)).toBeDefined();
        expect(new (getMappingSourceDefinitionModel(source)!)().tableName).toBe(
          source.sourceDefinitionTableName,
        );
      }
    }

    expect(MAPPING_SOURCE_DEFINITION_MODELS["MonitorCustomField"]).toBe(
      MonitorCustomField,
    );
  });

  test("a source with no model is not offered", () => {
    expect(
      getMappingSourceDefinitionModel({
        ...MONITOR,
        sourceDefinitionTableName: "ServiceCustomField",
      }),
    ).toBeUndefined();
  });

  test("every source has the dialog's text, in whole sentences", () => {
    for (const resource of Object.values(CustomFieldMappingSourceResource)) {
      const copy: MappedCustomFieldSourceCopy =
        MAPPED_CUSTOM_FIELD_SOURCE_COPY[resource];

      expect(copy).toBeDefined();

      for (const text of Object.values(copy)) {
        expect(text.trim().length).toBeGreaterThan(5);
        // Looked up whole in the locales: nothing to fill in.
        expect(text).not.toContain("{{");
      }
    }

    expect(getMappedCustomFieldSourceCopy(MONITOR)).toBe(
      MAPPED_CUSTOM_FIELD_SOURCE_COPY[CustomFieldMappingSourceResource.Monitor],
    );
  });

  test("the monitor's text says what is copied, in plain words", () => {
    const copy: MappedCustomFieldSourceCopy =
      MAPPED_CUSTOM_FIELD_SOURCE_COPY[CustomFieldMappingSourceResource.Monitor];

    expect(copy.mapValueFromOption).toBe("Copy from a monitor custom field");
    expect(copy.sourceFieldTitle).toBe("Monitor Field");
    expect(copy.sourceFieldDescription).toContain("type");
    expect(copy.sourceFieldDescription).toContain("dropdown options");
    expect(copy.dialogDescription).toContain("nobody has to type it in");
    expect(copy.noSourceFields).toContain(
      "Monitors > Settings > Custom Fields",
    );
  });
});

describe("the More menu item", () => {
  test("is called what the maintainer called it", () => {
    expect(CustomFieldFormCopy.createMappedFieldTitle).toBe(
      "Create Mapped Custom Field",
    );
    expect(
      getMappedCustomFieldMenuTitle({ source: MONITOR, sourceCount: 1 }),
    ).toBe("Create Mapped Custom Field");
  });

  test("names its source when a resource can copy from more than one", () => {
    expect(
      getMappedCustomFieldMenuTitle({ source: MONITOR, sourceCount: 2 }),
    ).toBe("Create Mapped Custom Field (Monitor)");
  });
});

describe("the new field's name", () => {
  test("is the copied field's name when none was typed", () => {
    for (const currentName of [undefined, null, "", "   ", 42]) {
      expect(
        getNameAfterSourcePick({
          currentName: currentName,
          previousSourceFieldName: undefined,
          sourceFieldName: "Region",
        }),
      ).toBe("Region");
    }
  });

  test("follows the picked field while it is still the last pick's name", () => {
    expect(
      getNameAfterSourcePick({
        currentName: "Region",
        previousSourceFieldName: "Region",
        sourceFieldName: "Customer Tier",
      }),
    ).toBe("Customer Tier");
  });

  test("is never replaced once somebody typed one", () => {
    expect(
      getNameAfterSourcePick({
        currentName: "Affected Region",
        previousSourceFieldName: "Region",
        sourceFieldName: "Customer Tier",
      }),
    ).toBe("Affected Region");

    expect(
      getNameAfterSourcePick({
        currentName: "Affected Region",
        previousSourceFieldName: undefined,
        sourceFieldName: "Region",
      }),
    ).toBe("Affected Region");
  });
});

describe("what a new mapped field is saved with", () => {
  test("a text field: where it copies from, and the copied field's type", () => {
    const columns: MappedCustomFieldColumns = getMappedCustomFieldColumns({
      source: MONITOR,
      sourceFieldName: "Region",
      sourceDefinition: {
        name: "Region",
        customFieldType: CustomFieldType.Text,
      },
    });

    expect(columns).toEqual({
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "Region",
      customFieldType: CustomFieldType.Text,
    });
    expect(Object.keys(columns)).not.toContain("dropdownOptions");
  });

  test.each([CustomFieldType.Dropdown, CustomFieldType.MultiSelectDropdown])(
    "a %s: every option of the copied field too",
    (type: CustomFieldType) => {
      expect(
        getMappedCustomFieldColumns({
          source: MONITOR,
          sourceFieldName: "Region",
          sourceDefinition: {
            name: "Region",
            customFieldType: type,
            dropdownOptions: DROPDOWN_OPTIONS,
          },
        }),
      ).toEqual({
        mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
        mapFromCustomFieldName: "Region",
        customFieldType: type,
        dropdownOptions: DROPDOWN_OPTIONS,
      });
    },
  );

  test("a dropdown whose source has no options yet gets none", () => {
    expect(
      getMappedCustomFieldColumns({
        source: MONITOR,
        sourceFieldName: "Region",
        sourceDefinition: {
          name: "Region",
          customFieldType: CustomFieldType.Dropdown,
        },
      }).dropdownOptions,
    ).toBe("");
  });

  test.each(Object.values(CustomFieldType))(
    "takes a %s field's type as it is",
    (type: CustomFieldType) => {
      expect(
        getMappedCustomFieldColumns({
          source: MONITOR,
          sourceFieldName: "Field",
          sourceDefinition: { name: "Field", customFieldType: type },
        }).customFieldType,
      ).toBe(type);
    },
  );

  test("refuses a source field that is gone, saying which", () => {
    expect(() => {
      getMappedCustomFieldColumns({
        source: MONITOR,
        sourceFieldName: "Region",
        sourceDefinition: undefined,
      });
    }).toThrow(BadDataException);

    expect(() => {
      getMappedCustomFieldColumns({
        source: MONITOR,
        sourceFieldName: "Region",
        sourceDefinition: undefined,
      });
    }).toThrow('Monitor does not have a custom field called "Region" any more');
  });

  test("refuses a source field without a type it can copy", () => {
    for (const customFieldType of [undefined, "Geolocation"]) {
      expect(() => {
        getMappedCustomFieldColumns({
          source: MONITOR,
          sourceFieldName: "Region",
          sourceDefinition: {
            name: "Region",
            customFieldType: customFieldType as CustomFieldType | undefined,
          },
        });
      }).toThrow(
        'The monitor custom field "Region" has no field type, so it cannot be copied',
      );
    }
  });
});
