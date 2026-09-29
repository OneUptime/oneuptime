import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a stranger holding a form's link is told about the form
 * (IncidentFormService.getPublicForm), and the checks that decide whether
 * they are told anything at all - the same checks every submission passes
 * first:
 *
 *   - the link has a share key's shape, before anything reaches Postgres;
 *   - a form holds that key, and it is switched on;
 *   - the form's project is on a plan that includes forms (billing on);
 *   - the visitor's network is on the form's IP allowlist, if it has one.
 *
 * An unusable form of any kind - junk link, unknown link, form turned off,
 * project off plan - gets one and the same 404, so trying links tells a
 * prober nothing. Only the network check, reached for a form that exists and
 * is on, says what is wrong (403).
 *
 * The answer itself is the safe subset: never the form's id, project,
 * template, link key, allowlist or success message, never a custom field the
 * form does not ask, and severities only when the reporter may choose one.
 *
 * Only the database reads are stubbed; the checks and the shaping run for
 * real. Billing is switched through a mocked EnvironmentConfig, as the
 * on-call calendar feed's plan check is tested.
 */

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeIncidentFormBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeIncidentFormBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeIncidentFormBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFormService, {
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/IncidentFormService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import ProjectService from "../../../Server/Services/ProjectService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import logger from "../../../Server/Utils/Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import Color from "../../../Types/Color";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  IncidentFormFieldSetting,
  PublicIncidentForm,
} from "../../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../../Types/ObjectID";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CRITICAL_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const MINOR_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f2";
const UNCOLOURED_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f3";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const CLIENT_IP: string = "203.0.113.7";

function setBillingEnabled(value: boolean): void {
  (globalThis as EnvMockGlobal).__oneuptimeIncidentFormBillingEnabled = value;
}

// A column read back from Postgres as NULL, which the model's types omit.
function setNull(form: IncidentForm, column: string): void {
  (form as unknown as Record<string, unknown>)[column] = null;
}

function buildForm(data: Partial<IncidentForm> = {}): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.description = "Tell us **what** is broken.";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.incidentSeverityId = new ObjectID(CRITICAL_SEVERITY_ID);
  form.allowReporterToChooseSeverity = false;
  form.incidentTemplateId = new ObjectID(TEMPLATE_ID);
  form.descriptionSetting = IncidentFormFieldSetting.Optional;
  form.customFieldSettings = {};
  form.isReporterDetailsRequired = true;
  form.successMessage = "Thanks - we are on it.";
  form.ipWhitelist = "";
  Object.assign(form, data);
  return form;
}

function customField(data: {
  name: string;
  variableKey: string;
  customFieldType: CustomFieldType;
  sortOrder: number;
  dropdownOptions?: string;
  description?: string;
}): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = ObjectID.generate().toString();
  field.projectId = PROJECT_ID;
  field.name = data.name;
  field.variableKey = data.variableKey;
  field.customFieldType = data.customFieldType;
  field.sortOrder = data.sortOrder;

  if (data.dropdownOptions !== undefined) {
    field.dropdownOptions = data.dropdownOptions;
  }

  if (data.description !== undefined) {
    field.description = data.description;
  }

  /*
   * The project-wide switches say "show and require everything": the form's
   * own settings, not these, decide what it asks.
   */
  field.showOnCreate = true;
  field.isRequiredOnCreate = true;

  return field;
}

const PROJECT_FIELDS: Array<IncidentCustomField> = [
  customField({
    name: "Impact",
    variableKey: "impact",
    customFieldType: CustomFieldType.Dropdown,
    sortOrder: 2,
    dropdownOptions: "Low\nHigh",
    description: "How bad is it?",
  }),
  customField({
    name: "Affected Location",
    variableKey: "affected_location",
    customFieldType: CustomFieldType.Text,
    sortOrder: 1,
    dropdownOptions: "should never be sent for a text field",
  }),
  customField({
    name: "Internal Notes",
    variableKey: "internal_notes",
    customFieldType: CustomFieldType.LongText,
    sortOrder: 3,
  }),
  customField({
    name: "Cost Center",
    variableKey: "cost_center",
    customFieldType: CustomFieldType.Text,
    sortOrder: 4,
  }),
  customField({
    name: "Legal Hold",
    variableKey: "legal_hold",
    customFieldType: CustomFieldType.Boolean,
    sortOrder: 5,
  }),
];

