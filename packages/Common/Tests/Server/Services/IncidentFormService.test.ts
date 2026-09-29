import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentFormService, {
  INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE,
  INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE,
  INCIDENT_FORM_SHARE_KEY_MESSAGE,
} from "../../../Server/Services/IncidentFormService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { validateCustomFieldCreateSettings } from "../../../Types/CustomField/CustomFieldCreateSettings";
import BadDataException from "../../../Types/Exception/BadDataException";
import { validateIncidentFormIpAllowlist } from "../../../Types/Incident/IncidentFormIpAllowlist";
import { IncidentFormFieldSetting } from "../../../Types/Incident/IncidentFormPublic";
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
 * IncidentFormService is what the public page and every submission trust
 * about a form, so a form is refused at the write that would make it wrong:
 *
 *   - its link key is minted on create - whatever the request carried - and
 *     only ever replaced by another UUID;
 *   - its questions and its description setting are values the public page
 *     and the submit route understand, stored exactly as sent;
 *   - its severity and template belong to its own project (every incident
 *     declared through it is created there with them), and it has a
 *     severity.
 *
 * The database is stubbed: the reference validator by a spy (what it is
 * asked is the point), stored forms by a stub of findBy.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f02",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const CLIENT_KEY: string = "d0000000-0000-4000-8000-0000000000f1";

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
  tenantId: PROJECT_ID,
};

type OnBeforeCreate = (
  createBy: CreateBy<IncidentForm>,
) => Promise<OnCreate<IncidentForm>>;
type OnBeforeUpdate = (
  updateBy: UpdateBy<IncidentForm>,
) => Promise<OnUpdate<IncidentForm>>;

interface ValidatorCall {
  projectId: ObjectID | undefined;
  subject?: string | undefined;
  references: Array<ProjectScopedReference>;
}

let validator: MockFunction;
let formFindBy: MockFunction;
let storedForms: Array<IncidentForm> = [];

function storedForm(projectId: ObjectID, id: string = FORM_ID): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form._id = id;
  form.projectId = projectId;
  return form;
}

function newForm(data: Partial<IncidentForm> = {}): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form.name = "Report a Security Concern";
  form.incidentSeverityId = new ObjectID(SEVERITY_ID);
  Object.assign(form, data);
  return form;
}

async function runBeforeCreate(
  data: IncidentForm,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<IncidentForm> {
  const onCreate: OnCreate<IncidentForm> = await (
    IncidentFormService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });

  return onCreate.createBy.data;
}

async function runBeforeUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<Record<string, unknown>> {
  const onUpdate: OnUpdate<IncidentForm> = await (
    IncidentFormService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: FORM_ID },
    data: data as UpdateBy<IncidentForm>["data"],
    props: props,
    limit: 1,
    skip: 0,
  });

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

function validatorCalls(): Array<ValidatorCall> {
  return validator.mock.calls.map((call: Array<unknown>): ValidatorCall => {
    return call[0] as ValidatorCall;
  });
}

// What the validator was asked, as plain ids.
function askedIds(call: ValidatorCall): Record<string, string | undefined> {
  const asked: Record<string, string | undefined> = {};

  for (const reference of call.references) {
    asked[reference.modelName] = reference.id
      ? reference.id.toString()
      : undefined;
  }

  return asked;
}

