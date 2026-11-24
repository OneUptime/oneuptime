import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a public submission to a form that creates alerts turns into
 * (#10760): FormService.submitPublicForm with the alert target's handler
 * behind it.
 *
 * The alert target goes through every protection an incident form has -
 * they are FormService's, for every target alike - and this pins that they
 * hold for it:
 *
 *   - the checks, in order: the link, the IP allowlist, the captcha, the
 *     answers (only the severities and monitors the form offers), what the
 *     alert needs (a severity), then the form's hourly ceiling, spent only
 *     by a submission about to be created - and a refused submission
 *     creates nothing;
 *   - the alert: created as root through AlertService, in the form's
 *     project whatever the body says, from the answers and the On Submit
 *     settings, its owners handed to the create, never an incident or a
 *     maintenance event;
 *   - nothing the submitter wrote acting on its own: mentions, images and
 *     diagrams are broken before the alert or its note is written;
 *   - afterwards: the submission recorded with the alert's id, and a private
 *     note left on the alert.
 *
 * Only the database, the captcha provider and the rate limiter's counter
 * are stubbed.
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

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Form from "../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import FormRateLimit, {
  FormCeilingException,
} from "../../../Server/Middleware/FormRateLimit";
import AlertCustomFieldService from "../../../Server/Services/AlertCustomFieldService";
import AlertInternalNoteService from "../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FormService, {
  FORM_NOT_AVAILABLE_MESSAGE,
} from "../../../Server/Services/FormService";
import FormSubmissionService from "../../../Server/Services/FormSubmissionService";
import IncidentService from "../../../Server/Services/IncidentService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import CaptchaUtil from "../../../Server/Utils/Captcha";
import { FORM_NO_ALERT_SEVERITY_MESSAGE } from "../../../Server/Utils/Form/AlertFormTarget";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  FormField,
  FormFieldSource,
  FormSubmitterField,
} from "../../../Types/Form/FormField";
import { PublicFormSubmissionResult } from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  neutralizeUntrustedMarkdown,
  neutralizeUntrustedPlainText,
} from "../../../Utils/Markdown/UntrustedMarkdown";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const OTHER_PROJECT_ID: string = "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f02";
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000a1";
const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90aa7";
const CLIENT_IP: string = "203.0.113.7";

const FORM_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000a1";
const CHOSEN_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000a2";
const UNOFFERED_SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000a3";
const ACKNOWLEDGED_STATE_ID: string = "b1000000-0000-4000-8000-0000000000a1";
const API_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000a1";
const WEB_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000a2";
const DB_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000a3";
const LABEL_ID: string = "c2000000-0000-4000-8000-0000000000a1";
const POLICY_ID: string = "c3000000-0000-4000-8000-0000000000a1";
const TEAM_ID: string = "c4000000-0000-4000-8000-0000000000a1";
const MEMBER_USER_ID: string = "c5000000-0000-4000-8000-0000000000a1";
const REGION_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000a1";
const ALERT_ID: string = "e0000000-0000-4000-8000-0000000000a1";

// The records the form's project has, by the service that reads them.
const PROJECT_RECORDS: Map<unknown, Set<string>> = new Map();

const ALERT_FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "What needs a look?",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Details",
    isRequired: false,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "alertSeverityId",
    label: "How bad is it?",
    isRequired: false,
    allowedOptionIds: [FORM_SEVERITY_ID, CHOSEN_SEVERITY_ID],
  },
  {
    id: "monitor",
    source: FormFieldSource.TargetField,
    targetField: "monitor",
    label: "Which service?",
    isRequired: false,
    allowedOptionIds: [API_MONITOR_ID, WEB_MONITOR_ID],
  },
  {
    id: "region",
    source: FormFieldSource.TargetCustomField,
    customFieldId: REGION_FIELD_ID,
    label: "Region",
    isRequired: false,
  },
  {
    id: "where",
    source: FormFieldSource.Question,
    type: CustomFieldType.Text,
    label: "Where did you see it?",
    isRequired: false,
  },
  {
    id: "name",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Name,
    label: "Your Name",
    isRequired: false,
  },
  {
    id: "email",
    source: FormFieldSource.Submitter,
    submitterField: FormSubmitterField.Email,
    label: "Your Email",
    isRequired: false,
  },
];

const ALERT_SETTINGS: JSONObject = {
  defaultTitle: "Reported through the form",
  alertSeverityId: FORM_SEVERITY_ID,
  alertStateId: ACKNOWLEDGED_STATE_ID,
  monitorId: DB_MONITOR_ID,
  labelIds: [LABEL_ID],
  onCallDutyPolicyIds: [POLICY_ID],
  ownerUserIds: [MEMBER_USER_ID],
  ownerTeamIds: [TEAM_ID],
};