// Asks two fields; hides one, leaves one on Default and never names one.
const FORM_QUESTIONS: Record<string, string> = {
  impact: "Required",
  affected_location: "Optional",
  internal_notes: "Hidden",
  cost_center: "Default",
};

function severity(data: {
  id: string;
  name: string;
  order: number;
  color?: string;
}): IncidentSeverity {
  const row: IncidentSeverity = new IncidentSeverity();
  row._id = data.id;
  row.name = data.name;
  row.order = data.order;
  row.projectId = PROJECT_ID;

  if (data.color) {
    row.color = new Color(data.color);
  }

  return row;
}

const PROJECT_SEVERITIES: Array<IncidentSeverity> = [
  severity({
    id: CRITICAL_SEVERITY_ID,
    name: "Critical",
    order: 1,
    color: "#ff0000",
  }),
  severity({
    id: MINOR_SEVERITY_ID,
    name: "Minor",
    order: 2,
    color: "#00ff00",
  }),
  severity({ id: UNCOLOURED_SEVERITY_ID, name: "Unsorted", order: 3 }),
];

let storedForm: IncidentForm | null = null;
let formFindOneBy: MockedFn;
let customFieldFindBy: MockedFn;
let severityFindBy: MockedFn;
let captchaEnabled: MockedFn;

beforeEach(() => {
  setBillingEnabled(false);
  storedForm = buildForm();

  formFindOneBy = jest
    .spyOn(IncidentFormService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { shareKey?: ObjectID };
    }): Promise<IncidentForm | null> => {
      if (
        storedForm &&
        findBy.query.shareKey?.toString() === storedForm.shareKey?.toString()
      ) {
        return storedForm;
      }

      return null;
    }) as never) as unknown as MockedFn;

  customFieldFindBy = jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue(PROJECT_FIELDS as never) as unknown as MockedFn;

  severityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue(PROJECT_SEVERITIES as never) as unknown as MockedFn;

  captchaEnabled = jest
    .spyOn(CaptchaUtil, "isCaptchaEnabled")
    .mockReturnValue(false) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function getPublicForm(
  data: { shareKey?: string | undefined; clientIp?: string | undefined } = {},
): Promise<PublicIncidentForm> {
  return IncidentFormService.getPublicForm({
    shareKey: "shareKey" in data ? data.shareKey : SHARE_KEY,
    clientIp: "clientIp" in data ? data.clientIp : CLIENT_IP,
  });
}

async function refusal(
  promise: Promise<unknown>,
): Promise<Exception | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as Exception;
  }

  return undefined;
}

