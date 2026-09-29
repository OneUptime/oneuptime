import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a public submission turns into (IncidentFormService.submitPublicForm).
 *
 * A stranger's request becomes an incident that pages on-call, so every test
 * here pins exactly what reaches IncidentService.create - field by field,
 * with nothing extra - and what happens around it:
 *
 *   - the checks, in order: link, form on, plan, network, captcha (only when
 *     the instance has one on), the answers, the severity;
 *   - the incident: the form's project whatever the body says, the
 *     reporter's title and description, the severity (the reporter's choice
 *     when allowed, else the form's, else the template's, else a 400), the
 *     template id so IncidentService applies the template, the answers to
 *     the fields the form asks and to nothing else, and never on a status
 *     page or to its subscribers;
 *   - afterwards: the template's owners added and notified, the submission
 *     recorded, the reporter named in a private note with every value
 *     Markdown-escaped - and a failure in any of those logged, never thrown,
 *     because the incident already stands;
 *   - the answer: the incident's number and the form's success message.
 *
 * Only the database and the captcha provider are stubbed.
 */

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

import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentForm from "../../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../../Models/DatabaseModels/IncidentFormSubmission";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFormService, {
  INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE,
  INCIDENT_FORM_NOT_AVAILABLE_MESSAGE,
  INCIDENT_FORM_NO_SEVERITY_MESSAGE,
  INCIDENT_FORM_SUBMIT_FAILED_MESSAGE,
  getIncidentFormReporterNote,
} from "../../../Server/Services/IncidentFormService";
import IncidentFormSubmissionService from "../../../Server/Services/IncidentFormSubmissionService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import logger from "../../../Server/Utils/Logger";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ServerException from "../../../Types/Exception/ServerException";
import {
  IncidentFormFieldSetting,
  PublicIncidentFormSubmissionResult,
  formatIncidentFormSubmissionErrors,
} from "../../../Types/Incident/IncidentFormPublic";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: string = "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f02";
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const FORM_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const MINOR_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f2";
const TEMPLATE_ID: string = "c0000000-0000-4000-8000-0000000000f1";
const INCIDENT_ID: string = "e0000000-0000-4000-8000-0000000000f1";
const OWNER_USER_IDS: Array<string> = [
  "f0000000-0000-4000-8000-0000000000a1",
  "f0000000-0000-4000-8000-0000000000a2",
];
const OWNER_TEAM_ID: string = "f0000000-0000-4000-8000-0000000000b1";
const CLIENT_IP: string = "203.0.113.7";
const CAPTCHA_IP: string = "203.0.113.8";

// A column read back from Postgres as NULL, which the model's types omit.
function setNull(
  model: IncidentForm | Incident | IncidentTemplate,
  column: string,
): void {
  (model as unknown as Record<string, unknown>)[column] = null;
}

function buildForm(data: Partial<IncidentForm> = {}): IncidentForm {
  const form: IncidentForm = new IncidentForm();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Report a Problem";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.incidentSeverityId = new ObjectID(FORM_SEVERITY_ID);
  form.allowReporterToChooseSeverity = false;
  form.descriptionSetting = IncidentFormFieldSetting.Optional;
  form.customFieldSettings = {};
  form.isReporterDetailsRequired = true;
  form.successMessage = "Thanks - **we are on it**.";
  form.ipWhitelist = "";
  Object.assign(form, data);
  return form;
}

function withTemplate(data: Partial<IncidentForm> = {}): IncidentForm {
  return buildForm({ incidentTemplateId: new ObjectID(TEMPLATE_ID), ...data });
}

function customField(data: {
  name: string;
  variableKey: string;
  customFieldType: CustomFieldType;
  sortOrder: number;
  dropdownOptions?: string;
}): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field._id = ObjectID.generate().toString();
  field.projectId = PROJECT_ID;
  field.name = data.name;
  field.variableKey = data.variableKey;
  field.customFieldType = data.customFieldType;
  field.sortOrder = data.sortOrder;
  field.showOnCreate = true;
  field.isRequiredOnCreate = true;

  if (data.dropdownOptions !== undefined) {
    field.dropdownOptions = data.dropdownOptions;
  }

  return field;
}

const PROJECT_FIELDS: Array<IncidentCustomField> = [
  customField({
    name: "Impact",
    variableKey: "impact",
    customFieldType: CustomFieldType.Dropdown,
    sortOrder: 1,
    dropdownOptions: "Low\nHigh",
  }),
  customField({
    name: "Region",
    variableKey: "region",
    customFieldType: CustomFieldType.Text,
    sortOrder: 2,
  }),
  customField({
    name: "Acknowledged",
    variableKey: "acknowledged",
    customFieldType: CustomFieldType.Boolean,
    sortOrder: 3,
  }),
  customField({
    name: "Secret Escalation Path",
    variableKey: "secret_escalation_path",
    customFieldType: CustomFieldType.Text,
    sortOrder: 4,
  }),
];

const FORM_QUESTIONS: Record<string, string> = {
  impact: "Required",
  region: "Optional",
  secret_escalation_path: "Hidden",
};

function severity(id: string, name: string, order: number): IncidentSeverity {
  const row: IncidentSeverity = new IncidentSeverity();
  row._id = id;
  row.name = name;
  row.order = order;
  row.projectId = PROJECT_ID;
  return row;
}

const PROJECT_SEVERITIES: Array<IncidentSeverity> = [
  severity(FORM_SEVERITY_ID, "Critical", 1),
  severity(MINOR_SEVERITY_ID, "Minor", 2),
];