beforeEach(() => {
  storedForms = [storedForm(PROJECT_ID)];

  validator = getJestMockFunction();
  validator.mockImplementation(() => {
    return Promise.resolve(undefined);
  });
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation(validator as never);

  formFindBy = getJestMockFunction();
  formFindBy.mockImplementation(() => {
    return Promise.resolve(storedForms);
  });
  jest
    .spyOn(IncidentFormService, "findBy")
    .mockImplementation(formFindBy as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentFormService.onBeforeCreate: the link key", () => {
  test("every form is created with a key, a UUID", async () => {
    const created: IncidentForm = await runBeforeCreate(newForm());

    expect(created.shareKey).toBeInstanceOf(ObjectID);
    expect(ObjectID.isValidUUID(created.shareKey!.toString())).toBe(true);
  });

  test("a key sent with the create is replaced, never kept", async () => {
    const created: IncidentForm = await runBeforeCreate(
      newForm({ shareKey: new ObjectID(CLIENT_KEY) }),
    );

    expect(created.shareKey!.toString()).not.toBe(CLIENT_KEY);
    expect(ObjectID.isValidUUID(created.shareKey!.toString())).toBe(true);
  });

  test("a root create - a workflow's - is given a fresh key too", async () => {
    const created: IncidentForm = await runBeforeCreate(
      newForm({
        projectId: PROJECT_ID,
        shareKey: new ObjectID(CLIENT_KEY),
      }),
      { isRoot: true },
    );

    expect(created.shareKey!.toString()).not.toBe(CLIENT_KEY);
  });

  test("no two forms get the same key", async () => {
    const keys: Set<string> = new Set<string>();

    for (let index: number = 0; index < 25; index++) {
      keys.add((await runBeforeCreate(newForm())).shareKey!.toString());
    }

    expect(keys.size).toBe(25);
  });
});

describe("IncidentFormService.onBeforeCreate: the severity and the template", () => {
  test("asks the reference validator about exactly the form's severity and template, in the caller's project", async () => {
    await runBeforeCreate(
      newForm({ incidentTemplateId: new ObjectID(TEMPLATE_ID) }),
    );

    expect(validator).toHaveBeenCalledTimes(1);

    const call: ValidatorCall = validatorCalls()[0]!;

    expect(call.projectId).toBe(PROJECT_ID);
    expect(call.subject).toBe("incident form");
    expect(askedIds(call)).toEqual({
      "Incident Severity": SEVERITY_ID,
      "Incident Template": TEMPLATE_ID,
    });
    expect(
      call.references.map((reference: ProjectScopedReference): unknown => {
        return reference.service;
      }),
    ).toEqual([IncidentSeverityService, IncidentTemplateService]);
  });

  test("reads the ids from relation objects too", async () => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = SEVERITY_ID;
    const template: IncidentTemplate = new IncidentTemplate();
    template._id = TEMPLATE_ID;

    const form: IncidentForm = newForm({
      incidentSeverity: severity,
      incidentTemplate: template,
    });
    delete form.incidentSeverityId;

    await runBeforeCreate(form);

    expect(askedIds(validatorCalls()[0]!)).toEqual({
      "Incident Severity": SEVERITY_ID,
      "Incident Template": TEMPLATE_ID,
    });
  });

  test("a form with no template only has its severity checked", async () => {
    await runBeforeCreate(newForm());

    expect(askedIds(validatorCalls()[0]!)).toEqual({
      "Incident Severity": SEVERITY_ID,
      "Incident Template": undefined,
    });
  });

  test("a root create is checked in the project the row names", async () => {
    await runBeforeCreate(newForm({ projectId: OTHER_PROJECT_ID }), {
      isRoot: true,
    });

    expect(validatorCalls()[0]!.projectId).toBe(OTHER_PROJECT_ID);
  });

  test("a severity or template from another project is refused", async () => {
    validator.mockImplementation(() => {
      return Promise.reject(
        new BadDataException(
          "This incident form references a Incident Template from a different project.",
        ),
      );
    });

    await expect(
      runBeforeCreate(
        newForm({ incidentTemplateId: new ObjectID(TEMPLATE_ID) }),
      ),
    ).rejects.toThrow("from a different project");
  });

  test.each([
    ["no severity at all", {}],
    ["a null severity", { incidentSeverityId: null }],
    ["an empty severity", { incidentSeverityId: "" }],
    ["a severity relation without an id", { incidentSeverity: {} }],
  ])(
    "a form with %s is refused, with a message that says what to do",
    async (_label: string, severity: Record<string, unknown>) => {
      const form: IncidentForm = newForm();
      delete form.incidentSeverityId;
      Object.assign(form, severity);

      await expect(runBeforeCreate(form)).rejects.toThrow(
        new BadDataException(INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE),
      );
      expect(validator).not.toHaveBeenCalled();
    },
  );
});

