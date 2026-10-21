import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
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

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
/*
 * An incident created with `createdIncidentTemplateId` (API callers that send
 * only the template, and the root paths that declare from one) copies the
 * template's custom field values - a MERGE into what the incident is given:
 *
 *   - the template fills in the fields the incident leaves out;
 *   - a value the incident sets wins, 0, false and null included;
 *   - the template's values are not checked as the caller's (the check sees
 *     only what the caller sent), so a stale template value never refuses
 *     the incident;
 *   - the mapping from monitors still runs after the copy, and wins for a
 *     mapped field.
 */

const projectId: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const templateId: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
};

type OnBeforeCreate = (
  createBy: CreateBy<Incident>,
) => Promise<OnCreate<Incident>>;

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

let template: IncidentTemplate | null = null;
let templateFindOneBy: MockFunction;
let definitionFindBy: MockFunction;
let applyMappingsToCreate: MockFunction;

function templateWith(customFields: unknown): IncidentTemplate {
  const incidentTemplate: IncidentTemplate = new IncidentTemplate();
  incidentTemplate._id = templateId;
  incidentTemplate.customFields = customFields as JSONObject;
  return incidentTemplate;
}

function newIncident(customFields?: unknown): Incident {
  const incident: Incident = new Incident();
  incident.title = "Site outage";
  incident.incidentSeverityId = new ObjectID(
    "d0000000-0000-4000-8000-000000000001",
  );
  incident.createdIncidentTemplateId = templateId;

  if (customFields !== undefined) {
    incident.customFields = customFields as JSONObject;
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

beforeEach(() => {
  template = null;

  const createdState: IncidentState = new IncidentState();
  createdState._id = "c0000000-0000-4000-8000-000000000001";
  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(createdState as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockResolvedValue({ counter: 7, prefix: undefined } as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("Test User") as never);

  templateFindOneBy = getJestMockFunction();
  templateFindOneBy.mockImplementation(() => {
    return Promise.resolve(template);
  });
  jest
    .spyOn(IncidentTemplateService, "findOneBy")
    .mockImplementation(templateFindOneBy as never);

  definitionFindBy = getJestMockFunction();
  definitionFindBy.mockResolvedValue([
    definition("Impact", CustomFieldType.Dropdown, "Low\nMedium\nHigh"),
    definition("Estimated Duration", CustomFieldType.Number),
    definition("Acknowledgement", CustomFieldType.Boolean),
  ] as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockImplementation(definitionFindBy as never);

  applyMappingsToCreate = getJestMockFunction();
  applyMappingsToCreate.mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockImplementation(applyMappingsToCreate as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentService.onBeforeCreate: a template's custom field values", () => {
  test("are read with the template, as root and within the project", async () => {
    template = templateWith({ Impact: "High" });

    await runBeforeCreate(newIncident());

    const findOneBy: {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    } = templateFindOneBy.mock.calls[0]![0] as {
      query: JSONObject;
      select: JSONObject;
      props: DatabaseCommonInteractionProps;
    };

    expect(findOneBy.select["customFields"]).toBe(true);
    expect(findOneBy.query["projectId"]).toBe(projectId);
    expect(findOneBy.query["_id"]).toBe(templateId);
    expect(findOneBy.props).toEqual({ isRoot: true });
  });

  test("an incident created with none gets the template's", async () => {
    template = templateWith({ Impact: "High", Category: "Network" });

    const created: Incident = await runBeforeCreate(newIncident());

    expect(created.customFields).toEqual({
      Impact: "High",
      Category: "Network",
    });
  });

  test("merge into the incident's own values: the template fills only the gaps", async () => {
    template = templateWith({ Impact: "High", Category: "Network" });

    const created: Incident = await runBeforeCreate(
      newIncident({ Impact: "Low", Ticket: "OPS-7" }),
    );

    expect(created.customFields).toEqual({
      Impact: "Low",
      Category: "Network",
      Ticket: "OPS-7",
    });
  });

  test("0, false and null from the caller are kept, not filled over", async () => {
    template = templateWith({
      "Estimated Duration": 5,
      Acknowledgement: true,
      Impact: "High",
    });

    const created: Incident = await runBeforeCreate(
      newIncident({
        "Estimated Duration": 0,
        Acknowledgement: false,
        Impact: null,
      }),
    );

    expect(created.customFields).toEqual({
      "Estimated Duration": 0,
      Acknowledgement: false,
      Impact: null,
    });
  });

  test("a template value that no longer fits its field does not refuse the incident", async () => {
    // "Critical" was removed from Impact after the template was saved.
    template = templateWith({ Impact: "Critical" });

    const created: Incident = await runBeforeCreate(
      newIncident({ Acknowledgement: true }),
    );

    expect(created.customFields).toEqual({
      Impact: "Critical",
      Acknowledgement: true,
    });

    // Only the caller's own values were checked.
    expect(definitionFindBy).toHaveBeenCalledTimes(1);
  });

  test("the caller's values are still checked", async () => {
    template = templateWith({ Impact: "High" });

    await expect(
      runBeforeCreate(newIncident({ Impact: "Critical" })),
    ).rejects.toThrow('"Critical" is not one of the options for "Impact"');
  });

  test("a template without values leaves the incident's as they are", async () => {
    for (const templateCustomFields of [undefined, null, {}]) {
      template = templateWith(templateCustomFields);

      const withValues: Incident = await runBeforeCreate(
        newIncident({ Ticket: "OPS-7" }),
      );
      expect(withValues.customFields).toEqual({ Ticket: "OPS-7" });

      const withoutValues: Incident = await runBeforeCreate(newIncident());
      expect(withoutValues.customFields).toBeUndefined();
    }
  });

  test("no template found, nothing copied", async () => {
    template = null;

    const created: Incident = await runBeforeCreate(newIncident());

    expect(created.customFields).toBeUndefined();
  });

  test("the mapping from monitors runs after the copy, and wins for a mapped field", async () => {
    template = templateWith({ Impact: "High", Category: "Network" });

    let seenByMapping: JSONObject | undefined = undefined;

    applyMappingsToCreate.mockImplementation(((data: {
      createBy: CreateBy<Incident>;
    }) => {
      seenByMapping = { ...(data.createBy.data.customFields || {}) };
      data.createBy.data.customFields = {
        ...(data.createBy.data.customFields || {}),
        Impact: "Copied From Monitor",
      };
      return Promise.resolve();
    }) as never);

    const created: Incident = await runBeforeCreate(newIncident());

    expect(seenByMapping).toEqual({ Impact: "High", Category: "Network" });
    expect(created.customFields).toEqual({
      Impact: "Copied From Monitor",
      Category: "Network",
    });
  });

  test("a root create from a template copies them too", async () => {
    template = templateWith({ Impact: "High" });

    const incident: Incident = newIncident();
    incident.projectId = projectId;

    const created: Incident = await runBeforeCreate(incident, {
      isRoot: true,
    });

    expect(created.customFields).toEqual({ Impact: "High" });
  });
});