function ownerUser(userId: string): IncidentTemplateOwnerUser {
  const owner: IncidentTemplateOwnerUser = new IncidentTemplateOwnerUser();
  owner.userId = new ObjectID(userId);
  return owner;
}

function ownerTeam(teamId: string): IncidentTemplateOwnerTeam {
  const owner: IncidentTemplateOwnerTeam = new IncidentTemplateOwnerTeam();
  owner.teamId = new ObjectID(teamId);
  return owner;
}

function templateWithSeverity(severityId: string | null): IncidentTemplate {
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = TEMPLATE_ID;

  if (severityId) {
    template.incidentSeverityId = new ObjectID(severityId);
  } else {
    setNull(template, "incidentSeverityId");
  }

  return template;
}

const VALID_ANSWERS: JSONObject = {
  title: "  Checkout is down  ",
  description: "Every order fails\n\n    at step 3",
  reporterName: "Jane Doe",
  reporterEmail: "Jane.Doe@Example.com",
};

let storedForm: IncidentForm | null = null;
let formFindOneBy: MockedFn;
let customFieldFindBy: MockedFn;
let severityFindBy: MockedFn;
let templateFindOneBy: MockedFn;
let incidentCreate: MockedFn;
let addOwners: MockedFn;
let ownerUserFindBy: MockedFn;
let ownerTeamFindBy: MockedFn;
let submissionCreate: MockedFn;
let noteCreate: MockedFn;
let captchaEnabled: MockedFn;
let verifyCaptcha: MockedFn;
let createdIncident: Incident;