const ANSWERS: JSONObject = {
  title: "Checkout is slow",
  description: "Since noon, from the EU.",
  severity: CHOSEN_SEVERITY_ID,
  monitor: API_MONITOR_ID,
  region: "EU",
  where: "On the checkout page",
  name: "Jane Doe",
  email: "Jane@Example.com",
};

let storedForm: Form | null = null;
let alertCreate: MockedFn;
let alertNoteCreate: MockedFn;
let incidentCreate: MockedFn;
let eventCreate: MockedFn;
let submissionCreate: MockedFn;
let reserveCeiling: MockedFn;
let verifyCaptcha: MockedFn;

function buildAlertForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form._id = FORM_ID;
  form.projectId = PROJECT_ID;
  form.name = "Something Looks Wrong";
  form.isEnabled = true;
  form.shareKey = new ObjectID(SHARE_KEY);
  form.targetType = FormTargetType.Alert;
  form.fields = ALERT_FIELDS as unknown as JSONArray;
  form.targetSettings = { ...ALERT_SETTINGS };
  form.successMessage = "Thanks - we will take a look.";
  form.ipWhitelist = "";
  Object.assign(form, data);
  return form;
}

function projectHas(service: unknown, ids: Array<string>): void {
  PROJECT_RECORDS.set(service, new Set(ids));
}

// A record is found by id only in the form's own project.
function stubProjectLookup(service: unknown): void {
  jest
    .spyOn(service as DatabaseService<never>, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { _id?: unknown; projectId?: unknown };
    }): Promise<unknown> => {
      const id: string = String(findBy.query._id || "").toLowerCase();
      const projectId: string = String(findBy.query.projectId || "");

      if (
        projectId !== PROJECT_ID.toString() ||
        !PROJECT_RECORDS.get(service)?.has(id)
      ) {
        return null;
      }

      return { _id: id, id: new ObjectID(id) };
    }) as never);
}