describe("IncidentFormService.onBeforeCreate: the questions", () => {
  test("valid custom field settings are stored exactly as sent - Default entries included", async () => {
    const settings: Record<string, unknown> = {
      impact: "Required",
      affected_location: "Optional",
      customer: "Default",
      region: "Hidden",
    };

    const created: IncidentForm = await runBeforeCreate(
      newForm({
        customFieldSettings: settings as JSONObject,
      }),
    );

    expect(created.customFieldSettings).toBe(settings);
    expect(created.customFieldSettings).toEqual({
      impact: "Required",
      affected_location: "Optional",
      customer: "Default",
      region: "Hidden",
    });
  });

  test.each([
    ["a setting that is not one", { impact: "Mandatory" }],
    ["a key that is a field name", { Impact: "Required" }],
    ["a list", ["impact"]],
    ["a JSON string", '{"impact":"Required"}'],
  ])(
    "custom field settings with %s are refused with the validator's own message, before anything is looked up",
    async (_label: string, settings: unknown) => {
      await expect(
        runBeforeCreate(
          newForm({
            customFieldSettings: settings as JSONObject,
          }),
        ),
      ).rejects.toThrow(
        new BadDataException(validateCustomFieldCreateSettings(settings)!),
      );
      expect(validator).not.toHaveBeenCalled();
    },
  );

  test("no custom field settings is fine", async () => {
    await expect(runBeforeCreate(newForm())).resolves.toBeInstanceOf(
      IncidentForm,
    );
    await expect(
      runBeforeCreate(newForm({ customFieldSettings: null as never })),
    ).resolves.toBeInstanceOf(IncidentForm);
  });

  test.each(Object.values(IncidentFormFieldSetting))(
    "the description question may be %s",
    async (setting: string) => {
      const created: IncidentForm = await runBeforeCreate(
        newForm({ descriptionSetting: setting as IncidentFormFieldSetting }),
      );

      expect(created.descriptionSetting).toBe(setting);
    },
  );

  test("a description question left out, or null, takes the column's default", async () => {
    await expect(runBeforeCreate(newForm())).resolves.toBeInstanceOf(
      IncidentForm,
    );
    await expect(
      runBeforeCreate(newForm({ descriptionSetting: null as never })),
    ).resolves.toBeInstanceOf(IncidentForm);
  });

  test.each([["Mandatory"], ["required"], ["Default"], [""], [5]])(
    "a description question of %j is refused",
    async (setting: unknown) => {
      await expect(
        runBeforeCreate(newForm({ descriptionSetting: setting as never })),
      ).rejects.toThrow(
        new BadDataException(INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE),
      );
    },
  );
});