describe("IncidentFormService.getPublicForm - what a visitor is told", () => {
  test("a plain form: its name, description and question settings, and nothing else", async () => {
    const form: PublicIncidentForm = await getPublicForm();

    expect(form).toEqual({
      name: "Report a Problem",
      description: "Tell us **what** is broken.",
      descriptionSetting: IncidentFormFieldSetting.Optional,
      isReporterDetailsRequired: true,
      customFields: [],
      isCaptchaRequired: false,
    });
  });

  test("looks the form up by its share key alone, as root, reading only the columns it needs", async () => {
    await getPublicForm();

    expect(formFindOneBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = formFindOneBy.mock.calls[0]![0] as never;

    expect(Object.keys(findBy.query)).toEqual(["shareKey"]);
    expect(findBy.query["shareKey"]).toBeInstanceOf(ObjectID);
    expect(String(findBy.query["shareKey"])).toBe(SHARE_KEY);
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.select).toEqual({
      _id: true,
      projectId: true,
      name: true,
      description: true,
      isEnabled: true,
      incidentSeverityId: true,
      allowReporterToChooseSeverity: true,
      incidentTemplateId: true,
      descriptionSetting: true,
      customFieldSettings: true,
      isReporterDetailsRequired: true,
      successMessage: true,
      ipWhitelist: true,
    });
  });

  test("finds the form whatever the case of the key in the link, or stray spaces around it", async () => {
    await getPublicForm({ shareKey: `  ${SHARE_KEY.toUpperCase()} ` });

    const findBy: { query: Record<string, unknown> } = formFindOneBy.mock
      .calls[0]![0] as never;

    expect(String(findBy.query["shareKey"])).toBe(SHARE_KEY);
  });

  test("never sends the form's id, project, template, link key, allowlist or success message", async () => {
    storedForm = buildForm({
      allowReporterToChooseSeverity: true,
      customFieldSettings: FORM_QUESTIONS,
      ipWhitelist: `${CLIENT_IP}\n198.51.100.0/24`,
    });

    const sent: string = JSON.stringify(await getPublicForm());

    for (const secret of [
      FORM_ID,
      PROJECT_ID.toString(),
      TEMPLATE_ID,
      SHARE_KEY,
      "198.51.100.0/24",
      "Thanks - we are on it.",
      "impact",
      "affected_location",
      "internal_notes",
      "Internal Notes",
      "Cost Center",
      "Legal Hold",
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  test("leaves out a blank description", async () => {
    storedForm = buildForm({ description: "   " });

    expect(await getPublicForm()).not.toHaveProperty("description");
  });

  test.each([
    [IncidentFormFieldSetting.Required],
    [IncidentFormFieldSetting.Hidden],
  ])(
    "passes on a %s description question",
    async (setting: IncidentFormFieldSetting) => {
      storedForm = buildForm({ descriptionSetting: setting });

      expect((await getPublicForm()).descriptionSetting).toBe(setting);
    },
  );

  test("says when the reporter's details are optional", async () => {
    storedForm = buildForm({ isReporterDetailsRequired: false });

    expect((await getPublicForm()).isReporterDetailsRequired).toBe(false);
  });

  test("asks for the reporter's details when the switch was never read back", async () => {
    storedForm = buildForm();
    setNull(storedForm, "isReporterDetailsRequired");

    expect((await getPublicForm()).isReporterDetailsRequired).toBe(true);
  });
});

describe("IncidentFormService.getPublicForm - custom field questions", () => {
  test("lists only the fields the form asks, in order, required as the form says", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    expect((await getPublicForm()).customFields).toEqual([
      {
        name: "Affected Location",
        customFieldType: CustomFieldType.Text,
        isRequired: false,
      },
      {
        name: "Impact",
        description: "How bad is it?",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Low\nHigh",
        isRequired: true,
      },
    ]);
  });

  test("reads the project's fields for the form's own project, as root", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    await getPublicForm();

    expect(customFieldFindBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: Record<string, unknown>;
    } = customFieldFindBy.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID });
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.select).toEqual({
      name: true,
      description: true,
      customFieldType: true,
      dropdownOptions: true,
      variableKey: true,
      sortOrder: true,
    });
  });

  test.each([
    ["no settings at all", null],
    ["an empty object", {}],
    [
      "only Hidden and Default entries",
      { internal_notes: "Hidden", cost_center: "Default" },
    ],
    ["only entries that are not settings", { impact: "Mandatory" }],
  ])(
    "asks nothing, and reads no fields, for %s",
    async (_label: string, settings: Record<string, string> | null) => {
      storedForm = buildForm();
      (storedForm as unknown as Record<string, unknown>)[
        "customFieldSettings"
      ] = settings;

      expect((await getPublicForm()).customFields).toEqual([]);
      expect(customFieldFindBy).not.toHaveBeenCalled();
    },
  );

  test("asks nothing about a field the settings name but the project no longer has", async () => {
    storedForm = buildForm({
      customFieldSettings: { deleted_field: "Required" },
    });

    expect((await getPublicForm()).customFields).toEqual([]);
  });
});

