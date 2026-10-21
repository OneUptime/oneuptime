import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { validateCustomFieldCreateSettings } from "../../../Types/CustomField/CustomFieldCreateSettings";
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

/*
 * IncidentTemplate.customFieldSettings (issue #4114): which custom fields the
 * Declare Incident form asks for when an incident is declared from the
 * template, keyed by template variable key.
 *
 * Only the dashboard reads it, and leniently, so a malformed value would not
 * fail anything - it would silently do nothing. IncidentTemplateService
 * refuses one where it comes in instead, root writes included, and stores a
 * valid one exactly as sent: Terraform compares the column with its own
 * configuration, so a server that dropped Default entries or fixed the case
 * of a value would report a change on every plan.
 *
 * The database is stubbed the way IncidentTemplateStatusPageScope.test.ts
 * stubs it.
 */

const projectId: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e11",
);
const templateId: string = "a1b2c3d4-0000-4000-8000-0000000000ab";

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e12"),
  tenantId: projectId,
};

type OnBeforeCreate = (
  createBy: CreateBy<IncidentTemplate>,
) => Promise<OnCreate<IncidentTemplate>>;
type OnBeforeUpdate = (
  updateBy: UpdateBy<IncidentTemplate>,
) => Promise<OnUpdate<IncidentTemplate>>;

const INVALID_SETTINGS: Array<[string, unknown]> = [
  ["a setting spelled in lowercase", { impact: "required" }],
  ["a setting that does not exist", { impact: "Mandatory" }],
  [
    "a key that is the field's name rather than its template variable key",
    { "Affected Location": "Required" },
  ],
  ["a list", ["impact"]],
  ["a JSON string", '{"impact":"Required"}'],
  ["a number", 1],
];

let templateFindBy: MockFunction;
let validator: MockFunction;

async function runBeforeCreate(
  data: IncidentTemplate,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<IncidentTemplate> {
  const onCreate: OnCreate<IncidentTemplate> = await (
    IncidentTemplateService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });

  return onCreate.createBy.data;
}

async function runBeforeUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = MEMBER_PROPS,
): Promise<Record<string, unknown>> {
  const onUpdate: OnUpdate<IncidentTemplate> = await (
    IncidentTemplateService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: templateId },
    data: data as UpdateBy<IncidentTemplate>["data"],
    props: props,
    limit: 1,
    skip: 0,
  });

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

function template(customFieldSettings: unknown): IncidentTemplate {
  const created: IncidentTemplate = new IncidentTemplate();
  created.templateName = "Data breach";
  created.title = "Possible data breach";
  if (customFieldSettings !== undefined) {
    created.customFieldSettings = customFieldSettings as JSONObject;
  }

  return created;
}

beforeEach(() => {
  templateFindBy = getJestMockFunction();
  templateFindBy.mockImplementation(() => {
    const stored: IncidentTemplate = new IncidentTemplate();
    stored._id = templateId;
    stored.projectId = projectId;
    stored.statusPages = [];
    return Promise.resolve([stored]);
  });
  jest
    .spyOn(IncidentTemplateService, "findBy")
    .mockImplementation(templateFindBy as never);

  validator = getJestMockFunction();
  validator.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation(validator as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "getHeldRelationIds")
    .mockResolvedValue(new Map() as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentTemplateService: creating a template with custom field settings", () => {
  test("valid settings are stored exactly as sent, Default entries included", async () => {
    const settings: Record<string, unknown> = {
      impact: "Required",
      affected_location: "Optional",
      additional_information: "Hidden",
      customer: "Default",
    };

    const created: IncidentTemplate = await runBeforeCreate(template(settings));

    expect(created.customFieldSettings).toBe(settings);
    expect(settings).toEqual({
      impact: "Required",
      affected_location: "Optional",
      additional_information: "Hidden",
      customer: "Default",
    });
  });

  test("a template without settings - every existing one - is unaffected", async () => {
    const created: IncidentTemplate = await runBeforeCreate(
      template(undefined),
    );

    expect(created.customFieldSettings).toBeUndefined();
    await expect(runBeforeCreate(template(null))).resolves.toBeInstanceOf(
      IncidentTemplate,
    );
    await expect(runBeforeCreate(template({}))).resolves.toBeInstanceOf(
      IncidentTemplate,
    );
  });

  test.each(INVALID_SETTINGS)(
    "settings with %s are refused with the validator's message, before anything is looked up",
    async (_label: string, settings: unknown) => {
      await expect(runBeforeCreate(template(settings))).rejects.toThrow(
        new BadDataException(validateCustomFieldCreateSettings(settings)!),
      );
      expect(validator).not.toHaveBeenCalled();
    },
  );

  test("the message points at the template variable key", async () => {
    await expect(
      runBeforeCreate(template({ "Affected Location": "Required" })),
    ).rejects.toThrow(
      "is not an incident custom field's template variable key",
    );
  });

  test("a root create - a workflow's - is held to the same rule", async () => {
    await expect(
      runBeforeCreate(template({ impact: "Sometimes" }), { isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("IncidentTemplateService: updating a template's custom field settings", () => {
  test("valid settings are stored exactly as sent", async () => {
    const settings: Record<string, unknown> = {
      impact: "Hidden",
      customer: "Default",
    };

    const data: Record<string, unknown> = await runBeforeUpdate({
      customFieldSettings: settings,
    });

    expect(data["customFieldSettings"]).toBe(settings);
    expect(settings).toEqual({ impact: "Hidden", customer: "Default" });
  });

  test("clearing them is fine", async () => {
    expect(
      (await runBeforeUpdate({ customFieldSettings: null }))[
        "customFieldSettings"
      ],
    ).toBeNull();
  });

  test.each(INVALID_SETTINGS)(
    "settings with %s are refused before anything is looked up",
    async (_label: string, settings: unknown) => {
      await expect(
        runBeforeUpdate({ customFieldSettings: settings }),
      ).rejects.toThrow(
        new BadDataException(validateCustomFieldCreateSettings(settings)!),
      );
      expect(templateFindBy).not.toHaveBeenCalled();
      expect(validator).not.toHaveBeenCalled();
    },
  );

  test("invalid settings are refused even next to changes that need no check", async () => {
    await expect(
      runBeforeUpdate({
        templateName: "Renamed",
        customFieldSettings: { impact: "yes" },
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("an update that does not write them is not affected", async () => {
    expect(await runBeforeUpdate({ templateName: "Renamed" })).toEqual({
      templateName: "Renamed",
    });
  });

  test("a root update is held to the same rule", async () => {
    await expect(
      runBeforeUpdate({ customFieldSettings: [] }, { isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });

  test("the rest of the hook still runs for a valid update: a new severity is still checked", async () => {
    await runBeforeUpdate({
      customFieldSettings: { impact: "Required" },
      incidentSeverityId: "b0000000-0000-4000-8000-0000000000ab",
    });

    expect(validator).toHaveBeenCalledTimes(1);
  });
});