describe("IncidentFormService.onBeforeUpdate", () => {
  test("an update that writes nothing checked passes untouched, with no lookups", async () => {
    const data: Record<string, unknown> = {
      name: "Renamed",
      isEnabled: false,
      successMessage: "Thanks",
    };

    expect(await runBeforeUpdate(data)).toEqual({
      name: "Renamed",
      isEnabled: false,
      successMessage: "Thanks",
    });
    expect(validator).not.toHaveBeenCalled();
    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("valid custom field settings are stored exactly as sent", async () => {
    const settings: Record<string, unknown> = {
      impact: "Optional",
      customer: "Default",
    };

    const data: Record<string, unknown> = await runBeforeUpdate({
      customFieldSettings: settings,
    });

    expect(data["customFieldSettings"]).toBe(settings);
    expect(settings).toEqual({ impact: "Optional", customer: "Default" });
  });

  test("clearing the custom field settings is fine", async () => {
    expect(await runBeforeUpdate({ customFieldSettings: null })).toEqual({
      customFieldSettings: null,
    });
  });

  test("invalid custom field settings are refused", async () => {
    await expect(
      runBeforeUpdate({ customFieldSettings: { impact: "required" } }),
    ).rejects.toThrow(
      new BadDataException(
        validateCustomFieldCreateSettings({ impact: "required" })!,
      ),
    );
  });

  test.each(Object.values(IncidentFormFieldSetting))(
    "the description question may become %s",
    async (setting: string) => {
      expect(
        (await runBeforeUpdate({ descriptionSetting: setting }))[
          "descriptionSetting"
        ],
      ).toBe(setting);
    },
  );

  test.each([[null], ["Mandatory"], [""], [true]])(
    "the description question may not become %j (the column is NOT NULL)",
    async (setting: unknown) => {
      await expect(
        runBeforeUpdate({ descriptionSetting: setting }),
      ).rejects.toThrow(
        new BadDataException(INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE),
      );
    },
  );

  test("the link key may be replaced by a new UUID, as Reset Link does", async () => {
    const key: ObjectID = ObjectID.generate();

    expect((await runBeforeUpdate({ shareKey: key }))["shareKey"]).toBe(key);
    expect(
      (await runBeforeUpdate({ shareKey: CLIENT_KEY.toUpperCase() }))[
        "shareKey"
      ],
    ).toBe(CLIENT_KEY.toUpperCase());
  });

  test.each([
    ["null", null],
    ["an empty string", ""],
    ["a word", "my-form"],
    ["a UUID with a typo", "d0000000-0000-4000-8000-0000000000fz"],
    ["a number", 42],
    ["an object", { value: CLIENT_KEY }],
  ])("the link key may not become %s", async (_label: string, key: unknown) => {
    await expect(runBeforeUpdate({ shareKey: key })).rejects.toThrow(
      new BadDataException(INCIDENT_FORM_SHARE_KEY_MESSAGE),
    );
  });

  test.each([
    ["incidentSeverityId", null],
    ["incidentSeverityId", ""],
    ["incidentSeverity", null],
    ["incidentSeverity", {}],
  ])(
    "the severity may not be cleared (%s set to %j)",
    async (column: string, value: unknown) => {
      await expect(runBeforeUpdate({ [column]: value })).rejects.toThrow(
        new BadDataException(INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE),
      );
      expect(validator).not.toHaveBeenCalled();
    },
  );

  test("the template may be cleared: it is optional", async () => {
    expect(await runBeforeUpdate({ incidentTemplateId: null })).toEqual({
      incidentTemplateId: null,
    });
    expect(validator).not.toHaveBeenCalled();
  });

  test("a new severity or template is checked in the caller's project, and only those ids", async () => {
    await runBeforeUpdate({
      incidentSeverityId: SEVERITY_ID,
      incidentTemplate: TEMPLATE_ID,
    });

    expect(validator).toHaveBeenCalledTimes(1);
    expect(validatorCalls()[0]!.projectId).toBe(PROJECT_ID);
    expect(validatorCalls()[0]!.subject).toBe("incident form");
    expect(askedIds(validatorCalls()[0]!)).toEqual({
      "Incident Severity": SEVERITY_ID,
      "Incident Template": TEMPLATE_ID,
    });
    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("an update with no tenant checks the new ids in the project of every form it matches", async () => {
    storedForms = [
      storedForm(PROJECT_ID, FORM_ID),
      storedForm(PROJECT_ID, "a1b2c3d4-0000-4000-8000-0000000000f2"),
      storedForm(OTHER_PROJECT_ID, "a1b2c3d4-0000-4000-8000-0000000000f3"),
    ];

    await runBeforeUpdate(
      { incidentTemplateId: TEMPLATE_ID },
      { isRoot: true },
    );

    expect(formFindBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = formFindBy.mock.calls[0]![0];

    expect(findBy.query).toEqual({ _id: FORM_ID });
    expect(findBy.select).toEqual({ projectId: true });
    expect(findBy.props).toEqual({ isRoot: true });

    expect(
      validatorCalls().map((call: ValidatorCall): string => {
        return call.projectId!.toString();
      }),
    ).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  test("a severity from another project is refused", async () => {
    validator.mockImplementation(() => {
      return Promise.reject(
        new BadDataException(
          "This incident form references a Incident Severity from a different project.",
        ),
      );
    });

    await expect(
      runBeforeUpdate({ incidentSeverityId: SEVERITY_ID }),
    ).rejects.toThrow("from a different project");
  });

  test("root updates are held to the same shape rules", async () => {
    await expect(
      runBeforeUpdate({ shareKey: "nope" }, { isRoot: true }),
    ).rejects.toThrow(new BadDataException(INCIDENT_FORM_SHARE_KEY_MESSAGE));
    await expect(
      runBeforeUpdate({ customFieldSettings: [] }, { isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });
});

/*
 * The public routes check the IP allowlist with a matcher that understands
 * IPv4 and IPv6 addresses and IPv4 ranges only, and fail closed: an entry
 * it cannot match locks that whole network out. So the list is refused at
 * the write that would store it - naming the line - and never rewritten.
 */
describe("IncidentFormService: the IP allowlist", () => {
  const ACCEPTED: Array<[string, string | null]> = [
    ["a cleared list", null],
    ["an empty list", ""],
    ["only blank lines", "\n \r\n"],
    [
      "addresses and IPv4 ranges, with Windows line endings",
      "10.0.0.0/8\r\n203.0.113.7\n2001:db8::1\n",
    ],
    ["an IPv6 address in another spelling", "2001:DB8:0:0:0:0:0:1"],
  ];

  const REFUSED: Array<[string, string]> = [
    ["an IPv6 range", "2001:db8::/32"],
    ["two addresses on one line", "10.0.0.1, 10.0.0.2"],
    ["a word", "not-a-network"],
    ["a prefix past 32", "203.0.113.0/99"],
    ["a /0 range", "0.0.0.0/0"],
  ];

  test.each(ACCEPTED)(
    "a create with %s stores it exactly as sent",
    async (_label: string, ipWhitelist: string | null) => {
      const created: IncidentForm = await runBeforeCreate(
        newForm({ ipWhitelist: ipWhitelist as string }),
      );

      expect(created.ipWhitelist).toBe(ipWhitelist);
    },
  );

  test.each(ACCEPTED)(
    "an update with %s stores it exactly as sent",
    async (_label: string, ipWhitelist: string | null) => {
      expect(
        (await runBeforeUpdate({ ipWhitelist: ipWhitelist }))["ipWhitelist"],
      ).toBe(ipWhitelist);
    },
  );

  test.each(REFUSED)(
    "a create with %s is refused with the line it is on",
    async (_label: string, entry: string) => {
      const ipWhitelist: string = `203.0.113.7\n${entry}`;

      await expect(
        runBeforeCreate(newForm({ ipWhitelist: ipWhitelist })),
      ).rejects.toThrow(
        new BadDataException(validateIncidentFormIpAllowlist(ipWhitelist)!),
      );
      await expect(
        runBeforeCreate(newForm({ ipWhitelist: ipWhitelist })),
      ).rejects.toThrow(`line 2 (${JSON.stringify(entry)})`);
      expect(validator).not.toHaveBeenCalled();
    },
  );

  test.each(REFUSED)(
    "an update with %s is refused with the line it is on",
    async (_label: string, entry: string) => {
      await expect(runBeforeUpdate({ ipWhitelist: entry })).rejects.toThrow(
        `line 1 (${JSON.stringify(entry)})`,
      );
    },
  );

  test("a root update - a workflow's, or Terraform's through the API - is held to the same rule", async () => {
    await expect(
      runBeforeUpdate({ ipWhitelist: "2001:db8::/32" }, { isRoot: true }),
    ).rejects.toThrow(BadDataException);
  });

  test("an update that does not touch the list does not check it", async () => {
    expect(await runBeforeUpdate({ name: "Renamed" })).toEqual({
      name: "Renamed",
    });
  });
});