describe("IncidentFormService.getPublicForm - severities", () => {
  test("are not listed, nor read, when the form sets the severity itself", async () => {
    const form: PublicIncidentForm = await getPublicForm();

    expect(form).not.toHaveProperty("severities");
    expect(form).not.toHaveProperty("defaultIncidentSeverityId");
    expect(severityFindBy).not.toHaveBeenCalled();
  });

  test("are listed in the project's order, with only id, name and colour, when the reporter may choose", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    const form: PublicIncidentForm = await getPublicForm();

    expect(form.severities).toEqual([
      { _id: CRITICAL_SEVERITY_ID, name: "Critical", color: "#ff0000" },
      { _id: MINOR_SEVERITY_ID, name: "Minor", color: "#00ff00" },
      { _id: UNCOLOURED_SEVERITY_ID, name: "Unsorted" },
    ]);
    expect(form.defaultIncidentSeverityId).toBe(CRITICAL_SEVERITY_ID);
  });

  test("are read from the form's own project, sorted by order, as root", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    await getPublicForm();

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      props: Record<string, unknown>;
    } = severityFindBy.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID });
    expect(findBy.sort).toEqual({ order: SortOrder.Ascending });
    expect(findBy.props).toEqual({ isRoot: true });
    expect(findBy.select).toEqual({
      _id: true,
      name: true,
      color: true,
      order: true,
    });
  });

  test("preselect nothing when the form's own severity was deleted", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });
    setNull(storedForm, "incidentSeverityId");

    const form: PublicIncidentForm = await getPublicForm();

    expect(form.severities).toHaveLength(3);
    expect(form).not.toHaveProperty("defaultIncidentSeverityId");
  });
});

describe("IncidentFormService.getPublicForm - captcha", () => {
  test.each([[true], [false]])(
    "asks for a captcha exactly when the instance has one on (%s)",
    async (enabled: boolean) => {
      captchaEnabled.mockReturnValue(enabled);

      expect((await getPublicForm()).isCaptchaRequired).toBe(enabled);
    },
  );
});

