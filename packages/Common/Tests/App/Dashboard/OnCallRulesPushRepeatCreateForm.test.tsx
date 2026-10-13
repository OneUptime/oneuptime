import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The form that adds an on-call rule, drawn for real: OnCallRulesTable's own
 * fields and onBeforeCreate in the real ModelForm and BasicForm, with only
 * the network stubbed. What a push rule is created with is decided by the
 * form's machinery as much as by the field list - which value a field
 * starts on, what a hidden field still sends - and a recorded field list
 * cannot show either.
 *
 * Pinned here for "Repeat until acknowledged":
 *
 *   - a push rule left alone is added without repeating. A form fills a
 *     field in with its default only when that default is truthy, and the
 *     column's default is 0: the field started empty and, being required,
 *     refused every push rule until "Don't repeat" was picked by hand;
 *   - an interval picked is what the rule is created with, "Don't repeat"
 *     (a 0, which the form machinery reads as "nothing" in more than one
 *     place) included;
 *   - an interval picked for a push device and left behind when the method
 *     is changed to something else is not sent: the server refuses a
 *     repeating rule that does not page a push device, in words about a
 *     field the form no longer shows.
 */

configure({ asyncUtilTimeout: 15000 });

// The real form is slow to draw and to walk under jsdom.
jest.setTimeout(180000);

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";
const CURRENT_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b1";
const SEVERITY_ONE_ID: string = "00000000-0000-4000-8000-0000000000c1";

const OWN_IPHONE_ID: string = "00000000-0000-4000-8000-0000000000f1";
const OWN_BROWSER_ID: string = "00000000-0000-4000-8000-0000000000f3";
const OWN_EMAIL_ID: string = "00000000-0000-4000-8000-0000000000e1";

const IPHONE_OPTION: string = "Push: iPhone 17";
const BROWSER_OPTION: string = "Push: Chrome on Mac";
const EMAIL_OPTION: string = "Email: me@example.com";

const REPEAT_FIELD_NAME: RegExp = /^Repeat until acknowledged/;

/*
 * What a rule that does not repeat may be sent with: no interval at all,
 * which the server stores as its default, or that default itself.
 */
const NOT_REPEATING: Array<number | undefined> = [undefined, 0];

const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: async (): Promise<Record<string, unknown>> => {
        return {};
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      createOrUpdate: (...args: Array<any>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

/*
 * A master admin holds every column permission the form checks, so every
 * field is drawn - which fields a member may fill in is not this file's
 * business.
 */
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return currentUserId;
      },
      isMasterAdmin: () => {
        return true;
      },
    },
  };
});

interface CapturedTableProps {
  formFields: Array<ModelField<UserNotificationRule>>;
  onBeforeCreate: (
    model: UserNotificationRule,
    miscDataProps: JSONObject,
  ) => Promise<UserNotificationRule>;
}

let capturedTables: Array<CapturedTableProps> = [];

// The table is a recorder: its form fields are drawn in a real form below.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTables.push(props);
      return null;
    },
  };
});

import OnCallRulesTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const currentUserId: ObjectID = new ObjectID(CURRENT_USER_ID_STRING);

function device(data: {
  id: string;
  name: string;
  deviceType: PushDeviceType;
}): UserPush {
  const push: UserPush = new UserPush();
  push._id = data.id;
  push.deviceName = data.name;
  push.deviceType = data.deviceType;
  push.isCriticalAlertEnabled = true;
  return push;
}

beforeEach(() => {
  capturedTables = [];
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  createOrUpdateMock.mockImplementation((data: any) => {
    return Promise.resolve({ data: data.model });
  });

  getListMock.mockImplementation((data: any) => {
    if (data.modelType === IncidentSeverity) {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ONE_ID;
      severity.name = "Sev 1";

      return Promise.resolve({ data: [severity], count: 1, skip: 0, limit: 1 });
    }

    if (data.modelType === UserPush) {
      const devices: Array<UserPush> = [
        device({
          id: OWN_IPHONE_ID,
          name: "iPhone 17",
          deviceType: PushDeviceType.iOS,
        }),
        device({
          id: OWN_BROWSER_ID,
          name: "Chrome on Mac",
          deviceType: PushDeviceType.Web,
        }),
      ];

      return Promise.resolve({ data: devices, count: 2, skip: 0, limit: 2 });
    }

    if (data.modelType === UserEmail) {
      const email: UserEmail = new UserEmail();
      email._id = OWN_EMAIL_ID;
      email.email = new Email("me@example.com");

      return Promise.resolve({ data: [email], count: 1, skip: 0, limit: 1 });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

/*
 * Your own On-Call Rules page's create form: the table is drawn first, for
 * the fields and the hook it hands its form, and they are then drawn in the
 * form the table would open.
 */
async function renderCreateForm(): Promise<UserEvent> {
  render(
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
      userPreferencesKeyPrefix="user-notification-rules-table"
      cardDescription="How you are notified."
    />,
  );

  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(0);
  });

  const table: CapturedTableProps = capturedTables[capturedTables.length - 1]!;

  await act(async (): Promise<void> => {
    render(
      <ModelForm<UserNotificationRule>
        modelType={UserNotificationRule}
        id="create-on-call-rule-form"
        name="Create On-Call Rule"
        fields={table.formFields}
        formType={FormType.Create}
        onBeforeCreate={(
          model: UserNotificationRule,
          miscDataProps: JSONObject,
        ): Promise<UserNotificationRule> => {
          return table.onBeforeCreate(model, miscDataProps);
        }}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Add"
      />,
    );
  });

  await screen.findByRole("button", { name: "Add" });

  return userEvent.setup({ delay: null });
}

// A click, inside act: the form and the dropdowns update on every one.
async function userClick(user: UserEvent, element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await user.click(element);
  });
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await userClick(user, combobox);

  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });

  await userClick(user, options[options.length - 1]!);
}

