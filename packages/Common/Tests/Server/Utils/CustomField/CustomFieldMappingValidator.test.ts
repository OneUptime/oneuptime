import { afterEach, describe, expect, test } from "@jest/globals";
import CustomFieldMappingSourceResource from "../../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import TeamCustomField from "../../../../Models/DatabaseModels/TeamCustomField";
import AlertCustomFieldService from "../../../../Server/Services/AlertCustomFieldService";
import MonitorCustomFieldService from "../../../../Server/Services/MonitorCustomFieldService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import {
  normalizeCustomFieldMappingPayload,
  validateCustomFieldMappingOnCreate,
  validateCustomFieldMappingOnUpdate,
} from "../../../../Server/Utils/CustomField/CustomFieldMappingValidator";

/*
 * Saving a custom field definition is the only moment a person is present to
 * be told a mapping cannot work, and the only moment anything on the server
 * looks at a custom field's shape at all — values are never validated against
 * their definition anywhere else. So a mapping accepted here that turns out to
 * be impossible does not fail loudly later; it quietly copies nothing, or
 * copies a dropdown value the target cannot offer and therefore cannot be
 * filtered by.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type StubMonitorFieldFunction = (
  definitions: Array<Partial<MonitorCustomField>>,
) => void;

const stubMonitorFields: StubMonitorFieldFunction = (
  definitions: Array<Partial<MonitorCustomField>>,
): void => {
  jest.spyOn(MonitorCustomFieldService, "findBy").mockResolvedValue(
    definitions.map((definition: Partial<MonitorCustomField>) => {
      return Object.assign(new MonitorCustomField(), definition);
    }) as never,
  );
};

type BuildCreateByFunction = (data: JSONObject) => CreateBy<AlertCustomField>;

const buildCreateBy: BuildCreateByFunction = (
  data: JSONObject,
): CreateBy<AlertCustomField> => {
  return {
    data: Object.assign(new AlertCustomField(), data),
    props: { isRoot: true, tenantId: PROJECT_ID },
  } as CreateBy<AlertCustomField>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("normalizeCustomFieldMappingPayload", () => {
  /*
   * `showIf` hides a form field but does not strip it from the submitted
   * values — BasicForm posts the whole bag — so clearing "Map value from"
   * leaves the field name behind and would persist half a mapping.
   */
  test("clears the field name when the resource is cleared", () => {
    const payload: JSONObject = {
      mapFromResourceType: "",
      mapFromCustomFieldName: "Vendor",
    };

    normalizeCustomFieldMappingPayload(payload as Record<string, unknown>);

    expect(payload["mapFromResourceType"]).toBeNull();
    expect(payload["mapFromCustomFieldName"]).toBeNull();
  });

  test("clears the resource when the field name is cleared", () => {
    const payload: JSONObject = {
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "",
    };

    normalizeCustomFieldMappingPayload(payload as Record<string, unknown>);

    expect(payload["mapFromResourceType"]).toBeNull();
    expect(payload["mapFromCustomFieldName"]).toBeNull();
  });

  test("trims a complete mapping and leaves it in place", () => {
    const payload: JSONObject = {
      mapFromResourceType: " Monitor ",
      mapFromCustomFieldName: " Vendor ",
    };

    normalizeCustomFieldMappingPayload(payload as Record<string, unknown>);

    expect(payload["mapFromResourceType"]).toBe("Monitor");
    expect(payload["mapFromCustomFieldName"]).toBe("Vendor");
  });

  /*
   * An update that renames the field must not be read as an instruction to
   * drop a mapping it never mentioned.
   */
  test("leaves a payload that mentions neither key untouched", () => {
    const payload: JSONObject = { name: "Vendor" };

    normalizeCustomFieldMappingPayload(payload as Record<string, unknown>);

    expect(payload).toEqual({ name: "Vendor" });
  });

  /*
   * The regression that made this rule explicit. An update payload is a
   * PARTIAL: repointing a mapping at another field mentions only the field
   * name, and reading the absent resource as "cleared" deleted the working
   * mapping instead of validating the new one.
   */
  test("does not read an absent key as a cleared one", () => {
    const payload: JSONObject = { mapFromCustomFieldName: "Supplier" };

    normalizeCustomFieldMappingPayload(payload as Record<string, unknown>);

    expect(payload).toEqual({ mapFromCustomFieldName: "Supplier" });
  });
});

