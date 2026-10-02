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
 * (FormService.getPublicForm), and the checks that decide whether they are
 * told anything at all - the same checks every submission passes first:
 *
 *   - the link has a share key's shape, before anything reaches Postgres;
 *   - a form holds that key, and it is accepting submissions;
 *   - the form's project is on a plan that includes forms (billing on);
 *   - the visitor's network is on the form's IP allowlist, if it has one.
 *
 * An unusable form of any kind - junk link, unknown link, form turned off,
 * project off plan - gets one and the same 404, so trying links tells a
 * prober nothing. Only the network check, reached for a form that exists and
 * is on, says what is wrong (403).
 *
 * The answer itself is the safe subset: never the form's id, project,
 * target, settings, link key, allowlist or thank-you message, never a custom
 * field or record the form does not offer.
 *
 * Only the database reads are stubbed; the checks and the shaping run for
 * real. Billing is switched through a mocked EnvironmentConfig.
 */

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeFormBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeFormBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeFormBillingEnabled;
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

import Form from "../../../Models/DatabaseModels/Form";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import FormService, {
  FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import {
  ClientIpRequestLike,
  resolveClientIp,
} from "../../../Server/Utils/ClientIp";
import logger from "../../../Server/Utils/Logger";
import FormRecordOptions from "../../../Server/Utils/Form/FormRecordOptions";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import Color from "../../../Types/Color";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import {
  PublicForm,
  PublicFormField,
  PublicFormFieldType,
} from "../../../Types/Form/FormPublic";
import { FormTargetOptionsSource } from "../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray } from "../../../Types/JSON";
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
const API_MONITOR_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const WEB_MONITOR_ID: string = "c0000000-0000-4000-8000-0000000000f2";
const REGION_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const INTERNAL_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f2";
const CLIENT_IP: string = "203.0.113.7";

function setBillingEnabled(value: boolean): void {
  (globalThis as EnvMockGlobal).__oneuptimeFormBillingEnabled = value;
}

// A column read back from Postgres as NULL, which the model's types omit.
function setNull(form: Form, column: string): void {
  (form as unknown as Record<string, unknown>)[column] = null;
}

// What the form asks: a bit of everything.
const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What is wrong?",
    isRequired: true,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "How bad is it?",
    isRequired: false,
  },
  {
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    allowedOptionIds: [WEB_MONITOR_ID],
  },
  {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    customFieldId: REGION_FIELD_ID,
    label: "Region",
    isRequired: true,
  },
  {
    id: "email",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Email,
    label: "Your Email",
    isRequired: true,
  },
];

function buildForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.description = "Tell us **what** is broken.";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Incident;
  form.fields = FIELDS as unknown as JSONArray;
  form.targetSettings = { incidentSeverityId: MINOR_SEVERITY_ID };
  form.successMessage = "Thanks - we are on it.";
  form.ipWhitelist = "";
  Object.assign(form, data);
  return form;
}

function incidentCustomField(data: {
  id: string;
  name: string;
  customFieldType: CustomFieldType;
  dropdownOptions?: string;
}): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = data.id;
  field.projectId = PROJECT_ID;
  field.name = data.name;
  field.customFieldType = data.customFieldType;

  if (data.dropdownOptions) {
    field.dropdownOptions = data.dropdownOptions;
  }

  return field;
}

const PROJECT_FIELDS: Array<IncidentCustomField> = [
  incidentCustomField({
    id: REGION_FIELD_ID,
    name: "Region",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: "EU\nUS",
  }),
  // Not asked by the form: nothing about it reaches the page.
  incidentCustomField({
    id: INTERNAL_FIELD_ID,
    name: "Internal Cost Center",
    customFieldType: CustomFieldType.Text,
  }),
];

function severity(id: string, name: string, color?: string): IncidentSeverity {
  const row: IncidentSeverity = new IncidentSeverity();
  row._id = id;
  row.name = name;
  row.projectId = PROJECT_ID;

  if (color) {
    row.color = new Color(color);
  }

  return row;
}

function monitor(id: string, name: string): Monitor {
  const row: Monitor = new Monitor();
  row._id = id;
  row.name = name;
  row.projectId = PROJECT_ID;
  return row;
}

let storedForm: Form | null = null;
let formFindOneBy: MockedFn;
let customFieldFindBy: MockedFn;
let severityFindBy: MockedFn;
let monitorFindBy: MockedFn;

