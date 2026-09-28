import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

/*
 * IncidentService checks the custom field values a write puts on an incident
 * against the project's incident custom fields (CustomFieldValueValidator).
 * What these pin is how that check sits in the incident's write path:
 *
 *   - a user's (or API key's) write is checked, on create and on update;
 *   - on update only what the write CHANGES is checked, against what each
 *     incident already holds - an unchanged legacy value passes;
 *   - root writes skip it;
 *   - values the mapping copies from monitors are added after the check, so
 *     a mapping write is never refused by it;
 *   - nothing is read when the write carries no custom fields.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const incidentId: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type OnBeforeUpdate = (
  updateBy: UpdateBy<Incident>,
) => Promise<OnUpdate<Incident>>;

type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
};

function definition(
  name: string,
  customFieldType: CustomFieldType,
  dropdownOptions?: string,
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.name = name;
  field.customFieldType = customFieldType;

  if (dropdownOptions) {
    field.dropdownOptions = dropdownOptions;
  }

  return field;
}

const DEFINITIONS: Array<IncidentCustomField> = [
  definition("Impact", CustomFieldType.Dropdown, "Low\nMedium\nHigh"),
  definition("Estimated Duration", CustomFieldType.Number),
  definition("Acknowledgement", CustomFieldType.Boolean),
];

function storedIncident(
  customFields: JSONObject | undefined,
  id: ObjectID = incidentId,
  incidentProjectId: ObjectID = projectId,
): Incident {
  const incident: Incident = new Incident();
  incident._id = id.toString();
  incident.projectId = incidentProjectId;

  if (customFields) {
    incident.customFields = customFields;
  }

  return incident;
}

let storedIncidents: Array<Incident> = [];
let incidentFindBy: MockFunction;
let definitionFindBy: MockFunction;
let applyMappingsToUpdate: MockFunction;
let applyMappingsToCreate: MockFunction;

function update(data: {
  customFields?: unknown;
  props?: DatabaseCommonInteractionProps;
  query?: JSONObject;
}): UpdateBy<Incident> {
  return {
    query: (data.query || { _id: incidentId.toString() }) as never,
    data: (data.customFields === undefined
      ? { title: "Renamed" }
      : { customFields: data.customFields }) as never,
    props: data.props || MEMBER_PROPS,
    limit: 1,
    skip: 0,
  };
}

async function runBeforeUpdate(
  updateBy: UpdateBy<Incident>,
): Promise<JSONObject> {
  const onUpdate: OnUpdate<Incident> = await (
    IncidentService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);

  return onUpdate.updateBy.data as unknown as JSONObject;
}

beforeEach(() => {
  storedIncidents = [storedIncident({ Impact: "Severe", Summary: "old" })];

  incidentFindBy = getJestMockFunction();
  incidentFindBy.mockImplementation(() => {
    return Promise.resolve(storedIncidents);
  });
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentFindBy as never);

  definitionFindBy = getJestMockFunction();
  definitionFindBy.mockImplementation(() => {
    return Promise.resolve(DEFINITIONS);
  });
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockImplementation(definitionFindBy as never);

  jest
    .spyOn(
      IncidentService as unknown as {
        validateProjectScopedReferences: () => Promise<void>;
      },
      "validateProjectScopedReferences",
    )
    .mockResolvedValue(undefined as never);

  applyMappingsToUpdate = getJestMockFunction();
  applyMappingsToUpdate.mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockImplementation(applyMappingsToUpdate as never);

  applyMappingsToCreate = getJestMockFunction();
  applyMappingsToCreate.mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockImplementation(applyMappingsToCreate as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService.onBeforeUpdate: custom field values", () => {
  test("a changed value that does not fit its field is refused", async () => {
    await expect(
      runBeforeUpdate(update({ customFields: { Impact: "Critical" } })),
    ).rejects.toThrow(BadDataException);

    await expect(
      runBeforeUpdate(update({ customFields: { Impact: "Critical" } })),
    ).rejects.toThrow(
      '"Critical" is not one of the options for "Impact". Choose one of: "Low", "Medium", "High".',
    );
  });

  test("a changed value of the wrong type is refused", async () => {
    await expect(
      runBeforeUpdate(
        update({ customFields: { "Estimated Duration": "about an hour" } }),
      ),
    ).rejects.toThrow('"Estimated Duration" holds a number');
  });

  test("an unchanged legacy value passes, so the rest of the card can be saved", async () => {
    // "Severe" is no longer an option, but this write does not change it.
    const data: JSONObject = await runBeforeUpdate(
      update({
        customFields: {
          Impact: "Severe",
          Summary: "edited",
          "Estimated Duration": "90",
        },
      }),
    );

    expect(data["customFields"]).toEqual({
      Impact: "Severe",
      Summary: "edited",
      "Estimated Duration": "90",
    });
  });

  test("changing the legacy value to a valid option passes", async () => {
    await expect(
      runBeforeUpdate(update({ customFields: { Impact: "High" } })),
    ).resolves.toBeDefined();
  });

  test("clearing a field passes", async () => {
    await expect(
      runBeforeUpdate(
        update({ customFields: { Impact: null, "Estimated Duration": "" } }),
      ),
    ).resolves.toBeDefined();
  });

  test("keys with no field definition pass", async () => {
    await expect(
      runBeforeUpdate(update({ customFields: { "Deleted Field": [1, 2] } })),
    ).resolves.toBeDefined();
  });

  test("reads the incidents the update writes, limited to the caller's project", async () => {
    await runBeforeUpdate(update({ customFields: { Impact: "High" } }));

    const read: JSONObject = incidentFindBy.mock.calls[0]![0] as JSONObject;

    expect((read["query"] as JSONObject)["projectId"]).toBe(projectId);
    expect((read["select"] as JSONObject)["customFields"]).toBe(true);
    expect((read["props"] as JSONObject)["isRoot"]).toBe(true);

    const definitions: JSONObject = definitionFindBy.mock
      .calls[0]![0] as JSONObject;

    expect((definitions["query"] as JSONObject)["projectId"]).toBe(projectId);
    expect(definitions["select"]).toEqual({
      name: true,
      customFieldType: true,
      dropdownOptions: true,
    });
  });

  test("each incident of a multi-row update is judged by what it holds", async () => {
    storedIncidents = [
      storedIncident({ Impact: "Severe" }),
      storedIncident(
        { Impact: "High" },
        new ObjectID("55555555-5555-4555-8555-555555555555"),
      ),
    ];

    // Unchanged for the first incident, a change for the second.
    await expect(
      runBeforeUpdate(
        update({
          customFields: { Impact: "Severe" },
          query: { projectId: projectId.toString() },
        }),
      ),
    ).rejects.toThrow('"Severe" is not one of the options for "Impact"');
  });

  test("definitions are read once per project", async () => {
    storedIncidents = [
      storedIncident({}),
      storedIncident({}, new ObjectID("55555555-5555-4555-8555-555555555555")),
    ];

    await runBeforeUpdate(update({ customFields: { Impact: "High" } }));

    expect(definitionFindBy).toHaveBeenCalledTimes(1);
  });

  test("an update that matches no incident has nothing to check", async () => {
    storedIncidents = [];

    await expect(
      runBeforeUpdate(update({ customFields: { Impact: "Critical" } })),
    ).resolves.toBeDefined();
    expect(definitionFindBy).not.toHaveBeenCalled();
  });

  test("a root write is not checked", async () => {
    await expect(
      runBeforeUpdate(
        update({
          customFields: { Impact: "Critical" },
          props: { isRoot: true },
        }),
      ),
    ).resolves.toBeDefined();
    expect(definitionFindBy).not.toHaveBeenCalled();
  });

  test("mapped values are added after the check, so a mapping write is not refused", async () => {
    /*
     * The mapping resolves "Critical" from a monitor's field. It is folded
     * into the write after the caller's values were checked.
     */
    applyMappingsToUpdate.mockImplementation(((data: {
      updateBy: UpdateBy<Incident>;
    }) => {
      (data.updateBy.data as unknown as JSONObject)["customFields"] = {
        ...((data.updateBy.data as unknown as JSONObject)[
          "customFields"
        ] as JSONObject),
        Impact: "Critical",
      };
      return Promise.resolve();
    }) as never);

    const data: JSONObject = await runBeforeUpdate(
      update({ customFields: { Summary: "edited" } }),
    );

    expect(data["customFields"]).toEqual({
      Summary: "edited",
      Impact: "Critical",
    });
    expect(applyMappingsToUpdate).toHaveBeenCalled();
  });

  test("a write without custom fields reads nothing for them", async () => {
    await runBeforeUpdate(update({}));

    expect(definitionFindBy).not.toHaveBeenCalled();
  });

  test.each([[null], [{}], ["not an object"], [["a"]]])(
    "a custom fields value of %j has nothing to check",
    async (customFields: unknown) => {
      await runBeforeUpdate(update({ customFields }));

      expect(definitionFindBy).not.toHaveBeenCalled();
    },
  );
});