describe("validateCustomFieldMappingOnCreate", () => {
  test("accepts a mapping onto a source field of the same type", async () => {
    stubMonitorFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          customFieldType: CustomFieldType.Text,
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
          mapFromCustomFieldName: "Vendor",
        }),
      }),
    ).resolves.toBeUndefined();
  });

  test("accepts a definition with no mapping without reading the source table", async () => {
    const findMonitorFields: jest.SpyInstance = jest
      .spyOn(MonitorCustomFieldService, "findBy")
      .mockResolvedValue([] as never);

    await validateCustomFieldMappingOnCreate({
      definitionModelType: AlertCustomField,
      createBy: buildCreateBy({
        name: "Vendor",
        customFieldType: CustomFieldType.Text,
      }),
    });

    expect(findMonitorFields).not.toHaveBeenCalled();
  });

  test("rejects a source field that does not exist", async () => {
    stubMonitorFields([]);

    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          customFieldType: CustomFieldType.Text,
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
          mapFromCustomFieldName: "Vendor",
        }),
      }),
    ).rejects.toThrow(/does not have a custom field called "Vendor"/);
  });

  test("rejects a source field of a different type", async () => {
    stubMonitorFields([
      { name: "Vendor", customFieldType: CustomFieldType.Number },
    ]);

    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          customFieldType: CustomFieldType.Text,
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
          mapFromCustomFieldName: "Vendor",
        }),
      }),
    ).rejects.toThrow(/same type/);
  });

  /*
   * The facet chip's options come from the TARGET definition, so a copied
   * value outside that list is stored, drawn as an uncoloured badge, and
   * cannot be filtered for.
   */
  test("rejects a dropdown source that can hold options this field does not offer", async () => {
    stubMonitorFields([
      {
        name: "Vendor",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Acme\nAWS",
      },
    ]);

    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Acme\nGlobex",
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
          mapFromCustomFieldName: "Vendor",
        }),
      }),
    ).rejects.toThrow(/AWS/);
  });

  /*
   * The mapping columns exist on all nine definition tables for lockstep with
   * their siblings, but six of those resources have nothing to inherit from.
   * Accepting a value there would store a mapping that can never resolve.
   */
  test("rejects a mapping on a resource with no reachable source", async () => {
    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: TeamCustomField,
        createBy: {
          data: Object.assign(new TeamCustomField(), {
            name: "Vendor",
            customFieldType: CustomFieldType.Text,
            mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
            mapFromCustomFieldName: "Vendor",
          }),
          props: { isRoot: true, tenantId: PROJECT_ID },
        } as CreateBy<TeamCustomField>,
      }),
    ).rejects.toThrow(/cannot take their value from another resource/);
  });

  test("allows an unmapped definition on a resource with no reachable source", async () => {
    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: TeamCustomField,
        createBy: {
          data: Object.assign(new TeamCustomField(), {
            name: "Vendor",
            customFieldType: CustomFieldType.Text,
          }),
          props: { isRoot: true, tenantId: PROJECT_ID },
        } as CreateBy<TeamCustomField>,
      }),
    ).resolves.toBeUndefined();
  });

  /*
   * `customFieldType` is nullable, so two untyped definitions would otherwise
   * pass an `undefined === undefined` comparison and let any value shape flow.
   */
  /*
   * Half a mapping resolves nothing and would show in the settings table as a
   * field claiming to be mapped to nowhere.
   */
  test("rejects a resource with no field chosen", async () => {
    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          customFieldType: CustomFieldType.Text,
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
        }),
      }),
    ).rejects.toThrow(/Choose both/);
  });

  test("rejects a mapping when this field has no type", async () => {
    stubMonitorFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    await expect(
      validateCustomFieldMappingOnCreate({
        definitionModelType: AlertCustomField,
        createBy: buildCreateBy({
          name: "Vendor",
          mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
          mapFromCustomFieldName: "Vendor",
        }),
      }),
    ).rejects.toThrow(/field type/);
  });
});