beforeEach(() => {
  setBillingEnabled(false);
  storedForm = buildForm();

  formFindOneBy = jest
    .spyOn(FormService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { shareKey?: ObjectID };
    }): Promise<Form | null> => {
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
    .mockResolvedValue([
      severity(CRITICAL_SEVERITY_ID, "Critical", "#ff0000"),
      severity(MINOR_SEVERITY_ID, "Minor"),
    ] as never) as unknown as MockedFn;

  // The monitors the form offers - the database only returns those asked.
  monitorFindBy = jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue([
      monitor(WEB_MONITOR_ID, "Website"),
    ] as never) as unknown as MockedFn;

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function getPublicForm(
  data: { shareKey?: string | undefined; clientIp?: string | undefined } = {},
): Promise<PublicForm> {
  return FormService.getPublicForm({
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

describe("FormService.getPublicForm - what a visitor is told", () => {
  test("the form's name, description and questions, and nothing else", async () => {
    const form: PublicForm = await getPublicForm();

    expect(Object.keys(form).sort()).toEqual([
      "description",
      "fields",
      "isCaptchaRequired",
      "name",
    ]);
    expect(form.name).toBe("Report a Problem");
    expect(form.description).toBe("Tell us **what** is broken.");
    expect(form.isCaptchaRequired).toBe(false);
    expect(
      form.fields.map((field: PublicFormField): string => {
        return field.id;
      }),
    ).toEqual(["title", "severity", "monitors", "region", "email"]);
  });

  test("never sends the form's id, project, target, settings, link key, allowlist or thank-you message", async () => {
    storedForm = buildForm({ ipWhitelist: "203.0.113.0/24" });

    const serialized: string = JSON.stringify(await getPublicForm());

    for (const secret of [
      FORM_ID,
      PROJECT_ID.toString(),
      SHARE_KEY,
      "203.0.113.0/24",
      "Thanks - we are on it.",
      "Incident",
      REGION_FIELD_ID,
      "Internal Cost Center",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("looks the form up by its share key alone, as root, reading only the columns it needs", async () => {
    await getPublicForm();

    expect(formFindOneBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
      props: Record<string, unknown>;
    } = formFindOneBy.mock.calls[0]![0] as never;

    expect(Object.keys(findBy.query)).toEqual(["shareKey"]);
    expect(findBy.props).toEqual({ isRoot: true });
    expect(Object.keys(findBy.select).sort()).toEqual(
      [
        "_id",
        "projectId",
        "name",
        "description",
        "isEnabled",
        "targetType",
        "fields",
        "targetSettings",
        "successMessage",
        "ipWhitelist",
      ].sort(),
    );
  });

  test("finds the form whatever the case of the key in the link, or stray spaces around it", async () => {
    await expect(
      getPublicForm({ shareKey: `  ${SHARE_KEY.toUpperCase()} ` }),
    ).resolves.toBeDefined();
  });

  test("severities are listed in the project's order, starting on the form's own", async () => {
    const severityQuestion: PublicFormField = (await getPublicForm())
      .fields[1]!;

    expect(severityQuestion).toEqual({
      id: "severity",
      label: "How bad is it?",
      type: PublicFormFieldType.Dropdown,
      isRequired: false,
      options: [
        { value: CRITICAL_SEVERITY_ID, label: "Critical", color: "#ff0000" },
        { value: MINOR_SEVERITY_ID, label: "Minor" },
      ],
      defaultValue: MINOR_SEVERITY_ID,
    });
  });

  test("reads every severity of the form's own project, by order, as root", async () => {
    await getPublicForm();

    expect(severityFindBy).toHaveBeenCalledTimes(1);
    expect(severityFindBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      sort: { order: SortOrder.Ascending },
      props: { isRoot: true },
    });
  });

  test("reads only the monitors the form offers, from its own project", async () => {
    const form: PublicForm = await getPublicForm();

    expect(form.fields[2]!.options).toEqual([
      { value: WEB_MONITOR_ID, label: "Website" },
    ]);

    const query: Record<string, unknown> = (
      monitorFindBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(JSON.stringify(query["_id"])).toContain(WEB_MONITOR_ID);
    expect(JSON.stringify(query["_id"])).not.toContain(API_MONITOR_ID);
  });

  test("custom field questions take the field's type and options; the project's other fields are never sent", async () => {
    const region: PublicFormField = (await getPublicForm()).fields[3]!;

    expect(region).toEqual({
      id: "region",
      label: "Region",
      type: PublicFormFieldType.Dropdown,
      isRequired: true,
      options: [
        { value: "EU", label: "EU" },
        { value: "US", label: "US" },
      ],
    });
    expect(customFieldFindBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      props: { isRoot: true },
    });
  });

  test("a question whose custom field was deleted is not asked", async () => {
    customFieldFindBy.mockResolvedValue([PROJECT_FIELDS[1]] as never);

    const form: PublicForm = await getPublicForm();

    expect(
      form.fields.map((field: PublicFormField): string => {
        return field.id;
      }),
    ).not.toContain("region");
  });

  test("reads no custom fields, severities or monitors for a form that asks none", async () => {
    storedForm = buildForm({
      fields: getDefaultFormFields(
        FormTargetType.Incident,
      ) as unknown as JSONArray,
    });

    await getPublicForm();

    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(severityFindBy).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  test("a maintenance form reads the maintenance custom fields and status pages", async () => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = WEB_MONITOR_ID;
    statusPage.name = "Main";

    const statusPages: MockedFn = jest
      .spyOn(StatusPageService, "findBy")
      .mockResolvedValue([statusPage] as never) as unknown as MockedFn;

    const maintenanceField: ScheduledMaintenanceCustomField =
      new ScheduledMaintenanceCustomField();
    maintenanceField._id = INTERNAL_FIELD_ID;
    maintenanceField.name = "Change Ticket";
    maintenanceField.customFieldType = CustomFieldType.Text;

    const maintenanceFields: MockedFn = jest
      .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
      .mockResolvedValue([maintenanceField] as never) as unknown as MockedFn;

    storedForm = buildForm({
      targetType: FormTargetType.ScheduledMaintenance,
      targetSettings: {},
      fields: [
        ...getDefaultFormFields(FormTargetType.ScheduledMaintenance),
        {
          id: "pages",
          source: FormFieldSource.TargetField,
          targetField: "statusPages",
          label: "Which pages?",
          isRequired: false,
          allowedOptionIds: [WEB_MONITOR_ID],
        },
        {
          id: "ticket",
          source: FormFieldSource.TargetCustomField,
          customFieldId: INTERNAL_FIELD_ID,
          label: "Change Ticket",
          isRequired: false,
        },
      ] as unknown as JSONArray,
    });

    const form: PublicForm = await getPublicForm();

    expect(
      form.fields.map((field: PublicFormField): string => {
        return `${field.label}:${field.type}`;
      }),
    ).toEqual([
      "Title:Text",
      "Description:Markdown",
      "Starts At:DateTime",
      "Ends At:DateTime",
      "Your Name:Text",
      "Your Email:Email",
      "Which pages?:MultiSelectDropdown",
      "Change Ticket:Text",
    ]);
    expect(statusPages).toHaveBeenCalledTimes(1);
    expect(maintenanceFields).toHaveBeenCalledTimes(1);
    expect(customFieldFindBy).not.toHaveBeenCalled();
  });

  test("asks for a captcha when the instance has one", async () => {
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);

    expect((await getPublicForm()).isCaptchaRequired).toBe(true);
  });
});

describe("FormService.getPublicForm - forms a visitor may not use", () => {
  test.each([
    ["a junk link", "not-a-key"],
    ["an empty link", ""],
    ["no link", undefined],
  ])(
    "refuses %s as not available, without reading anything",
    async (_label: string, shareKey: string | undefined) => {
      const error: Exception | undefined = await refusal(
        getPublicForm({ shareKey }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
      expect(formFindOneBy).not.toHaveBeenCalled();
    },
  );

  test("refuses a key no form holds as not available", async () => {
    const error: Exception | undefined = await refusal(
      getPublicForm({ shareKey: OTHER_SHARE_KEY }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("refuses a form that is not accepting submissions as not available", async () => {
    storedForm = buildForm({ isEnabled: false });

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("treats a switch that was never read back as off", async () => {
    storedForm = buildForm();
    setNull(storedForm, "isEnabled");

    expect(await refusal(getPublicForm())).toBeInstanceOf(NotFoundException);
  });

  test("gives an unknown link, a junk link, a form turned off and a project off plan the very same answer", async () => {
    const unknown: Exception | undefined = await refusal(
      getPublicForm({ shareKey: OTHER_SHARE_KEY }),
    );
    const junk: Exception | undefined = await refusal(
      getPublicForm({ shareKey: "x" }),
    );

    storedForm = buildForm({ isEnabled: false });
    const off: Exception | undefined = await refusal(getPublicForm());

    storedForm = buildForm();
    setBillingEnabled(true);
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    } as never);
    jest
      .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
      .mockReturnValue(false);
    const offPlan: Exception | undefined = await refusal(getPublicForm());

    const answers: Array<[unknown, unknown, unknown]> = [
      unknown,
      junk,
      off,
      offPlan,
    ].map((error: Exception | undefined): [unknown, unknown, unknown] => {
      return [error?.constructor, error?.code, error?.message];
    });

    expect(
      new Set(
        answers.map((answer: unknown) => {
          return JSON.stringify(answer);
        }),
      ).size,
    ).toBe(1);
  });

  test("reads nothing else about a form it refuses", async () => {
    storedForm = buildForm({ isEnabled: false });

    await refusal(getPublicForm());

    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(severityFindBy).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
  });
});

describe("FormService.getPublicForm - the IP allowlist", () => {
  test("lets anyone in when the form has no allowlist", async () => {
    await expect(getPublicForm()).resolves.toBeDefined();
    await expect(getPublicForm({ clientIp: undefined })).resolves.toBeDefined();
  });

  test("lets an address inside a listed range in", async () => {
    storedForm = buildForm({ ipWhitelist: "203.0.113.0/24" });

    await expect(getPublicForm()).resolves.toBeDefined();
  });

  test("refuses any other address with a 403 that says what is wrong", async () => {
    storedForm = buildForm({ ipWhitelist: "198.51.100.0/24" });

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error?.message).toBe(FORM_NETWORK_NOT_ALLOWED_MESSAGE);
  });

  test("refuses a request whose address cannot be established, and logs it", async () => {
    storedForm = buildForm({ ipWhitelist: CLIENT_IP });

    const error: Exception | undefined = await refusal(
      getPublicForm({ clientIp: undefined }),
    );

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(logger.error).toHaveBeenCalled();
  });

  test("checks the network only for a form that is on", async () => {
    storedForm = buildForm({ isEnabled: false, ipWhitelist: "198.51.100.1" });

    expect(await refusal(getPublicForm())).toBeInstanceOf(NotFoundException);
  });
});

describe("FormService.isClientIpAllowed", () => {
  test.each([
    ["no list", undefined, CLIENT_IP, true],
    ["a null list", null, CLIENT_IP, true],
    ["an empty list", "", CLIENT_IP, true],
    ["a list of blank lines", "\n \r\n\t\n", CLIENT_IP, true],
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
    ["an IPv6 address listed in capitals", "2001:DB8::1", "2001:db8::1", true],
    [
      "an IPv6 address written out in full",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "2001:db8::1",
      true,
    ],
    ["another IPv6 address", "2001:db8::2", "2001:db8::1", false],
    [
      "a client in the IPv4-mapped spelling",
      CLIENT_IP,
      `::ffff:${CLIENT_IP}`,
      true,
    ],
    [
      "a client in the IPv4-mapped spelling, in hex",
      CLIENT_IP,
      "::ffff:cb00:7107",
      true,
    ],
    [
      "another address's IPv4-mapped spelling",
      CLIENT_IP,
      "::ffff:198.51.100.1",
      false,
    ],
    ["an IPv4-translated address", CLIENT_IP, `::ffff:0:${CLIENT_IP}`, false],
    ["another address", "198.51.100.1", CLIENT_IP, false],
    ["a range not holding the address", "198.51.100.0/24", CLIENT_IP, false],
    ["no address, with a list", CLIENT_IP, undefined, false],
    ["an empty address, with a list", CLIENT_IP, "", false],
    ["an address that is not one", CLIENT_IP, "not-an-address", false],
    ["only a malformed entry", "not-a-network", CLIENT_IP, false],
    ["a malformed range", "203.0.113.0/99", CLIENT_IP, false],
    [
      "a whole forwarded-for chain",
      CLIENT_IP,
      `${CLIENT_IP}, 192.0.2.1`,
      false,
    ],
  ])(
    "with %s it answers correctly",
    (
      _label: string,
      ipWhitelist: string | null | undefined,
      clientIp: string | undefined,
      allowed: boolean,
    ) => {
      expect(FormService.isClientIpAllowed({ ipWhitelist, clientIp })).toBe(
        allowed,
      );
    },
  );

  test.each([
    [
      "the socket's peer, with no proxy in front",
      { headers: {}, socket: { remoteAddress: `::ffff:${CLIENT_IP}` } },
      0,
    ],
    [
      "the address the proxy appended",
      {
        headers: { "x-forwarded-for": `::ffff:${CLIENT_IP}` },
        socket: { remoteAddress: "127.0.0.1" },
      },
      1,
    ],
  ])(
    "lets in an IPv4 visitor reported in the IPv4-mapped spelling, as %s",
    (
      _label: string,
      request: ClientIpRequestLike,
      trustedProxyHops: number,
    ) => {
      const clientIp: string | undefined = resolveClientIp(request, {
        trustedProxyHops: trustedProxyHops,
      });

      expect(clientIp).toBe(CLIENT_IP);

      for (const ipWhitelist of [CLIENT_IP, "203.0.113.0/24"]) {
        expect(FormService.isClientIpAllowed({ ipWhitelist, clientIp })).toBe(
          true,
        );
      }
    },
  );
});

describe("FormService.isProjectOnPlan", () => {
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

    expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(true);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("with billing on it asks whether the project's plan includes Growth features", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
    });

    expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(true);
    expect(getCurrentPlan).toHaveBeenCalledWith(PROJECT_ID);
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

    expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(false);
  });

  test("no plan at all is off plan (fails closed)", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });

    expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(false);
    expect(planCheck).not.toHaveBeenCalled();
  });

  test("a plan that cannot be read is off plan, logged, never thrown", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockRejectedValue(new Error("Project ID is invalid"));

    expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  test.each([[PlanType.Growth], [PlanType.Scale], [PlanType.Enterprise]])(
    "an unpaid subscription on %s is off plan",
    async (plan: PlanType) => {
      setBillingEnabled(true);
      getCurrentPlan.mockResolvedValue({ plan, isSubscriptionUnpaid: true });

      expect(await FormService.isProjectOnPlan(PROJECT_ID)).toBe(false);
      expect(planCheck).not.toHaveBeenCalled();
    },
  );

  test("with billing on, a form of an off-plan project is not available", async () => {
    setBillingEnabled(true);
    planCheck.mockReturnValue(false);

    const error: Exception | undefined = await refusal(getPublicForm());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
  });

  test("with billing on, a form of an unpaid project creates nothing", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });

    const incidentCreate: MockedFn = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(undefined as never) as unknown as MockedFn;

    const error: Exception | undefined = await refusal(
      FormService.submitPublicForm({
        shareKey: SHARE_KEY,
        request: {
          data: {
            answers: {
              title: "Checkout is down",
              region: "EU",
              email: "jane@example.com",
            },
          },
        },
        clientIp: CLIENT_IP,
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("with billing on, a form of a project on plan is served", async () => {
    setBillingEnabled(true);

    await expect(getPublicForm()).resolves.toBeDefined();
  });
});

describe("FormRecordOptions: the records a choice question can offer", () => {
  test("reads only valid ids, and none at all for an empty list", async () => {
    expect(
      await FormRecordOptions.load({
        projectId: PROJECT_ID,
        source: FormTargetOptionsSource.Monitor,
        ids: ["junk", ""],
      }),
    ).toEqual([]);
    expect(monitorFindBy).not.toHaveBeenCalled();
  });

  test("reads every record of the project when no ids are given", async () => {
    await FormRecordOptions.load({
      projectId: PROJECT_ID,
      source: FormTargetOptionsSource.IncidentSeverity,
    });

    expect(
      (severityFindBy.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({ projectId: PROJECT_ID });
  });

  test("reads labels with their colors", async () => {
    const label: Label = new Label();
    label._id = WEB_MONITOR_ID;
    label.name = "eu";
    label.color = new Color("#00ff00");

    jest.spyOn(LabelService, "findBy").mockResolvedValue([label] as never);

    expect(
      await FormRecordOptions.load({
        projectId: PROJECT_ID,
        source: FormTargetOptionsSource.Label,
        ids: [WEB_MONITOR_ID],
      }),
    ).toEqual([{ id: WEB_MONITOR_ID, name: "eu", color: "#00ff00" }]);
  });

  test("toOptions keeps records with an id, lowercased, and names them", () => {
    expect(
      FormRecordOptions.toOptions([
        { id: new ObjectID(WEB_MONITOR_ID.toUpperCase()), name: "Website" },
        { id: null, name: "No id" },
        { id: new ObjectID(API_MONITOR_ID), name: null },
      ]),
    ).toEqual([
      { id: WEB_MONITOR_ID, name: "Website" },
      { id: API_MONITOR_ID, name: "" },
    ]);
  });

  test("an unknown source offers nothing", async () => {
    expect(
      await FormRecordOptions.load({
        projectId: PROJECT_ID,
        source: "Banana" as FormTargetOptionsSource,
      }),
    ).toEqual([]);
  });
});