async function pickMethod(user: UserEvent, optionText: string): Promise<void> {
  await pickOption(
    user,
    screen.getByRole("combobox", { name: /^Notification Method/ }),
    optionText,
  );
}

function repeatField(): HTMLElement | null {
  return screen.queryByRole("combobox", { name: REPEAT_FIELD_NAME });
}

// What the repeat dropdown reads: its pick, or the placeholder standing in.
function repeatFieldText(): string {
  const control: Element | null | undefined = repeatField()?.closest(
    ".ou-select__control",
  );

  if (!control) {
    throw new Error("no repeat dropdown on the form");
  }

  return control.textContent || "";
}

async function pickNotifyImmediately(user: UserEvent): Promise<void> {
  await pickOption(
    user,
    screen.getByRole("combobox", { name: /^Notify me after/ }),
    "Immediately",
  );
}

// The rule the form hands the API, after the table's onBeforeCreate.
async function submit(user: UserEvent): Promise<UserNotificationRule> {
  await userClick(user, screen.getByRole("button", { name: "Add" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (
    createOrUpdateMock.mock.calls[0]![0] as { model: UserNotificationRule }
  ).model;
}

describe("adding a push rule through the create form", () => {
  test("a push rule nobody set a repeat on is added, and does not repeat", async () => {
    const user: UserEvent = await renderCreateForm();

    await pickMethod(user, BROWSER_OPTION);

    // Shown for a browser too, and reading what it starts on.
    expect(repeatField()).not.toBeNull();
    expect(repeatFieldText()).toBe("Don't repeat");

    await pickNotifyImmediately(user);

    const created: UserNotificationRule = await submit(user);

    expect(created.repeatEveryMinutes).toBe(0);
    expect(created.userPushId?.toString()).toBe(OWN_BROWSER_ID);
    expect(
      screen.queryByText("Repeat until acknowledged is required."),
    ).toBeNull();
  });

  test("the interval picked is the one the rule is created with", async () => {
    const user: UserEvent = await renderCreateForm();

    await pickMethod(user, IPHONE_OPTION);
    await pickOption(user, repeatField()!, "Every 5 minutes");

    expect(repeatFieldText()).toBe("Every 5 minutes");

    await pickNotifyImmediately(user);

    const created: UserNotificationRule = await submit(user);

    expect(created.repeatEveryMinutes).toBe(5);
    expect(created.userPushId?.toString()).toBe(OWN_IPHONE_ID);
    // The phone's level, beside it, is untouched by the repeat.
    expect(created.pushNotificationLevel).toBe(PushNotificationLevel.Critical);
  });

  test("going back to Don't repeat sends 0 and reads Don't repeat", async () => {
    /*
     * 0 is the value the form machinery most often mistakes for "nothing":
     * a dropdown draws it as no choice, and a required field holding it must
     * still count as answered.
     */
    const user: UserEvent = await renderCreateForm();

    await pickMethod(user, IPHONE_OPTION);
    await pickOption(user, repeatField()!, "Every 15 minutes");
    await pickOption(user, repeatField()!, "Don't repeat");

    expect(repeatFieldText()).toBe("Don't repeat");

    await pickNotifyImmediately(user);

    const created: UserNotificationRule = await submit(user);

    expect(created.repeatEveryMinutes).toBe(0);
  });

  test("an interval left behind when the method is changed to email is not sent", async () => {
    const user: UserEvent = await renderCreateForm();

    await pickMethod(user, BROWSER_OPTION);
    await pickOption(user, repeatField()!, "Every 5 minutes");

    await pickMethod(user, EMAIL_OPTION);

    // Gone from the form...
    expect(repeatField()).toBeNull();

    await pickNotifyImmediately(user);

    const created: UserNotificationRule = await submit(user);

    // ...and from the rule, which the server would otherwise refuse.
    expect(created.userEmailId?.toString()).toBe(OWN_EMAIL_ID);
    expect(created.userPushId).toBeUndefined();
    expect(NOT_REPEATING).toContain(created.repeatEveryMinutes);
  });

  test("an email rule is never asked, and is created without repeating", async () => {
    const user: UserEvent = await renderCreateForm();

    await pickMethod(user, EMAIL_OPTION);

    expect(repeatField()).toBeNull();

    await pickNotifyImmediately(user);

    const created: UserNotificationRule = await submit(user);

    expect(created.userEmailId?.toString()).toBe(OWN_EMAIL_ID);
    expect(NOT_REPEATING).toContain(created.repeatEveryMinutes);
  });
});