describe("validateCustomFieldMappingOnUpdate", () => {
  type BuildUpdateByFunction = (data: JSONObject) => UpdateBy<AlertCustomField>;

  const buildUpdateBy: BuildUpdateByFunction = (
    data: JSONObject,
  ): UpdateBy<AlertCustomField> => {
    return {
      query: { _id: "abc" },
      data: data,
      props: { isRoot: true, tenantId: PROJECT_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<AlertCustomField>;
  };

  type StubStoredDefinitionFunction = (
    definition: Partial<AlertCustomField>,
  ) => void;

  const stubStoredDefinition: StubStoredDefinitionFunction = (
    definition: Partial<AlertCustomField>,
  ): void => {
    jest.spyOn(AlertCustomFieldService, "findBy").mockResolvedValue([
      Object.assign(new AlertCustomField(), {
        projectId: PROJECT_ID,
        ...definition,
      }),
    ] as never);
  };

  /*
   * The payload is a PARTIAL. Changing only the source field name still has to
   * be checked against the type already stored on the row.
   */
  test("checks a partial payload against the values already on the row", async () => {
    stubStoredDefinition({
      customFieldType: CustomFieldType.Text,
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "Vendor",
    });
    stubMonitorFields([
      { name: "Supplier", customFieldType: CustomFieldType.Number },
    ]);

    await expect(
      validateCustomFieldMappingOnUpdate({
        definitionModelType: AlertCustomField,
        definitionService: AlertCustomFieldService,
        updateBy: buildUpdateBy({ mapFromCustomFieldName: "Supplier" }),
      }),
    ).rejects.toThrow(/same type/);
  });

  /*
   * A mapping that was valid when it was saved can be invalidated from this
   * side later, by narrowing the target's own option list.
   */
  test("rejects narrowing this field's options below what the source can hold", async () => {
    stubStoredDefinition({
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Acme\nGlobex",
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "Vendor",
    });
    stubMonitorFields([
      {
        name: "Vendor",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Acme\nGlobex",
      },
    ]);

    await expect(
      validateCustomFieldMappingOnUpdate({
        definitionModelType: AlertCustomField,
        definitionService: AlertCustomFieldService,
        updateBy: buildUpdateBy({ dropdownOptions: "Acme" }),
      }),
    ).rejects.toThrow(/Globex/);
  });

  test("rejects naming a field to copy on a row with no source resource", async () => {
    stubStoredDefinition({ customFieldType: CustomFieldType.Text });

    await expect(
      validateCustomFieldMappingOnUpdate({
        definitionModelType: AlertCustomField,
        definitionService: AlertCustomFieldService,
        updateBy: buildUpdateBy({ mapFromCustomFieldName: "Vendor" }),
      }),
    ).rejects.toThrow(/Choose both/);
  });

  test("ignores an update that cannot affect the mapping", async () => {
    const findStored: jest.SpyInstance = jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockResolvedValue([] as never);

    await validateCustomFieldMappingOnUpdate({
      definitionModelType: AlertCustomField,
      definitionService: AlertCustomFieldService,
      updateBy: buildUpdateBy({ description: "A new description" }),
    });

    expect(findStored).not.toHaveBeenCalled();
  });

  test("accepts turning a mapping off", async () => {
    stubStoredDefinition({
      customFieldType: CustomFieldType.Text,
      mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      mapFromCustomFieldName: "Vendor",
    });
    const findMonitorFields: jest.SpyInstance = jest
      .spyOn(MonitorCustomFieldService, "findBy")
      .mockResolvedValue([] as never);

    const updateBy: UpdateBy<AlertCustomField> = buildUpdateBy({
      mapFromResourceType: "",
    });

    await expect(
      validateCustomFieldMappingOnUpdate({
        definitionModelType: AlertCustomField,
        definitionService: AlertCustomFieldService,
        updateBy: updateBy,
      }),
    ).resolves.toBeUndefined();

    expect((updateBy.data as JSONObject)["mapFromResourceType"]).toBeNull();
    expect((updateBy.data as JSONObject)["mapFromCustomFieldName"]).toBeNull();
    expect(findMonitorFields).not.toHaveBeenCalled();
  });
});
