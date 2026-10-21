import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the form builder, its preview and the On Submit page read besides
 * the form: the target's custom fields (and which of them copy a monitor's
 * value), and the records a choice question can offer. Only the network
 * and the current project are stubbed.
 */

const getListMock: MockFunction = getJestMockFunction();
let mockProjectId: string | null = "11111111-1111-4111-8111-111111111111";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        if (!mockProjectId) {
          return null;
        }

        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(mockProjectId);
      },
    },
  };
});

import {
  loadFormCustomFields,
  loadFormRecordOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormBuilderData";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { FormCustomFieldDefinition } from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import ObjectID from "../../../Types/ObjectID";

const UPPER_ID: string = "AAAAAAAA-0000-4000-8000-000000000001";

let rows: Array<Record<string, unknown>>;

beforeEach(() => {
  mockProjectId = "11111111-1111-4111-8111-111111111111";
  rows = [];
  getListMock.mockReset();
  getListMock.mockImplementation(async (): Promise<unknown> => {
    return {
      data: rows,
      count: rows.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function lastRequest(): Record<string, unknown> {
  return getListMock.mock.calls[
    getListMock.mock.calls.length - 1
  ]![0] as Record<string, unknown>;
}

describe("the target's custom fields", () => {
  test("an incident form reads the project's incident custom fields, in their order", async () => {
    await loadFormCustomFields(FormTargetType.Incident);

    const request: Record<string, unknown> = lastRequest();

    expect(request["modelType"]).toBe(IncidentCustomField);
    expect(
      (
        (request["query"] as Record<string, unknown>)["projectId"] as ObjectID
      ).toString(),
    ).toBe("11111111-1111-4111-8111-111111111111");
    expect(request["select"]).toEqual({
      _id: true,
      name: true,
      description: true,
      customFieldType: true,
      dropdownOptions: true,
      mapFromResourceType: true,
      mapFromCustomFieldName: true,
    });
    expect(request["sort"]).toEqual({ sortOrder: SortOrder.Ascending });
    expect(request["limit"]).toBe(LIMIT_PER_PROJECT);
  });

  test("a maintenance form reads the maintenance custom fields, by name", async () => {
    await loadFormCustomFields(FormTargetType.ScheduledMaintenance);

    const request: Record<string, unknown> = lastRequest();

    expect(request["modelType"]).toBe(ScheduledMaintenanceCustomField);
    expect(request["sort"]).toEqual({ name: SortOrder.Ascending });
    expect(request["select"]).toEqual(
      expect.objectContaining({
        mapFromResourceType: true,
        mapFromCustomFieldName: true,
      }),
    );
  });

  test("each field as the builder reads it: its id lower-cased, a field with no id or name left out", async () => {
    rows = [
      {
        _id: UPPER_ID,
        name: "Region",
        description: "Where",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "EU\nUS",
      },
      { _id: undefined, name: "No id" },
      { _id: "bbbbbbbb-0000-4000-8000-000000000002", name: "" },
    ];

    const definitions: Array<FormCustomFieldDefinition> =
      await loadFormCustomFields(FormTargetType.Incident);

    expect(definitions).toEqual([
      {
        id: UPPER_ID.toLowerCase(),
        name: "Region",
        description: "Where",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "EU\nUS",
      },
    ]);
  });

  test("a field that copies a monitor's value says so; a half-set mapping does not", async () => {
    rows = [
      {
        _id: "cccccccc-0000-4000-8000-000000000001",
        name: "Vendor",
        mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
        mapFromCustomFieldName: "Vendor",
      },
      {
        _id: "cccccccc-0000-4000-8000-000000000002",
        name: "Team",
        mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
      },
      {
        _id: "cccccccc-0000-4000-8000-000000000003",
        name: "Impact",
      },
    ];

    const definitions: Array<FormCustomFieldDefinition> =
      await loadFormCustomFields(FormTargetType.Incident);

    expect(
      definitions.map((definition: FormCustomFieldDefinition): unknown => {
        return [definition.name, Boolean(definition.isCopiedFromMonitor)];
      }),
    ).toEqual([
      ["Vendor", true],
      ["Team", false],
      ["Impact", false],
    ]);
  });

  test("nothing, without a project", async () => {
    mockProjectId = null;

    expect(await loadFormCustomFields(FormTargetType.Incident)).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("the records a choice offers", () => {
  test.each([
    [
      FormTargetOptionsSource.IncidentSeverity,
      IncidentSeverity,
      { _id: true, name: true, color: true },
      { order: SortOrder.Ascending },
    ],
    [
      FormTargetOptionsSource.Monitor,
      Monitor,
      { _id: true, name: true },
      { name: SortOrder.Ascending },
    ],
    [
      FormTargetOptionsSource.Label,
      Label,
      { _id: true, name: true, color: true },
      { name: SortOrder.Ascending },
    ],
    [
      FormTargetOptionsSource.StatusPage,
      StatusPage,
      { _id: true, name: true },
      { name: SortOrder.Ascending },
    ],
  ])(
    "%s: the project's, in the order a picker lists them",
    async (
      source: FormTargetOptionsSource,
      modelType: unknown,
      select: Record<string, boolean>,
      sort: Record<string, SortOrder>,
    ) => {
      await loadFormRecordOptions(source);

      const request: Record<string, unknown> = lastRequest();

      expect(request["modelType"]).toBe(modelType);
      expect(request["select"]).toEqual(select);
      expect(request["sort"]).toEqual(sort);
      expect(request["limit"]).toBe(LIMIT_PER_PROJECT);
    },
  );

  test("each as an option: its id lower-cased, its name, and its color where it has one", async () => {
    rows = [
      { _id: UPPER_ID, name: "Major", color: new Color("#ff0000") },
      { _id: "dddddddd-0000-4000-8000-000000000002", name: "Minor" },
      { _id: undefined, name: "No id" },
      { _id: "dddddddd-0000-4000-8000-000000000003" },
    ];

    expect(
      await loadFormRecordOptions(FormTargetOptionsSource.IncidentSeverity),
    ).toEqual([
      { id: UPPER_ID.toLowerCase(), name: "Major", color: "#ff0000" },
      { id: "dddddddd-0000-4000-8000-000000000002", name: "Minor" },
      { id: "dddddddd-0000-4000-8000-000000000003", name: "" },
    ]);
  });

  test("nothing for a source it does not know, or without a project", async () => {
    expect(
      await loadFormRecordOptions("Something" as FormTargetOptionsSource),
    ).toEqual([]);

    mockProjectId = null;

    expect(
      await loadFormRecordOptions(FormTargetOptionsSource.Monitor),
    ).toEqual([]);
    expect(getListMock).not.toHaveBeenCalled();
  });
});