beforeEach(() => {
  storedForm = buildAlertForm();

  projectHas(AlertSeverityService, [FORM_SEVERITY_ID, CHOSEN_SEVERITY_ID]);
  projectHas(AlertStateService, [ACKNOWLEDGED_STATE_ID]);
  projectHas(MonitorService, [API_MONITOR_ID, WEB_MONITOR_ID, DB_MONITOR_ID]);
  projectHas(LabelService, [LABEL_ID]);
  projectHas(OnCallDutyPolicyService, [POLICY_ID]);
  projectHas(TeamService, [TEAM_ID]);

  for (const service of [
    AlertSeverityService,
    AlertStateService,
    MonitorService,
    LabelService,
    OnCallDutyPolicyService,
    TeamService,
  ]) {
    stubProjectLookup(service);
  }

  jest.spyOn(FormService, "findOneBy").mockImplementation((async (findBy: {
    query: { shareKey?: ObjectID };
  }): Promise<Form | null> => {
    return storedForm &&
      findBy.query.shareKey?.toString() === storedForm.shareKey?.toString()
      ? storedForm
      : null;
  }) as never);

  jest.spyOn(FormService, "isProjectOnPlan").mockResolvedValue(true as never);

  // The records a question offers, as the public form lists them.
  jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue([
    Object.assign(new AlertSeverity(), {
      _id: FORM_SEVERITY_ID,
      name: "Low",
    }),
    Object.assign(new AlertSeverity(), {
      _id: CHOSEN_SEVERITY_ID,
      name: "High",
    }),
    Object.assign(new AlertSeverity(), {
      _id: UNOFFERED_SEVERITY_ID,
      name: "Critical",
    }),
  ] as never);
  jest
    .spyOn(MonitorService, "findBy")
    .mockResolvedValue([
      Object.assign(new Monitor(), { _id: API_MONITOR_ID, name: "API" }),
      Object.assign(new Monitor(), { _id: WEB_MONITOR_ID, name: "Website" }),
    ] as never);
  jest
    .spyOn(LabelService, "findBy")
    .mockResolvedValue([
      Object.assign(new Label(), { _id: LABEL_ID, name: "customer-report" }),
    ] as never);
  jest.spyOn(AlertCustomFieldService, "findBy").mockResolvedValue([
    Object.assign(new AlertCustomField(), {
      _id: REGION_FIELD_ID,
      name: "Region",
      customFieldType: CustomFieldType.Text,
    }),
  ] as never);

  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation((async (data: {
      userIds: Array<string | ObjectID>;
    }): Promise<Array<ObjectID>> => {
      return data.userIds
        .map((id: string | ObjectID): string => {
          return id.toString();
        })
        .filter((id: string): boolean => {
          return id === MEMBER_USER_ID;
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });
    }) as never);

  alertCreate = jest
    .spyOn(AlertService, "create")
    .mockImplementation((async (): Promise<Alert> => {
      const alert: Alert = new Alert();
      alert._id = ALERT_ID;
      alert.alertNumber = 7;
      alert.alertNumberWithPrefix = "ALT-7";
      return alert;
    }) as never) as unknown as MockedFn;

  incidentCreate = jest
    .spyOn(IncidentService, "create")
    .mockImplementation((async (): Promise<never> => {
      throw new Error("An alert form never declares an incident.");
    }) as never) as unknown as MockedFn;

  eventCreate = jest
    .spyOn(ScheduledMaintenanceService, "create")
    .mockImplementation((async (): Promise<never> => {
      throw new Error("An alert form never schedules maintenance.");
    }) as never) as unknown as MockedFn;

  submissionCreate = jest
    .spyOn(FormSubmissionService, "create")
    .mockImplementation((async (createBy: { data: FormSubmission }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  alertNoteCreate = jest
    .spyOn(AlertInternalNoteService, "create")
    .mockImplementation((async (createBy: { data: AlertInternalNote }) => {
      return createBy.data;
    }) as never) as unknown as MockedFn;

  reserveCeiling = jest
    .spyOn(FormRateLimit, "reserveFormSubmission")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  jest.spyOn(CaptchaUtil, "isCaptchaEnabled").mockReturnValue(false);
  verifyCaptcha = jest
    .spyOn(CaptchaUtil, "verifyCaptcha")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

function submit(
  answers: unknown,
  extra: { captchaToken?: string; clientIp?: string } = {},
): Promise<PublicFormSubmissionResult> {
  return FormService.submitPublicForm({
    shareKey: SHARE_KEY,
    request: {
      data: { answers: answers as JSONObject },
      captchaToken: extra.captchaToken,
    },
    clientIp: extra.clientIp || CLIENT_IP,
    captchaRemoteIp: extra.clientIp || CLIENT_IP,
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

function alertCreateBy(): {
  data: Alert;
  props: JSONObject;
  miscDataProps?: JSONObject;
} {
  expect(alertCreate).toHaveBeenCalledTimes(1);
  return alertCreate.mock.calls[0]![0] as never;
}

function createdAlert(): Alert {
  return alertCreateBy().data;
}

function idsOf(records: Array<{ _id?: string }> | undefined): Array<string> {
  return (records || []).map((record: { _id?: string }): string => {
    return String(record._id);
  });
}

function recordedSubmission(): FormSubmission {
  expect(submissionCreate).toHaveBeenCalledTimes(1);
  return (submissionCreate.mock.calls[0]![0] as { data: FormSubmission }).data;
}

function nothingCreated(): void {
  expect(alertCreate).not.toHaveBeenCalled();
  expect(incidentCreate).not.toHaveBeenCalled();
  expect(eventCreate).not.toHaveBeenCalled();
  expect(submissionCreate).not.toHaveBeenCalled();
  expect(alertNoteCreate).not.toHaveBeenCalled();
}

describe("submitPublicForm - the alert a form creates", () => {
  test("creates it in the form's project, as root, from the answers and the settings", async () => {
    await submit(ANSWERS);

    const createBy: {
      data: Alert;
      props: JSONObject;
      miscDataProps?: JSONObject;
    } = alertCreateBy();
    const alert: Alert = createBy.data;

    expect(createBy.props).toEqual({ isRoot: true });
    expect(alert.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(alert.title).toBe("Checkout is slow");
    expect(alert.description).toBe("Since noon, from the EU.");
    // The submitter's severity and monitor win over the form's.
    expect(alert.alertSeverityId?.toString()).toBe(CHOSEN_SEVERITY_ID);
    expect(alert.monitorId?.toString()).toBe(API_MONITOR_ID);
    // The form's state, labels and on-call policies.
    expect(alert.currentAlertStateId?.toString()).toBe(ACKNOWLEDGED_STATE_ID);
    expect(idsOf(alert.labels as never)).toEqual([LABEL_ID]);
    expect(idsOf(alert.onCallDutyPolicies as never)).toEqual([POLICY_ID]);
    expect(alert.customFields).toEqual({ Region: "EU" });
    // Nobody signed in to send it.
    expect(alert.createdByUserId).toBeUndefined();
  });

  test("its owners are handed to the create, for AlertService to add before Alert Created goes out", async () => {
    await submit(ANSWERS);

    const misc: JSONObject = alertCreateBy().miscDataProps as JSONObject;

    expect(
      (misc["ownerUsers"] as unknown as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([MEMBER_USER_ID]);
    expect(
      (misc["ownerTeams"] as unknown as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([TEAM_ID]);
  });

  test("the form's severity and monitor, when the submitter chose none", async () => {
    await submit({ title: "Checkout is slow" });

    const alert: Alert = createdAlert();

    expect(alert.alertSeverityId?.toString()).toBe(FORM_SEVERITY_ID);
    expect(alert.monitorId?.toString()).toBe(DB_MONITOR_ID);
  });

  test("ignores a project or record ids the body tries to set", async () => {
    await submit({
      ...ANSWERS,
      projectId: OTHER_PROJECT_ID,
      alertSeverityId: UNOFFERED_SEVERITY_ID,
      monitorId: DB_MONITOR_ID,
      isPrivate: true,
    });

    const alert: Alert = createdAlert();

    expect(alert.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(alert.alertSeverityId?.toString()).toBe(CHOSEN_SEVERITY_ID);
    expect(alert.monitorId?.toString()).toBe(API_MONITOR_ID);
    expect(alert.isPrivate).toBeUndefined();
  });

  test("never declares an incident or schedules maintenance", async () => {
    await submit(ANSWERS);

    expect(incidentCreate).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  test("answers with the alert's number and the form's thank-you message", async () => {
    const result: PublicFormSubmissionResult = await submit(ANSWERS);

    expect(JSON.stringify(result)).toContain("ALT-7");
    expect(JSON.stringify(result)).toContain("Thanks - we will take a look.");
  });
});

describe("submitPublicForm - an alert form's protections", () => {
  test("a form not accepting submissions is not available", async () => {
    storedForm = buildAlertForm({ isEnabled: false });

    const error: Exception | undefined = await refusal(submit(ANSWERS));

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error?.message).toBe(FORM_NOT_AVAILABLE_MESSAGE);
    nothingCreated();
  });

  test("a network the form does not allow is refused before the captcha", async () => {
    storedForm = buildAlertForm({ ipWhitelist: "198.51.100.0/24" });
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);

    expect(await refusal(submit(ANSWERS))).toBeInstanceOf(ForbiddenException);
    expect(verifyCaptcha).not.toHaveBeenCalled();
    nothingCreated();
  });

  test("verifies the captcha, when the instance has one, with the token and the client's address", async () => {
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);

    await submit(ANSWERS, { captchaToken: "solved" });

    expect(verifyCaptcha).toHaveBeenCalledWith({
      token: "solved",
      remoteIp: CLIENT_IP,
    });
    expect(alertCreate).toHaveBeenCalledTimes(1);
  });

  test("a failed captcha is refused, and nothing is created", async () => {
    (CaptchaUtil.isCaptchaEnabled as unknown as MockedFn).mockReturnValue(true);
    verifyCaptcha.mockRejectedValue(
      new BadDataException("Captcha verification failed. Please try again."),
    );

    const error: Exception | undefined = await refusal(submit(ANSWERS));

    expect(error?.message).toBe(
      "Captcha verification failed. Please try again.",
    );
    nothingCreated();
  });

  test("a severity the question does not offer is refused, and nothing is created", async () => {
    const error: Exception | undefined = await refusal(
      submit({ ...ANSWERS, severity: UNOFFERED_SEVERITY_ID }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    nothingCreated();
  });

  test("a monitor the question does not offer is refused, and nothing is created", async () => {
    const error: Exception | undefined = await refusal(
      submit({ ...ANSWERS, monitor: DB_MONITOR_ID }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    nothingCreated();
  });

  test("a required question left empty is refused, and nothing is created", async () => {
    const error: Exception | undefined = await refusal(
      submit({ ...ANSWERS, title: "" }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    nothingCreated();
  });

  test("with no severity anywhere, the submission is refused with words the submitter can pass on, and the hour's allowance is not spent", async () => {
    storedForm = buildAlertForm({
      targetSettings: { ...ALERT_SETTINGS, alertSeverityId: undefined },
    });

    const error: Exception | undefined = await refusal(
      submit({ title: "Checkout is slow" }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(FORM_NO_ALERT_SEVERITY_MESSAGE);
    expect(reserveCeiling).not.toHaveBeenCalled();
    nothingCreated();
  });

  test("the hour's allowance is spent once, after every check and right before the alert is created", async () => {
    const order: Array<string> = [];

    reserveCeiling.mockImplementation((async (): Promise<void> => {
      order.push("ceiling");
    }) as never);
    alertCreate.mockImplementation((async (): Promise<Alert> => {
      order.push("create");
      const alert: Alert = new Alert();
      alert._id = ALERT_ID;
      return alert;
    }) as never);

    await submit(ANSWERS);

    expect(order).toEqual(["ceiling", "create"]);
    expect(reserveCeiling).toHaveBeenCalledWith({ shareKey: SHARE_KEY });
  });

  test("once the hour's allowance is used, nothing is created", async () => {
    reserveCeiling.mockRejectedValue(new FormCeilingException(1200));

    expect(await refusal(submit(ANSWERS))).toBeInstanceOf(FormCeilingException);
    nothingCreated();
  });
});

describe("submitPublicForm - nothing the submitter wrote acts on its own, on an alert", () => {
  const TITLE: string = "Down <!channel> ![x](https://evil.example/x.png)";
  const DESCRIPTION: string =
    "See ![status](https://evil.example/status.png) <!here>\n\n```mermaid\ngraph TD;A-->B\n```";
  const WHERE: string = "Ping <!subteam^S123> <@U0123ABC> then retry";

  test("the title and description lose their mentions, images and diagrams", async () => {
    await submit({
      ...ANSWERS,
      title: TITLE,
      description: DESCRIPTION,
    });

    const alert: Alert = createdAlert();

    expect(alert.title).toBe(neutralizeUntrustedPlainText(TITLE));
    expect(alert.title).not.toBe(TITLE);
    expect(alert.description).toBe(neutralizeUntrustedMarkdown(DESCRIPTION));
    expect(alert.description).not.toBe(DESCRIPTION);
    // The diagram is code now, and the image a link the renderers show as text.
    expect(alert.description).toContain("```text");
    expect(alert.description).not.toMatch(/(^|[^\\])!\[status\]/);
  });

  test("a custom field's text answer loses its mentions too", async () => {
    await submit({ ...ANSWERS, region: "EU <!channel>" });

    expect((createdAlert().customFields as JSONObject)["Region"]).not.toContain(
      "<!channel>",
    );
  });

  test("a text answer of the form's own lands on the alert's private note, broken", async () => {
    await submit({ ...ANSWERS, where: WHERE });

    const note: string = (
      alertNoteCreate.mock.calls[0]![0] as { data: AlertInternalNote }
    ).data.note!;

    expect(note).toContain("Where did you see it?");
    expect(note).not.toContain("<!subteam");
    expect(note).not.toContain("<@U0123ABC>");
  });

  test("ordinary text is stored exactly as typed", async () => {
    await submit({
      ...ANSWERS,
      description:
        "Orders fail with **500** - see [the log](https://logs.example/1).",
    });

    expect(createdAlert().description).toBe(
      "Orders fail with **500** - see [the log](https://logs.example/1).",
    );
  });
});

describe("submitPublicForm - an alert form's submission record and private note", () => {
  test("the record names the form, the alert it created and the submitter, the email lowercased", async () => {
    await submit(ANSWERS);

    const submission: FormSubmission = recordedSubmission();

    expect(submission.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(submission.formId?.toString()).toBe(FORM_ID);
    expect(submission.targetType).toBe(FormTargetType.Alert);
    expect(submission.alertId?.toString()).toBe(ALERT_ID);
    expect(submission.incidentId).toBeUndefined();
    expect(submission.scheduledMaintenanceId).toBeUndefined();
    expect(submission.submitterName).toBe("Jane Doe");
    expect(submission.submitterEmail?.toString()).toBe("jane@example.com");
    expect(
      (submissionCreate.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("the private note is on the alert, names the form and the submitter, and lists the form's own questions only", async () => {
    await submit(ANSWERS);

    expect(alertNoteCreate).toHaveBeenCalledTimes(1);

    const createBy: { data: AlertInternalNote; props: JSONObject } =
      alertNoteCreate.mock.calls[0]![0] as never;
    const note: AlertInternalNote = createBy.data;

    expect(createBy.props).toEqual({ isRoot: true });
    expect(note.alertId?.toString()).toBe(ALERT_ID);
    expect(note.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(note.note).toContain(
      "Submitted through the form **Something Looks Wrong** by Jane Doe (<jane@example.com>).",
    );
    expect(note.note).toContain(
      "**Where did you see it?**  \nOn the checkout page",
    );
    // The answers already on the alert are not repeated.
    expect(note.note).not.toContain("What needs a look?");
    expect(note.note).not.toContain("Region");
  });
});