beforeEach(() => {
  storedForm = buildForm();

  createdIncident = new Incident();
  createdIncident._id = INCIDENT_ID;
  createdIncident.projectId = PROJECT_ID;
  createdIncident.incidentNumber = 42;
  createdIncident.incidentNumberWithPrefix = "INC-42";

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

  jest
    .spyOn(IncidentFormService, "isProjectOnPlan")
    .mockResolvedValue(true as never);

  customFieldFindBy = jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue(PROJECT_FIELDS as never) as unknown as MockedFn;

  severityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue(PROJECT_SEVERITIES as never) as unknown as MockedFn;

  templateFindOneBy = jest
    .spyOn(IncidentTemplateService, "findOneBy")
    .mockResolvedValue(
      templateWithSeverity(MINOR_SEVERITY_ID) as never,
    ) as unknown as MockedFn;

  incidentCreate = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (): Promise<Incident> => {
      return createdIncident;
    }) as never) as unknown as MockedFn;

  addOwners = jest
    .spyOn(IncidentService, "addOwners")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  ownerUserFindBy = jest
    .spyOn(IncidentTemplateOwnerUserService, "findBy")
    .mockResolvedValue(
      OWNER_USER_IDS.map(ownerUser) as never,
    ) as unknown as MockedFn;

  ownerTeamFindBy = jest
    .spyOn(IncidentTemplateOwnerTeamService, "findBy")
    .mockResolvedValue([
      ownerTeam(OWNER_TEAM_ID),
    ] as never) as unknown as MockedFn;

  submissionCreate = jest
    .spyOn(IncidentFormSubmissionService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentFormSubmission;
    }): Promise<IncidentFormSubmission> => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  noteCreate = jest
    .spyOn(IncidentInternalNoteService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentInternalNote;
    }): Promise<IncidentInternalNote> => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  captchaEnabled = jest
    .spyOn(CaptchaUtil, "isCaptchaEnabled")
    .mockReturnValue(false) as unknown as MockedFn;

  verifyCaptcha = jest
    .spyOn(CaptchaUtil, "verifyCaptcha")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function submit(
  data: {
    answers?: unknown;
    captchaToken?: string;
    shareKey?: string | undefined;
    clientIp?: string | undefined;
  } = {},
): Promise<PublicIncidentFormSubmissionResult> {
  const request: { data: unknown; captchaToken?: string } = {
    data: "answers" in data ? data.answers : VALID_ANSWERS,
  };

  if (data.captchaToken !== undefined) {
    request.captchaToken = data.captchaToken;
  }

  return IncidentFormService.submitPublicForm({
    shareKey: "shareKey" in data ? data.shareKey : SHARE_KEY,
    request: request as never,
    clientIp: "clientIp" in data ? data.clientIp : CLIENT_IP,
    captchaRemoteIp: CAPTCHA_IP,
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

// The call IncidentService.create received.
function createCall(): { data: Incident; props: Record<string, unknown> } {
  expect(incidentCreate).toHaveBeenCalledTimes(1);

  return incidentCreate.mock.calls[0]![0] as {
    data: Incident;
    props: Record<string, unknown>;
  };
}

/*
 * Every column set on the incident handed to IncidentService.create, as
 * plain values. Asserting this whole object, rather than a column or two,
 * is what proves nothing else in the request reached the incident. (Only
 * table columns: the model's own bookkeeping, such as isPermissionIf, is
 * never written.)
 */
function createdColumns(): Record<string, unknown> {
  const incident: Incident = createCall().data;
  const columns: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(incident)) {
    if (value === undefined || !incident.hasColumn(key)) {
      continue;
    }

    columns[key] = value instanceof ObjectID ? value.toString() : value;
  }

  return columns;
}

const PLAIN_INCIDENT: Record<string, unknown> = {
  projectId: PROJECT_ID.toString(),
  title: "Checkout is down",
  description: "Every order fails\n\n    at step 3",
  incidentSeverityId: FORM_SEVERITY_ID,
  customFields: {},
  isVisibleOnStatusPage: false,
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
};

describe("IncidentFormService.submitPublicForm - the incident it declares", () => {
  test("a form without a template: exactly the reporter's incident, in the form's project, as root", async () => {
    await submit();

    expect(createdColumns()).toEqual(PLAIN_INCIDENT);
    expect(createCall().props).toEqual({ isRoot: true });
    expect(createCall().data).toBeInstanceOf(Incident);
  });

  test("a form with a template: the same, plus the template's id for IncidentService to apply", async () => {
    storedForm = withTemplate();

    await submit();

    expect(createdColumns()).toEqual({
      ...PLAIN_INCIDENT,
      createdIncidentTemplateId: TEMPLATE_ID,
    });
    expect(typeof createCall().data.createdIncidentTemplateId).toBe("string");
  });

  /*
   * IncidentService only applies a template when no state is given, so a
   * state here would silently drop the template's monitors, owners' policies
   * and everything else it sets.
   */
  test("never sets a state, so IncidentService's template branch runs", async () => {
    storedForm = withTemplate();

    await submit();

    expect(createCall().data.currentIncidentStateId).toBeUndefined();
    expect(createCall().data.currentIncidentState).toBeUndefined();
  });

  test("names no creating user: nobody signed in to send it", async () => {
    await submit();

    expect(createCall().data.createdByUserId).toBeUndefined();
    expect(createCall().data.createdByUser).toBeUndefined();
    expect(createCall().props["userId"]).toBeUndefined();
    expect(createCall().props["tenantId"]).toBeUndefined();
  });

  test("keeps the incident off every status page, and quiet to their subscribers, whatever the template says", async () => {
    storedForm = withTemplate();

    await submit();

    expect(createCall().data.isVisibleOnStatusPage).toBe(false);
    expect(
      createCall().data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
    ).toBe(false);
  });

  /*
   * The body is a stranger's. Nothing in it but the answers the form asks
   * for may reach the incident - least of all which project it lands in.
   */
  test("ignores everything in the body the form does not ask for", async () => {
    await submit({
      answers: {
        ...VALID_ANSWERS,
        projectId: OTHER_PROJECT_ID,
        currentIncidentStateId: ObjectID.generate().toString(),
        isPrivate: true,
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        createdByUserId: ObjectID.generate().toString(),
        createdIncidentTemplateId: ObjectID.generate().toString(),
        monitors: [{ _id: ObjectID.generate().toString() }],
        rootCause: "planted",
        incidentSeverityId: MINOR_SEVERITY_ID,
      },
    });

    expect(createdColumns()).toEqual(PLAIN_INCIDENT);
  });
});

describe("IncidentFormService.submitPublicForm - severity", () => {
  test("uses the reporter's choice when the form lets them choose", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    await submit({
      answers: {
        ...VALID_ANSWERS,
        incidentSeverityId: MINOR_SEVERITY_ID.toUpperCase(),
      },
    });

    expect(createdColumns()["incidentSeverityId"]).toBe(MINOR_SEVERITY_ID);
    expect(createCall().data.incidentSeverityId).toBeInstanceOf(ObjectID);
  });

  test("checks the choice against the form's project's severities, read as root", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    await submit({
      answers: { ...VALID_ANSWERS, incidentSeverityId: MINOR_SEVERITY_ID },
    });

    const findBy: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = severityFindBy.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("refuses a choice that is not one of the project's severities, declaring nothing", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    const error: Exception | undefined = await refusal(
      submit({
        answers: {
          ...VALID_ANSWERS,
          incidentSeverityId: ObjectID.generate().toString(),
        },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.code).toBe(400);
    expect(error?.message).toBe(
      "Severity must be one of the severities this form lists.",
    );
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("uses the form's severity when the reporter may choose but did not", async () => {
    storedForm = buildForm({ allowReporterToChooseSeverity: true });

    await submit({ answers: { ...VALID_ANSWERS, incidentSeverityId: "" } });

    expect(createdColumns()["incidentSeverityId"]).toBe(FORM_SEVERITY_ID);
  });

  test("ignores a choice, and reads no severities, when the form sets the severity", async () => {
    await submit({
      answers: { ...VALID_ANSWERS, incidentSeverityId: MINOR_SEVERITY_ID },
    });

    expect(createdColumns()["incidentSeverityId"]).toBe(FORM_SEVERITY_ID);
    expect(severityFindBy).not.toHaveBeenCalled();
  });

  test("ignores even an invalid choice when the form does not offer one", async () => {
    await submit({
      answers: { ...VALID_ANSWERS, incidentSeverityId: "not-a-severity" },
    });

    expect(createdColumns()["incidentSeverityId"]).toBe(FORM_SEVERITY_ID);
  });

  /*
   * Deleting the form's severity clears the column. With a template that
   * has a severity, the incident is declared without one here and
   * IncidentService's template branch fills it in.
   */
  test("leaves the severity to the template when the form's own was deleted", async () => {
    storedForm = withTemplate();
    setNull(storedForm, "incidentSeverityId");

    await submit();

    expect(createdColumns()).toEqual({
      ...PLAIN_INCIDENT,
      incidentSeverityId: undefined,
      createdIncidentTemplateId: TEMPLATE_ID,
    });
    expect(createCall().data.incidentSeverityId).toBeUndefined();
  });

  test("looks the template's severity up in the form's project, as root", async () => {
    storedForm = withTemplate();
    setNull(storedForm, "incidentSeverityId");

    await submit();

    expect(templateFindOneBy).toHaveBeenCalledWith({
      query: { _id: TEMPLATE_ID, projectId: PROJECT_ID },
      select: { incidentSeverityId: true },
      props: { isRoot: true },
    });
  });

  test("does not read the template when the form has a severity", async () => {
    storedForm = withTemplate();

    await submit();

    expect(templateFindOneBy).not.toHaveBeenCalled();
  });

  test.each([
    [
      "no template",
      (): IncidentForm => {
        return buildForm();
      },
      null,
    ],
    [
      "a template without a severity",
      (): IncidentForm => {
        return withTemplate();
      },
      templateWithSeverity(null),
    ],
    [
      "a template that is not in the form's project",
      (): IncidentForm => {
        return withTemplate();
      },
      null,
    ],
  ])(
    "refuses, declaring nothing, when no severity is left: %s",
    async (
      _label: string,
      form: () => IncidentForm,
      template: IncidentTemplate | null,
    ) => {
      storedForm = form();
      setNull(storedForm, "incidentSeverityId");
      templateFindOneBy.mockResolvedValue(template as never);

      const error: Exception | undefined = await refusal(submit());

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.code).toBe(400);
      expect(error?.message).toBe(INCIDENT_FORM_NO_SEVERITY_MESSAGE);
      expect(incidentCreate).not.toHaveBeenCalled();
    },
  );
});

describe("IncidentFormService.submitPublicForm - title and description", () => {
  test("trims the title and keeps it on one line", async () => {
    await submit({
      answers: { ...VALID_ANSWERS, title: "\n Checkout\tis   down \r\n" },
    });

    expect(createCall().data.title).toBe("Checkout is down");
  });

  test.each([
    ["missing", undefined],
    ["blank", "   "],
  ])(
    "refuses a %s title, declaring nothing",
    async (_label: string, title: string | undefined) => {
      const answers: JSONObject = { ...VALID_ANSWERS };

      if (title === undefined) {
        delete answers["title"];
      } else {
        answers["title"] = title;
      }

      const error: Exception | undefined = await refusal(submit({ answers }));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe("Title is required.");
      expect(incidentCreate).not.toHaveBeenCalled();
    },
  );

  test("a hidden description question: whatever was sent is ignored, so a template's description can apply", async () => {
    storedForm = withTemplate({
      descriptionSetting: IncidentFormFieldSetting.Hidden,
    });

    // VALID_ANSWERS carries a description; the form does not ask for one.
    await submit();

    expect(createCall().data.description).toBeUndefined();
  });

  test.each([
    ["left out", undefined],
    ["empty", ""],
    ["only whitespace", "  \n\n  "],
  ])(
    "an optional description %s is left undefined, not sent empty",
    async (_label: string, description: string | undefined) => {
      const answers: JSONObject = { ...VALID_ANSWERS };

      if (description === undefined) {
        delete answers["description"];
      } else {
        answers["description"] = description;
      }

      storedForm = withTemplate();

      await submit({ answers });

      expect(createCall().data.description).toBeUndefined();
    },
  );

  test("a required description that is missing is refused, declaring nothing", async () => {
    storedForm = buildForm({
      descriptionSetting: IncidentFormFieldSetting.Required,
    });

    const answers: JSONObject = { ...VALID_ANSWERS };
    delete answers["description"];

    const error: Exception | undefined = await refusal(submit({ answers }));

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe("Description is required.");
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("a required description that was written is declared as written", async () => {
    storedForm = buildForm({
      descriptionSetting: IncidentFormFieldSetting.Required,
    });

    await submit();

    expect(createCall().data.description).toBe(
      "Every order fails\n\n    at step 3",
    );
  });
});

describe("IncidentFormService.submitPublicForm - custom fields", () => {
  test("stores the answers to the fields the form asks, and drops every other key", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    await submit({
      answers: {
        ...VALID_ANSWERS,
        customFields: {
          Impact: "High",
          Region: "  EU-West  ",
          "Secret Escalation Path": "planted",
          Acknowledged: true,
          "No Such Field": "planted",
        },
      },
    });

    expect(createCall().data.customFields).toEqual({
      Impact: "High",
      Region: "EU-West",
    });
  });

  test("reads the project's fields from the form's own project, as root", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    await submit({
      answers: { ...VALID_ANSWERS, customFields: { Impact: "Low" } },
    });

    const findBy: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = customFieldFindBy.mock.calls[0]![0] as never;

    expect(findBy.query).toEqual({ projectId: PROJECT_ID });
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("leaves an unanswered optional field out, so a template's value for it still applies", async () => {
    storedForm = withTemplate({ customFieldSettings: FORM_QUESTIONS });

    await submit({
      answers: {
        ...VALID_ANSWERS,
        customFields: { Impact: "Low", Region: "" },
      },
    });

    expect(createCall().data.customFields).toEqual({ Impact: "Low" });
  });

  test("refuses an unanswered required field, declaring nothing", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    const error: Exception | undefined = await refusal(
      submit({ answers: { ...VALID_ANSWERS, customFields: { Region: "EU" } } }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe("Impact is required.");
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("refuses an answer that is not one of a dropdown's options", async () => {
    storedForm = buildForm({ customFieldSettings: FORM_QUESTIONS });

    const error: Exception | undefined = await refusal(
      submit({
        answers: { ...VALID_ANSWERS, customFields: { Impact: "Apocalyptic" } },
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("Apocalyptic");
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("a required yes/no question must be ticked", async () => {
    storedForm = buildForm({
      customFieldSettings: { acknowledged: "Required" },
    });

    const error: Exception | undefined = await refusal(
      submit({
        answers: { ...VALID_ANSWERS, customFields: { Acknowledged: false } },
      }),
    );

    expect(error?.message).toBe("Acknowledged must be checked.");

    await submit({
      answers: { ...VALID_ANSWERS, customFields: { Acknowledged: "true" } },
    });

    expect(createCall().data.customFields).toEqual({ Acknowledged: true });
  });

  test("ignores custom field answers entirely, and reads no fields, when the form asks none", async () => {
    await submit({
      answers: {
        ...VALID_ANSWERS,
        customFields: { Impact: "High", Region: "EU" },
      },
    });

    expect(createCall().data.customFields).toEqual({});
    expect(customFieldFindBy).not.toHaveBeenCalled();
  });
});

describe("IncidentFormService.submitPublicForm - the reporter", () => {
  test.each([
    ["no name", { reporterName: undefined }, "Your Name is required."],
    ["no email", { reporterEmail: undefined }, "Your Email is required."],
    [
      "an address that is not one",
      { reporterEmail: "jane at example" },
      "Your Email is not a valid email address.",
    ],
  ])(
    "refuses %s when the form requires the reporter's details",
    async (
      _label: string,
      change: Record<string, string | undefined>,
      message: string,
    ) => {
      const answers: JSONObject = { ...VALID_ANSWERS };

      for (const [key, value] of Object.entries(change)) {
        if (value === undefined) {
          delete answers[key];
        } else {
          answers[key] = value;
        }
      }

      const error: Exception | undefined = await refusal(submit({ answers }));

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(message);
      expect(incidentCreate).not.toHaveBeenCalled();
    },
  );

  test("reports every problem at once, as one message", async () => {
    const error: Exception | undefined = await refusal(
      submit({ answers: { title: "", reporterEmail: "nope" } }),
    );

    expect(error?.message).toBe(
      formatIncidentFormSubmissionErrors([
        "Title is required.",
        "Your Name is required.",
        "Your Email is not a valid email address.",
      ]),
    );
  });

  test("refuses a body without answers", async () => {
    const error: Exception | undefined = await refusal(
      submit({ answers: undefined }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "The submission must be an object holding the form's answers.",
    );
    expect(incidentCreate).not.toHaveBeenCalled();
  });
});

describe("IncidentFormService.submitPublicForm - the template's owners", () => {
  test("are added to the incident and notified", async () => {
    storedForm = withTemplate();

    await submit();

    expect(addOwners).toHaveBeenCalledTimes(1);

    const [projectId, incidentId, userIds, teamIds, notify, props] = addOwners
      .mock.calls[0] as [
      ObjectID,
      ObjectID,
      Array<ObjectID>,
      Array<ObjectID>,
      boolean,
      Record<string, unknown>,
    ];

    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    expect(incidentId.toString()).toBe(INCIDENT_ID);
    expect(
      userIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual(OWNER_USER_IDS);
    expect(
      teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([OWNER_TEAM_ID]);
    expect(notify).toBe(true);
    expect(props).toEqual({ isRoot: true });
  });

  test("are read for the form's template in the form's project, as root", async () => {
    storedForm = withTemplate();

    await submit();

    for (const findBy of [
      ownerUserFindBy.mock.calls[0]![0],
      ownerTeamFindBy.mock.calls[0]![0],
    ] as Array<{
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    }>) {
      expect(String(findBy.query["incidentTemplateId"])).toBe(TEMPLATE_ID);
      expect(String(findBy.query["projectId"])).toBe(PROJECT_ID.toString());
      expect(findBy.props).toEqual({ isRoot: true });
    }
  });

  test("with only owner users, adds them and no teams", async () => {
    storedForm = withTemplate();
    ownerTeamFindBy.mockResolvedValue([] as never);

    await submit();

    expect((addOwners.mock.calls[0]![3] as Array<ObjectID>).length).toBe(0);
    expect((addOwners.mock.calls[0]![2] as Array<ObjectID>).length).toBe(2);
  });

  test("adds nothing when the template has no owners", async () => {
    storedForm = withTemplate();
    ownerUserFindBy.mockResolvedValue([] as never);
    ownerTeamFindBy.mockResolvedValue([] as never);

    await submit();

    expect(addOwners).not.toHaveBeenCalled();
  });

  test("reads no owners, and adds none, for a form without a template", async () => {
    await submit();

    expect(ownerUserFindBy).not.toHaveBeenCalled();
    expect(ownerTeamFindBy).not.toHaveBeenCalled();
    expect(addOwners).not.toHaveBeenCalled();
  });
});

describe("IncidentFormService.submitPublicForm - the submission record", () => {
  test("names the form, the incident and the reporter, with the email lowercased", async () => {
    await submit();

    expect(submissionCreate).toHaveBeenCalledTimes(1);

    const createBy: {
      data: IncidentFormSubmission;
      props: Record<string, unknown>;
    } = submissionCreate.mock.calls[0]![0] as never;

    expect(createBy.props).toEqual({ isRoot: true });
    expect(createBy.data).toBeInstanceOf(IncidentFormSubmission);
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.incidentFormId?.toString()).toBe(FORM_ID);
    expect(createBy.data.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(createBy.data.reporterName).toBe("Jane Doe");
    expect(createBy.data.reporterEmail).toBeInstanceOf(Email);
    expect(createBy.data.reporterEmail?.toString()).toBe(
      "jane.doe@example.com",
    );
  });

  test("has no reporter for an anonymous report", async () => {
    storedForm = buildForm({ isReporterDetailsRequired: false });

    await submit({ answers: { title: "Checkout is down" } });

    const createBy: { data: IncidentFormSubmission } = submissionCreate.mock
      .calls[0]![0] as never;

    expect(createBy.data.reporterName).toBeUndefined();
    expect(createBy.data.reporterEmail).toBeUndefined();
    expect(createBy.data.incidentId?.toString()).toBe(INCIDENT_ID);
  });
});

describe("IncidentFormService.submitPublicForm - the private note", () => {
  function noteCall(): {
    data: IncidentInternalNote;
    props: Record<string, unknown>;
  } {
    expect(noteCreate).toHaveBeenCalledTimes(1);

    return noteCreate.mock.calls[0]![0] as never;
  }

  test("is a private note on the incident, written as root", async () => {
    await submit();

    expect(noteCall().props).toEqual({ isRoot: true });
    expect(noteCall().data).toBeInstanceOf(IncidentInternalNote);
    expect(noteCall().data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(noteCall().data.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(noteCall().data.createdByUserId).toBeUndefined();
  });

  test("names the form and the reporter", async () => {
    await submit();

    expect(noteCall().data.note).toBe(
      "Reported through the incident form **Report a Problem** by Jane Doe (<jane.doe@example.com>).",
    );
  });

  test("says anonymously when the reporter gave no details", async () => {
    storedForm = buildForm({ isReporterDetailsRequired: false });

    await submit({ answers: { title: "Checkout is down" } });

    expect(noteCall().data.note).toBe(
      "Reported anonymously through the incident form **Report a Problem**.",
    );
  });

  /*
   * The note is posted as it is - nobody reads it over first - so a
   * reporter's name must arrive as the characters they typed: never a link
   * to click, never an image fetched when a responder opens the incident,
   * never restyling the sentence.
   */
  test("escapes a hostile name and email so they read as typed", async () => {
    storedForm = buildForm({ isReporterDetailsRequired: false });

    await submit({
      answers: {
        title: "Checkout is down",
        reporterName:
          "[x](javascript:alert(1)) **bold** ![p](https://t.example/p) <img>",
        reporterEmail: "a_b+c@example.com",
      },
    });

    const note: string = noteCall().data.note || "";

    expect(note).toBe(
      "Reported through the incident form **Report a Problem** by " +
        "\\[x\\]\\(javascript:alert\\(1\\)\\) \\*\\*bold\\*\\* \\!\\[p\\]\\(https://t.example/p\\) \\<img\\> " +
        "(<a_b+c@example.com>).",
    );
    expect(note).not.toContain("[x](");
    expect(note).not.toContain("**bold**");
    expect(note).not.toContain("![p](");
  });
});

describe("getIncidentFormReporterNote", () => {
  test.each([
    [
      "a name and an email",
      { reporterName: "Jane", reporterEmail: "jane@example.com" },
      "Reported through the incident form **Report a Problem** by Jane (<jane@example.com>).",
    ],
    [
      "only a name",
      { reporterName: "Jane" },
      "Reported through the incident form **Report a Problem** by Jane.",
    ],
    [
      "only an email",
      { reporterEmail: "jane@example.com" },
      "Reported through the incident form **Report a Problem** by <jane@example.com>.",
    ],
    [
      "neither",
      {},
      "Reported anonymously through the incident form **Report a Problem**.",
    ],
    [
      "blank details",
      { reporterName: "  ", reporterEmail: null },
      "Reported anonymously through the incident form **Report a Problem**.",
    ],
  ])(
    "with %s",
    (
      _label: string,
      reporter: { reporterName?: string | null; reporterEmail?: string | null },
      note: string,
    ) => {
      expect(
        getIncidentFormReporterNote({
          formName: "Report a Problem",
          ...reporter,
        }),
      ).toBe(note);
    },
  );

  test("escapes the form's name too, which sits inside the note's own bold", () => {
    expect(
      getIncidentFormReporterNote({ formName: "IT ** Help_desk [EU]" }),
    ).toBe(
      "Reported anonymously through the incident form **IT \\*\\* Help\\_desk \\[EU\\]**.",
    );
  });

  test("reads well without a form name", () => {
    expect(getIncidentFormReporterNote({ reporterName: "Jane" })).toBe(
      "Reported through an incident form by Jane.",
    );
  });

  test("keeps a name on one line", () => {
    expect(
      getIncidentFormReporterNote({
        formName: "Form",
        reporterName: "Jane\n# Heading",
      }),
    ).toBe("Reported through the incident form **Form** by Jane \\# Heading.");
  });

  /*
   * The note reaches the owners by email (SendNotePostedNotification renders
   * it with marked) and the incident's Slack channels (slackify-markdown).
   * Written backslash-escaped, the address made marked restart its link
   * after each escape: mary\-jane.watson@... linked mailto:jane.watson@...,
   * a colleague's mailbox. Every link must be the whole address the reporter
   * gave - hyphen, underscore, plus, apostrophe or hyphenated domain.
   */
  describe("links the reporter's whole address", () => {
    const ADDRESSES: Array<string> = [
      "mary-jane.watson@corp.example",
      "first_last@company.com",
      "ops+alerts@company.com",
      "jane@my-company.com",
      "o'brien@company.com",
      "a_b+c@example.com",
    ];

    const REPORTERS: Array<[string, string | undefined]> = [];

    for (const address of ADDRESSES) {
      REPORTERS.push([address, "Jane Doe"]);
      REPORTERS.push([address, undefined]);
    }

    function hrefs(html: string): Array<string> {
      return Array.from(html.matchAll(/href="([^"]*)"/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    }

    test.each(REPORTERS)(
      "in the owners' email: %s (name %s)",
      async (address: string, reporterName: string | undefined) => {
        const note: string = getIncidentFormReporterNote({
          formName: "Report a Problem",
          reporterName: reporterName,
          reporterEmail: address,
        });

        const html: string = await Markdown.convertToHTML(
          note,
          MarkdownContentType.Email,
        );

        expect(hrefs(html)).toEqual([
          `mailto:${address.replace(/'/g, "&#39;")}`,
        ]);
        // The address reads as typed, too.
        expect(html).toContain(`>${address.replace(/'/g, "&#39;")}</a>`);
      },
    );

    test.each(REPORTERS)(
      "in Slack: %s (name %s)",
      (address: string, reporterName: string | undefined) => {
        const note: string = getIncidentFormReporterNote({
          formName: "Report a Problem",
          reporterName: reporterName,
          reporterEmail: address,
        });

        const sections: string = JSON.stringify(
          SlackUtil.getMarkdownBlocks({
            payloadMarkdownBlock: {
              _type: "WorkspacePayloadMarkdown",
              text: note,
            },
          }),
        );

        expect(sections).toContain(
          JSON.stringify(`<mailto:${address}|${address}>`).slice(1, -1),
        );
      },
    );

    test("escapes a value that is not one whole address, rather than linking it", () => {
      expect(
        getIncidentFormReporterNote({
          formName: "Form",
          reporterEmail: "Jane <jane@example.com>",
        }),
      ).toBe(
        "Reported through the incident form **Form** by Jane \\<jane@example.com\\>.",
      );
    });
  });
});

describe("IncidentFormService.submitPublicForm - after the incident exists", () => {
  test("a failure adding owners is logged, and the submission and note still happen", async () => {
    storedForm = withTemplate();
    addOwners.mockRejectedValue(new Error("owners down"));

    const result: PublicIncidentFormSubmissionResult = await submit();

    expect(result.incidentNumber).toBe("INC-42");
    expect(submissionCreate).toHaveBeenCalledTimes(1);
    expect(noteCreate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not add the template's owners to incident",
      ),
      expect.objectContaining({ incidentId: INCIDENT_ID }),
    );
  });

  test("a failure reading the owners is logged, not thrown", async () => {
    storedForm = withTemplate();
    ownerTeamFindBy.mockRejectedValue(new Error("read failed"));

    await expect(submit()).resolves.toEqual({
      incidentNumber: "INC-42",
      successMessage: "Thanks - **we are on it**.",
    });
    expect(addOwners).not.toHaveBeenCalled();
    expect(noteCreate).toHaveBeenCalledTimes(1);
  });

  test("a failure recording the submission is logged, and the note still happens", async () => {
    submissionCreate.mockRejectedValue(new Error("insert failed"));

    await expect(submit()).resolves.toHaveProperty("incidentNumber", "INC-42");
    expect(noteCreate).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not record the submission for incident"),
      expect.anything(),
    );
  });

  test("a failure writing the note is logged, not thrown", async () => {
    noteCreate.mockRejectedValue(new Error("insert failed"));

    await expect(submit()).resolves.toHaveProperty("incidentNumber", "INC-42");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not add the reporter's private note to"),
      expect.anything(),
    );
  });

  test("everything after the incident failing still answers with its number", async () => {
    storedForm = withTemplate();
    addOwners.mockRejectedValue(new Error("a"));
    submissionCreate.mockRejectedValue(new Error("b"));
    noteCreate.mockRejectedValue(new Error("c"));

    await expect(submit()).resolves.toEqual({
      incidentNumber: "INC-42",
      successMessage: "Thanks - **we are on it**.",
    });
  });
});

describe("IncidentFormService.submitPublicForm - when the incident cannot be declared", () => {
  test("answers with a message the reporter can act on, logs the reason, and does nothing else", async () => {
    incidentCreate.mockRejectedValue(
      new BadDataException(
        "Created incident state not found for this project. Please add created incident state from settings.",
      ),
    );

    const error: Exception | undefined = await refusal(submit());

    expect(error).toBeInstanceOf(ServerException);
    expect(error?.code).toBe(500);
    expect(error?.message).toBe(INCIDENT_FORM_SUBMIT_FAILED_MESSAGE);
    expect(logger.error).toHaveBeenCalled();
    expect(addOwners).not.toHaveBeenCalled();
    expect(submissionCreate).not.toHaveBeenCalled();
    expect(noteCreate).not.toHaveBeenCalled();
  });

  test("never hands the reporter an internal message or id", async () => {
    const internalId: string = ObjectID.generate().toString();
    incidentCreate.mockRejectedValue(
      new BadDataException(`Incident Severity ${internalId} is not in project`),
    );

    const error: Exception | undefined = await refusal(submit());

    expect(error?.message).not.toContain(internalId);
  });
});

describe("IncidentFormService.submitPublicForm - the answer", () => {
  test("is the incident's number and the form's success message", async () => {
    expect(await submit()).toEqual({
      incidentNumber: "INC-42",
      successMessage: "Thanks - **we are on it**.",
    });
  });

  test("numbers an incident of a project without a prefix with a #", async () => {
    setNull(createdIncident, "incidentNumberWithPrefix");

    expect((await submit()).incidentNumber).toBe("#42");
  });

  test("leaves the number out when the incident came back without one", async () => {
    setNull(createdIncident, "incidentNumberWithPrefix");
    setNull(createdIncident, "incidentNumber");

    expect(await submit()).not.toHaveProperty("incidentNumber");
  });

  test.each([
    ["empty", ""],
    ["blank", "  \n "],
    ["unset", null],
  ])(
    "leaves out a success message that is %s",
    async (_label: string, successMessage: string | null) => {
      storedForm = buildForm();
      (storedForm as unknown as Record<string, unknown>)["successMessage"] =
        successMessage;

      expect(await submit()).toEqual({ incidentNumber: "INC-42" });
    },
  );

  test("never includes the incident's id, the form's id or its project", async () => {
    const sent: string = JSON.stringify(await submit());

    expect(sent).not.toContain(INCIDENT_ID);
    expect(sent).not.toContain(FORM_ID);
    expect(sent).not.toContain(PROJECT_ID.toString());
  });
});

describe("IncidentFormService.submitPublicForm - the checks before anything is declared", () => {
  test("verifies the captcha, when the instance has one on, with the token and the client address", async () => {
    captchaEnabled.mockReturnValue(true);

    await submit({ captchaToken: "token-from-hcaptcha" });

    expect(verifyCaptcha).toHaveBeenCalledWith({
      token: "token-from-hcaptcha",
      remoteIp: CAPTCHA_IP,
    });
  });

  test("does not verify a captcha when the instance has none, even if a token is sent", async () => {
    await submit({ captchaToken: "token-from-hcaptcha" });

    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(incidentCreate).toHaveBeenCalledTimes(1);
  });

  test("refuses a failed captcha before reading or declaring anything", async () => {
    captchaEnabled.mockReturnValue(true);
    storedForm = buildForm({
      customFieldSettings: FORM_QUESTIONS,
      allowReporterToChooseSeverity: true,
    });
    verifyCaptcha.mockRejectedValue(
      new BadDataException("Captcha verification failed. Please try again."),
    );

    const error: Exception | undefined = await refusal(submit());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      "Captcha verification failed. Please try again.",
    );
    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(severityFindBy).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("checks the captcha before the answers", async () => {
    captchaEnabled.mockReturnValue(true);
    verifyCaptcha.mockRejectedValue(
      new BadDataException(
        "Captcha token is missing. Please complete the verification challenge.",
      ),
    );

    const error: Exception | undefined = await refusal(
      submit({ answers: { title: "" } }),
    );

    expect(error?.message).toBe(
      "Captcha token is missing. Please complete the verification challenge.",
    );
  });

  test.each([
    ["a junk link", { shareKey: "junk" }],
    ["an unknown link", { shareKey: OTHER_SHARE_KEY }],
  ])(
    "refuses %s as not available, without the captcha provider or a create",
    async (_label: string, change: { shareKey: string }) => {
      captchaEnabled.mockReturnValue(true);

      const error: Exception | undefined = await refusal(submit(change));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
      expect(verifyCaptcha).not.toHaveBeenCalled();
      expect(incidentCreate).not.toHaveBeenCalled();
    },
  );

  test("refuses a form that is turned off as not available", async () => {
    storedForm = buildForm({ isEnabled: false });

    const error: Exception | undefined = await refusal(submit());

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("refuses a form of a project off plan with the same answer as an unknown link", async () => {
    jest
      .spyOn(IncidentFormService, "isProjectOnPlan")
      .mockResolvedValue(false as never);

    const offPlan: Exception | undefined = await refusal(submit());
    const unknown: Exception | undefined = await refusal(
      submit({ shareKey: OTHER_SHARE_KEY }),
    );

    expect(offPlan).toBeInstanceOf(NotFoundException);
    expect([offPlan?.code, offPlan?.message]).toEqual([
      unknown?.code,
      unknown?.message,
    ]);
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("refuses a network the form does not allow, before the captcha", async () => {
    captchaEnabled.mockReturnValue(true);
    storedForm = buildForm({ ipWhitelist: "198.51.100.0/24" });

    const error: Exception | undefined = await refusal(submit());

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error?.message).toBe(INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    expect(verifyCaptcha).not.toHaveBeenCalled();
    expect(incidentCreate).not.toHaveBeenCalled();
  });

  test("lets an allowed network through to declare", async () => {
    storedForm = buildForm({ ipWhitelist: `198.51.100.0/24\n${CLIENT_IP}` });

    await submit();

    expect(incidentCreate).toHaveBeenCalledTimes(1);
  });

  test("refuses a request without an address when the form has an allowlist", async () => {
    storedForm = buildForm({ ipWhitelist: CLIENT_IP });

    expect(await refusal(submit({ clientIp: undefined }))).toBeInstanceOf(
      ForbiddenException,
    );
  });

  test("looks the form up once, by its share key, as root", async () => {
    await submit();

    expect(formFindOneBy).toHaveBeenCalledTimes(1);

    const findBy: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = formFindOneBy.mock.calls[0]![0] as never;

    expect(Object.keys(findBy.query)).toEqual(["shareKey"]);
    expect(String(findBy.query["shareKey"])).toBe(SHARE_KEY);
    expect(findBy.props).toEqual({ isRoot: true });
  });
});