describe("IncidentFormService.getPublicForm - forms a visitor may not use", () => {
  test.each([
    ["an empty key", ""],
    ["no key at all", undefined],
    ["a word", "report-a-problem"],
    ["a form id's worth of junk", "a1b2c3d4-0000-4000-8000-0000000000fZ"],
    ["a key with a character too many", `${SHARE_KEY}0`],
    ["an overlong key", "a".repeat(5000)],
    ["a SQL fragment", "' OR '1'='1"],
  ])(
    "refuses %s as not available, without asking Postgres",
    async (_label: string, shareKey: string | undefined) => {
      const error: Exception | undefined = await refusal(
        getPublicForm({ shareKey }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
      expect(formFindOneBy).not.toHaveBeenCalled();
    },
  );

  test("refuses a key no form holds as not available", async () => {
    const error: Exception | undefined = await refusal(
      getPublicForm({ shareKey: OTHER_SHARE_KEY }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.code).toBe(ExceptionCode.NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("refuses a form that is turned off as not available", async () => {
    storedForm = buildForm({ isEnabled: false });

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("treats a switch that was never read back as off", async () => {
    storedForm = buildForm();
    setNull(storedForm, "isEnabled");

    expect(await refusal(getPublicForm())).toBeInstanceOf(NotFoundException);
  });

  test("refuses a form whose project is off plan as not available", async () => {
    jest
      .spyOn(IncidentFormService, "isProjectOnPlan")
      .mockResolvedValue(false as never);

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("checks the plan of the form's own project", async () => {
    const onPlan: MockedFn = jest
      .spyOn(IncidentFormService, "isProjectOnPlan")
      .mockResolvedValue(true as never) as unknown as MockedFn;

    await getPublicForm();

    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(String(onPlan.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
  });

  /*
   * The point of one message: a prober trying links cannot tell a link that
   * never existed from a form that is off or a project that stopped paying.
   */
  test("gives an unknown link, a junk link, a form turned off and a project off plan the very same answer", async () => {
    const unknown: Exception | undefined = await refusal(
      getPublicForm({ shareKey: OTHER_SHARE_KEY }),
    );
    const junk: Exception | undefined = await refusal(
      getPublicForm({ shareKey: "junk" }),
    );

    storedForm = buildForm({ isEnabled: false });
    const off: Exception | undefined = await refusal(getPublicForm());

    storedForm = buildForm();
    jest
      .spyOn(IncidentFormService, "isProjectOnPlan")
      .mockResolvedValue(false as never);
    const offPlan: Exception | undefined = await refusal(getPublicForm());

    const answers: Array<[string | undefined, unknown, unknown]> = [
      unknown,
      junk,
      off,
      offPlan,
    ].map((error: Exception | undefined) => {
      return [error?.constructor.name, error?.code, error?.message];
    });

    expect(
      new Set(
        answers.map((answer: unknown) => {
          return JSON.stringify(answer);
        }),
      ).size,
    ).toBe(1);
    expect(answers[0]).toEqual([
      "NotFoundException",
      404,
      INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
    ]);
  });

  test("reads nothing else about a form it refuses", async () => {
    storedForm = buildForm({
      isEnabled: false,
      allowReporterToChooseSeverity: true,
      customFieldSettings: FORM_QUESTIONS,
    });

    await refusal(getPublicForm());

    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(severityFindBy).not.toHaveBeenCalled();
  });
});

describe("IncidentFormService.getPublicForm - the IP allowlist", () => {
  test("lets anyone in when the form has no allowlist", async () => {
    storedForm = buildForm({ ipWhitelist: "" });

    await expect(
      getPublicForm({ clientIp: "192.0.2.99" }),
    ).resolves.toBeDefined();
  });

  test("lets a listed address in", async () => {
    storedForm = buildForm({ ipWhitelist: `198.51.100.1\n${CLIENT_IP}` });

    await expect(getPublicForm()).resolves.toBeDefined();
  });

  test("lets an address inside a listed range in", async () => {
    storedForm = buildForm({ ipWhitelist: "203.0.113.0/24" });

    await expect(getPublicForm()).resolves.toBeDefined();
  });

  test("refuses any other address with a 403 that says what is wrong", async () => {
    storedForm = buildForm({ ipWhitelist: "198.51.100.0/24" });

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error?.code).toBe(403);
    expect(error?.message).toBe(INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE);
  });

  test("refuses a request whose address cannot be established, and logs it", async () => {
    storedForm = buildForm({ ipWhitelist: CLIENT_IP });

    const error: Exception | undefined = await refusal(
      getPublicForm({ clientIp: undefined }),
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(logger.error).toHaveBeenCalled();
  });

  test("does not need an address when there is no allowlist", async () => {
    await expect(getPublicForm({ clientIp: undefined })).resolves.toBeDefined();
  });

  test("checks the network only for a form that is on and on plan", async () => {
    storedForm = buildForm({
      isEnabled: false,
      ipWhitelist: "198.51.100.0/24",
    });

    expect(await refusal(getPublicForm())).toBeInstanceOf(NotFoundException);
  });

  test("reads nothing else about the form for a visitor it refuses", async () => {
    storedForm = buildForm({
      ipWhitelist: "198.51.100.0/24",
      allowReporterToChooseSeverity: true,
      customFieldSettings: FORM_QUESTIONS,
    });

    await refusal(getPublicForm());

    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(severityFindBy).not.toHaveBeenCalled();
  });
});

describe("IncidentFormService.isClientIpAllowed", () => {
  test.each([
    ["no list", undefined, CLIENT_IP, true],
    ["a null list", null, CLIENT_IP, true],
    ["an empty list", "", CLIENT_IP, true],
    [
      "a list of blank lines, as a cleared textarea leaves",
      "\n \r\n\t\n",
      CLIENT_IP,
      true,
    ],
    ["an exact address", CLIENT_IP, CLIENT_IP, true],
    ["a range holding the address", "203.0.113.0/24", CLIENT_IP, true],
    [
      "Windows line endings",
      `198.51.100.1\r\n${CLIENT_IP}\r\n`,
      CLIENT_IP,
      true,
    ],
    ["padding around an entry", `   ${CLIENT_IP}   `, CLIENT_IP, true],
    ["an IPv6 address listed exactly", "2001:db8::1", "2001:db8::1", true],
    ["another address", "198.51.100.1", CLIENT_IP, false],
    ["a range not holding the address", "198.51.100.0/24", CLIENT_IP, false],
    ["no address, with a list", CLIENT_IP, undefined, false],
    ["an empty address, with a list", CLIENT_IP, "", false],
    ["an address that is not one", CLIENT_IP, "not-an-address", false],
    ["only a malformed entry", "not-a-network", CLIENT_IP, false],
    ["a malformed range", "203.0.113.0/99", CLIENT_IP, false],
  ])(
    "with %s it answers correctly",
    (
      _label: string,
      ipWhitelist: string | null | undefined,
      clientIp: string | undefined,
      allowed: boolean,
    ) => {
      expect(
        IncidentFormService.isClientIpAllowed({ ipWhitelist, clientIp }),
      ).toBe(allowed);
    },
  );

  /*
   * The one address to check is resolved before this is asked (from the
   * trusted end of X-Forwarded-For). A forwarded-for chain handed in whole
   * is not an address, so it is refused rather than matched entry by entry.
   */
  test("refuses a whole forwarded-for chain rather than matching any entry in it", () => {
    expect(
      IncidentFormService.isClientIpAllowed({
        ipWhitelist: CLIENT_IP,
        clientIp: `${CLIENT_IP}, 192.0.2.1`,
      }),
    ).toBe(false);
  });
});

describe("IncidentFormService.isProjectOnPlan", () => {
  const projectId: ObjectID = PROJECT_ID;
  let getCurrentPlan: MockedFn;
  let planCheck: MockedFn;

  beforeEach(() => {
    getCurrentPlan = jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({
        plan: PlanType.Growth,
        isSubscriptionUnpaid: false,
      } as never) as unknown as MockedFn;
    planCheck = jest
      .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
      .mockReturnValue(true) as unknown as MockedFn;
  });

  test("with billing off every project is on plan, and no plan is read", async () => {
    setBillingEnabled(false);

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(true);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("with billing on it asks whether the project's plan includes Growth features", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
    });

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(true);
    expect(getCurrentPlan).toHaveBeenCalledWith(projectId);
    expect(planCheck).toHaveBeenCalledTimes(1);
    expect(planCheck.mock.calls[0]![0]).toBe(PlanType.Growth);
    expect(planCheck.mock.calls[0]![1]).toBe(PlanType.Scale);
  });

  test("a plan below Growth is off plan", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    planCheck.mockReturnValue(false);

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(false);
  });

  test("no plan at all is off plan (fails closed)", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(false);
    expect(planCheck).not.toHaveBeenCalled();
  });

  test("a plan that cannot be read is off plan, logged, never thrown", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockRejectedValue(new Error("Project ID is invalid"));

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("with billing on, a form of an off-plan project is not available", async () => {
    setBillingEnabled(true);
    planCheck.mockReturnValue(false);

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    expect(getCurrentPlan).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("with billing on, a form of a project on plan is served", async () => {
    setBillingEnabled(true);

    await expect(getPublicForm()).resolves.toBeDefined();
  });

  /*
   * The check stands in for the whole of the model's billing gate, which
   * refuses every dashboard request of a project whose subscription is
   * unpaid - its admins cannot even turn the form off - so the link must
   * not keep declaring incidents meanwhile, whatever the plan.
   */
  test.each([[PlanType.Growth], [PlanType.Scale], [PlanType.Enterprise]])(
    "an unpaid subscription on %s is off plan",
    async (plan: PlanType) => {
      setBillingEnabled(true);
      getCurrentPlan.mockResolvedValue({
        plan: plan,
        isSubscriptionUnpaid: true,
      });

      expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(false);
      expect(planCheck).not.toHaveBeenCalled();
    },
  );

  test("with billing on, a form of an unpaid project is not available, exactly as an unknown link", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });

    const unpaid: Exception | undefined = await refusal(getPublicForm());
    const unknown: Exception | undefined = await refusal(
      getPublicForm({ shareKey: OTHER_SHARE_KEY }),
    );

    expect(unpaid).toBeInstanceOf(NotFoundException);
    expect(unpaid?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    expect([unpaid?.code, unpaid?.message]).toEqual([
      unknown?.code,
      unknown?.message,
    ]);
    expect(customFieldFindBy).not.toHaveBeenCalled();
  });

  test("with billing on, a form of an unpaid project declares nothing", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });

    const incidentCreate: MockedFn = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(undefined as never) as unknown as MockedFn;

    const error: Exception | undefined = await refusal(
      IncidentFormService.submitPublicForm({
        shareKey: SHARE_KEY,
        request: {
          data: {
            title: "Checkout is down",
            reporterName: "Jane Doe",
            reporterEmail: "jane@example.com",
          },
        },
        clientIp: CLIENT_IP,
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("a paid subscription on a plan with forms stays on plan", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });

    expect(await IncidentFormService.isProjectOnPlan(projectId)).toBe(true);
  });
});