describe("IncidentService.onBeforeCreate: custom field values", () => {
  beforeEach(() => {
    const createdState: IncidentState = new IncidentState();
    createdState._id = "c0000000-0000-4000-8000-000000000001";
    jest
      .spyOn(IncidentStateService, "findOneBy")
      .mockResolvedValue(createdState as never);
    jest
      .spyOn(ProjectService, "incrementAndGetIncidentCounter")
      .mockResolvedValue({ counter: 7, prefix: undefined } as never);
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue("Test User" as never);
    jest
      .spyOn(IncidentTemplateService, "findOneBy")
      .mockResolvedValue(null as never);
  });

  function newIncident(customFields?: JSONObject): Incident {
    const incident: Incident = new Incident();
    incident.title = "Site outage";
    incident.incidentSeverityId = new ObjectID(
      "d0000000-0000-4000-8000-000000000001",
    );

    if (customFields) {
      incident.customFields = customFields;
    }

    return incident;
  }

  async function runBeforeCreate(
    data: Incident,
    props: DatabaseCommonInteractionProps = MEMBER_PROPS,
  ): Promise<Incident> {
    const onCreate: OnCreate<Incident> = await (
      IncidentService as unknown as { onBeforeCreate: OnBeforeCreate }
    ).onBeforeCreate({ data, props });

    return onCreate.createBy.data;
  }

  test("a value that does not fit its field is refused", async () => {
    await expect(
      runBeforeCreate(newIncident({ Acknowledgement: "yes" })),
    ).rejects.toThrow('"Acknowledgement" holds true or false');

    // Refused before anything is written or numbered.
    expect(
      ProjectService.incrementAndGetIncidentCounter,
    ).not.toHaveBeenCalled();
  });

  test("every value is new on create, so a removed option is refused", async () => {
    await expect(
      runBeforeCreate(newIncident({ Impact: "Severe" })),
    ).rejects.toThrow('"Severe" is not one of the options for "Impact"');
  });

  test("values that fit their fields are kept as sent", async () => {
    const created: Incident = await runBeforeCreate(
      newIncident({
        Impact: "High",
        "Estimated Duration": "0",
        Acknowledgement: false,
      }),
    );

    expect(created.customFields).toEqual({
      Impact: "High",
      "Estimated Duration": "0",
      Acknowledgement: false,
    });
    expect((definitionFindBy.mock.calls[0]![0] as JSONObject)["query"]).toEqual(
      { projectId: projectId },
    );
  });

  test("a root create is not checked", async () => {
    await expect(
      runBeforeCreate(newIncident({ Impact: "Critical" }), {
        isRoot: true,
        tenantId: projectId,
      }),
    ).resolves.toBeDefined();
    expect(definitionFindBy).not.toHaveBeenCalled();
  });

  test("an incident without custom fields reads no definitions", async () => {
    await runBeforeCreate(newIncident());

    expect(definitionFindBy).not.toHaveBeenCalled();
  });

  test("mapped values are resolved after the check", async () => {
    applyMappingsToCreate.mockImplementation(((data: {
      createBy: CreateBy<Incident>;
    }) => {
      data.createBy.data.customFields = {
        ...(data.createBy.data.customFields || {}),
        Impact: "Copied From Monitor",
      };
      return Promise.resolve();
    }) as never);

    const created: Incident = await runBeforeCreate(
      newIncident({ "Estimated Duration": 5 }),
    );

    expect(created.customFields).toEqual({
      "Estimated Duration": 5,
      Impact: "Copied From Monitor",
    });
  });

  test("checks the caller's project's definitions, not another's", async () => {
    await runBeforeCreate(newIncident({ Impact: "High" }), {
      tenantId: projectId,
    });

    const query: JSONObject = (
      definitionFindBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;

    expect(query["projectId"]).toBe(projectId);
    expect(query["projectId"]).not.toBe(otherProjectId);
  });
});

describe("IncidentService: where the custom field check sits", () => {
  /*
   * The order is the contract: the check has to see only what the caller
   * sent, so it must run before an incident template's values are copied in
   * and before mapped values are resolved.
   */
  const source: string = fs
    .readFileSync(
      path.join(__dirname, "../../../Server/Services/IncidentService.ts"),
      "utf8",
    )
    .replace(/\s+/g, " ");

  function between(start: string, end: string): string {
    const from: number = source.indexOf(start);
    const to: number = source.indexOf(end, from);

    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    return source.slice(from, to);
  }

  test("on create, before the template copy and the mapping", () => {
    const body: string = between(
      "protected override async onBeforeCreate(",
      "protected override async onCreateSuccess(",
    );

    const check: number = body.indexOf(
      "this.validateCustomFieldValuesOnCreate(",
    );
    const template: number = body.indexOf(
      "createBy.data.createdIncidentTemplateId",
    );
    const mapping: number = body.indexOf(
      "CustomFieldMappingService.applyMappingsToCreate(",
    );

    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(template);
    expect(check).toBeLessThan(mapping);
  });

  test("on update, before the mapping", () => {
    const body: string = between(
      "protected override async onBeforeUpdate(",
      "private async findIncidentsForUpdateHook(",
    );

    const check: number = body.indexOf(
      "this.validateCustomFieldValuesOnUpdate(updateBy)",
    );
    const mapping: number = body.indexOf(
      "CustomFieldMappingService.applyMappingsToUpdate(",
    );

    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(mapping);
  });
});
