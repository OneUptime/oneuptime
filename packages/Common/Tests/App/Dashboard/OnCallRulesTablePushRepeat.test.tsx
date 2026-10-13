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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The On-Call Rules page's half of repeating a push until somebody
 * acknowledges: every push rule on every severity card says how often its
 * push is sent again, the form that adds a push rule asks, and the row
 * changes it in place - beside the push level, through the same save.
 *
 * Asserted against the real OnCallRulesTable with ModelTable replaced by a
 * stand-in that records its props - the form fields, the projection, the
 * create hook and the rendered method cell are what is under test, not the
 * pager. (OnCallRulesPushRepeatCreateForm.test.tsx draws the same fields in
 * the real form.)
 *
 * Unlike the level, which only a phone can honour, any push device repeats:
 * a page sent again to a browser still reaches somebody at their desk. So
 * on your own page a browser rule gets the repeat and not the level, and on
 * somebody else's page - where only masked methods are known - every push
 * rule gets both.
 */

const PROJECT_ID_STRING: string = "00000000-0000-4000-8000-0000000000a1";
const CURRENT_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b1";
const OTHER_USER_ID_STRING: string = "00000000-0000-4000-8000-0000000000b2";
const SEVERITY_ONE_ID: string = "00000000-0000-4000-8000-0000000000c1";

const OWN_IPHONE_ID: string = "00000000-0000-4000-8000-0000000000f1";
const OWN_ANDROID_ID: string = "00000000-0000-4000-8000-0000000000f2";
const OWN_BROWSER_ID: string = "00000000-0000-4000-8000-0000000000f3";
const OWN_EMAIL_ID: string = "00000000-0000-4000-8000-0000000000e1";
const UNVERIFIED_PHONE_ID: string = "00000000-0000-4000-8000-0000000000f9";
const NOBODYS_ID: string = "00000000-0000-4000-8000-0000000000ff";

const SUPPLIED_PUSH_ID: string = "00000000-0000-4000-8000-0000000000d4";
const SUPPLIED_SMS_ID: string = "00000000-0000-4000-8000-0000000000d1";

const RULE_ID: string = "00000000-0000-4000-8000-000000000101";

// Restated rather than imported where the words ARE the behaviour.
const DOES_NOT_REPEAT: string = "Doesn't repeat";
const CRITICAL_TITLE: string = "Critical alert";
const STANDARD_TITLE: string = "Standard";

function repeatsEvery(minutes: number): string {
  return minutes === 1
    ? "Repeats every minute"
    : `Repeats every ${minutes} minutes`;
}

function optionLabel(minutes: number): string {
  if (minutes === 0) {
    return "Don't repeat";
  }

  return minutes === 1 ? "Every minute" : `Every ${minutes} minutes`;
}

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

let isMasterAdmin: boolean = false;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
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
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      getUserId: () => {
        return currentUserId;
      },
      isMasterAdmin: () => {
        return isMasterAdmin;
      },
    },
  };
});

interface CapturedFormField {
  field?: Record<string, unknown> | undefined;
  overrideFieldKey?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  fieldType?: string | undefined;
  required?: boolean | undefined;
  doNotShowWhenEditing?: boolean | undefined;
  dropdownOptions?: Array<DropdownOption> | undefined;
  placeholder?: string | undefined;
  defaultValue?: unknown;
  getDefaultValue?: ((values: Record<string, unknown>) => unknown) | undefined;
  showIf?: ((values: Record<string, unknown>) => boolean) | undefined;
  dataTestId?: string | undefined;
}

interface CapturedColumn {
  title: string;
  field: Record<string, unknown>;
  getElement?: ((item: UserNotificationRule) => ReactElement) | undefined;
}

interface CapturedTableProps {
  formFields: Array<CapturedFormField>;
  selectMoreFields: Record<string, unknown>;
  columns: Array<CapturedColumn>;
  onBeforeCreate: (
    model: UserNotificationRule,
    miscDataProps: Record<string, unknown>,
  ) => Promise<UserNotificationRule>;
}

let capturedTables: Array<CapturedTableProps> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      capturedTables.push(props);
      return null;
    },
  };
});

import OnCallRulesTable, {
  NotificationMethodChoice,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/OnCallRulesTable";
import { PUSH_REPEAT_DROPDOWN_OPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PushRepeatControl";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Email from "../../../Types/Email";
import {
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
} from "../../../Types/NotificationRule/NotificationRepeat";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Validation from "../../../UI/Components/Forms/Validation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const currentUserId: ObjectID = new ObjectID(CURRENT_USER_ID_STRING);
const OTHER_USER_ID: ObjectID = new ObjectID(OTHER_USER_ID_STRING);

/*
 * The nine relation spellings an administrator's projection must never ask
 * for: selecting one reads the raw method row through the rule (see the essay
 * on getSuppliedMethodSelect in the component).
 */
const METHOD_RELATIONS: Array<string> = [
  "userEmail",
  "userSms",
  "userCall",
  "userPush",
  "userWhatsApp",
  "userTelegram",
  "userSlack",
  "userMicrosoftTeams",
  "userWebhook",
];

function ownDevice(data: {
  id: string;
  name: string;
  deviceType: PushDeviceType;
  isCriticalAlertEnabled: boolean;
}): UserPush {
  const device: UserPush = new UserPush();
  device._id = data.id;
  device.deviceName = data.name;
  device.deviceType = data.deviceType;
  device.isCriticalAlertEnabled = data.isCriticalAlertEnabled;
  return device;
}

// Your own devices, as the page loads them: verified ones only.
let ownDevices: Array<UserPush> = [];

function defaultOwnDevices(): Array<UserPush> {
  return [
    ownDevice({
      id: OWN_IPHONE_ID,
      name: "iPhone 17",
      deviceType: PushDeviceType.iOS,
      isCriticalAlertEnabled: true,
    }),
    ownDevice({
      id: OWN_ANDROID_ID,
      name: "Pixel 10",
      deviceType: PushDeviceType.Android,
      isCriticalAlertEnabled: false,
    }),
    ownDevice({
      id: OWN_BROWSER_ID,
      name: "Chrome on Mac",
      deviceType: PushDeviceType.Web,
      isCriticalAlertEnabled: false,
    }),
  ];
}

const SUPPLIED_METHODS: Array<NotificationMethodChoice> = [
  {
    methodType: "Push",
    methodId: SUPPLIED_PUSH_ID,
    maskedIdentifier: "Pixel •••",
    isVerified: true,
  },
  {
    methodType: "SMS",
    methodId: SUPPLIED_SMS_ID,
    maskedIdentifier: "+1 ••• ••• 4821",
    isVerified: true,
  },
];

function pushRule(data: {
  deviceId: string;
  device?: UserPush | undefined;
  level?: PushNotificationLevel | undefined;
  repeatEveryMinutes?: number | undefined;
}): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = RULE_ID;
  rule.userPushId = new ObjectID(data.deviceId);
  rule.notifyAfterMinutes = 0;

  if (data.device) {
    rule.userPush = data.device;
  }

  if (data.level) {
    rule.pushNotificationLevel = data.level;
  }

  if (data.repeatEveryMinutes !== undefined) {
    rule.repeatEveryMinutes = data.repeatEveryMinutes;
  }

  return rule;
}

function emailRule(): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = RULE_ID;
  rule.userEmailId = new ObjectID(OWN_EMAIL_ID);
  const email: UserEmail = new UserEmail();
  email._id = OWN_EMAIL_ID;
  email.email = new Email("me@example.com");
  rule.userEmail = email;
  rule.notifyAfterMinutes = 5;
  return rule;
}

function deviceById(id: string): UserPush {
  return ownDevices.find((device: UserPush): boolean => {
    return device.id?.toString() === id;
  })!;
}

async function renderOwnTable(): Promise<void> {
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
}

async function renderOtherUsersTable(
  options: { isEditable?: boolean } = {},
): Promise<void> {
  render(
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
      userPreferencesKeyPrefix="admin-notification-rules-table"
      userId={OTHER_USER_ID}
      notificationMethods={SUPPLIED_METHODS}
      onBehalfOfName="Jane Doe"
      isEditable={options.isEditable ?? true}
      cardDescription="How Jane is notified."
    />,
  );

  await waitFor(() => {
    expect(capturedTables.length).toBeGreaterThan(0);
  });
}

function lastTable(): CapturedTableProps {
  return capturedTables[capturedTables.length - 1]!;
}

// A form field's name, as the form names it.
function fieldName(field: CapturedFormField): string {
  return field.overrideFieldKey || Object.keys(field.field || {})[0]!;
}

function formField(name: string): CapturedFormField {
  const field: CapturedFormField | undefined = lastTable().formFields.find(
    (candidate: CapturedFormField): boolean => {
      return fieldName(candidate) === name;
    },
  );

  if (!field) {
    throw new Error(`no ${name} form field`);
  }

  return field;
}

function repeatField(): CapturedFormField {
  return formField("repeatEveryMinutes");
}

function isRepeatFieldShownFor(selectedValue: unknown): boolean {
  return repeatField().showIf!({ notificationMethod: selectedValue });
}

function isLevelFieldShownFor(selectedValue: unknown): boolean {
  return formField("pushNotificationLevel").showIf!({
    notificationMethod: selectedValue,
  });
}

function methodCell(rule: UserNotificationRule): HTMLElement {
  const column: CapturedColumn | undefined = lastTable().columns.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Notification Method";
    },
  );

  if (!column || !column.getElement) {
    throw new Error("no notification method column");
  }

  const { container }: { container: HTMLElement } = render(
    column.getElement(rule),
  );

  return container;
}

function inCell(container: HTMLElement, testId: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${testId}"]`);
}

function controlsIn(container: HTMLElement): HTMLElement | null {
  return inCell(container, "push-rule-controls");
}

function repeatPillIn(container: HTMLElement): HTMLElement | null {
  return inCell(container, "push-repeat-pill");
}

function levelPillIn(container: HTMLElement): HTMLElement | null {
  return inCell(container, "push-notification-level-pill");
}

// Picks an interval from the repeat pill's menu, as a pointer would.
async function chooseRepeat(minutes: number): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("push-repeat-pill"));
  });

  await act(async () => {
    fireEvent.click(
      screen.getByRole("menuitemradio", { name: optionLabel(minutes) }),
    );
  });
}

async function chooseLevel(title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("push-notification-level-pill"));
  });

  await act(async () => {
    fireEvent.click(screen.getByRole("menuitemradio", { name: title }));
  });
}

function updateRequests(): Array<any> {
  return updateByIdMock.mock.calls.map((call: Array<any>) => {
    return call[0];
  });
}

beforeEach(() => {
  capturedTables = [];
  isMasterAdmin = false;
  ownDevices = defaultOwnDevices();
  getListMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({});

  getListMock.mockImplementation((data: any) => {
    if (data.modelType === IncidentSeverity) {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ONE_ID;
      severity.name = "Sev 1";

      return Promise.resolve({ data: [severity], count: 1, skip: 0, limit: 1 });
    }

    if (data.modelType === UserPush) {
      return Promise.resolve({
        data: ownDevices,
        count: ownDevices.length,
        skip: 0,
        limit: ownDevices.length,
      });
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

describe("the form that adds a rule asks how often a push repeats", () => {
  test("comes right after how the push sounds, before the delay", async () => {
    await renderOwnTable();

    expect(lastTable().formFields.map(fieldName)).toEqual([
      "notificationMethod",
      "pushNotificationLevel",
      "repeatEveryMinutes",
      "notifyAfterMinutes",
    ]);
  });

  test("is a dropdown of the very intervals the row's menu offers", async () => {
    await renderOwnTable();

    const field: CapturedFormField = repeatField();

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    // One list, so the form and the row can never offer different intervals.
    expect(field.dropdownOptions).toBe(PUSH_REPEAT_DROPDOWN_OPTIONS);
    expect(
      (field.dropdownOptions || []).map((option: DropdownOption) => {
        return [option.value, option.label];
      }),
    ).toEqual(
      [NO_NOTIFICATION_REPEAT, ...REPEAT_EVERY_MINUTES_OPTIONS].map(
        (minutes: number) => {
          return [minutes, optionLabel(minutes)];
        },
      ),
    );
    expect(field.dataTestId).toBe("push-repeat-field");
  });

  test("says what it does, and how many times, by the worker's own limit", async () => {
    await renderOwnTable();

    expect(repeatField().title).toBe("Repeat until acknowledged");
    expect(repeatField().description).toContain("until somebody acknowledges");
    /*
     * The description spells the number out; the on-call worker stops at
     * MAX_NOTIFICATION_REPEATS. Change one and this fails until the other
     * says the same.
     */
    expect(repeatField().description).toContain(
      `up to ${MAX_NOTIFICATION_REPEATS} more times`,
    );
  });

  test("starts on Don't repeat, and reads Don't repeat while it holds it", async () => {
    /*
     * Through getDefaultValue rather than the column's default: the form
     * fills a field in with a defaultValue only when that is truthy, and 0
     * is not. The dropdown draws a 0 as no choice at all, so the placeholder
     * - the Don't repeat option's own words - is what it shows meanwhile.
     */
    await renderOwnTable();

    const field: CapturedFormField = repeatField();

    expect(field.getDefaultValue).toBeDefined();
    expect(field.getDefaultValue!({})).toBe(NO_NOTIFICATION_REPEAT);
    expect(field.placeholder).toBe(PUSH_REPEAT_DROPDOWN_OPTIONS[0]!.label);
    expect(field.placeholder).toBe("Don't repeat");
  });

  test("is required while it is shown, so it never reads as optional - an interval always applies", async () => {
    await renderOwnTable();

    expect(repeatField().required).toBe(true);
  });

  test("is not on the edit form, which cannot tell a push rule from any other", async () => {
    await renderOwnTable();

    expect(repeatField().doNotShowWhenEditing).toBe(true);
  });

  describe("validated as the form validates it", () => {
    /*
     * Through the form's own validator, with the fields named the way the
     * form names them: a required field the form hides must not stop an
     * email rule from being added, a shown one must not be left empty - and
     * Don't repeat, a 0, is an answer.
     */
    function validate(values: Record<string, unknown>): Record<string, string> {
      const fields: Array<Record<string, unknown>> = lastTable().formFields.map(
        (field: CapturedFormField): Record<string, unknown> => {
          return { ...field, name: fieldName(field) };
        },
      );

      return Validation.validate({
        formFields: fields as never,
        values: values as never,
        onValidate: undefined,
      }) as Record<string, string>;
    }

    test("an email rule is not held up by the hidden repeat field", async () => {
      await renderOwnTable();

      expect(
        validate({ notificationMethod: OWN_EMAIL_ID, notifyAfterMinutes: 0 })[
          "repeatEveryMinutes"
        ],
      ).toBeUndefined();
    });

    test("a push rule left on Don't repeat passes - 0 is an answer, not an empty field", async () => {
      await renderOwnTable();

      expect(
        validate({
          notificationMethod: OWN_BROWSER_ID,
          repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
          notifyAfterMinutes: 0,
        })["repeatEveryMinutes"],
      ).toBeUndefined();
    });

    test("a phone rule with an interval passes", async () => {
      await renderOwnTable();

      const errors: Record<string, string> = validate({
        notificationMethod: OWN_IPHONE_ID,
        pushNotificationLevel: PushNotificationLevel.Critical,
        repeatEveryMinutes: 5,
        notifyAfterMinutes: 0,
      });

      expect(errors["repeatEveryMinutes"]).toBeUndefined();
      expect(errors).toEqual({});
    });

    test.each([
      ["cleared", null],
      ["emptied", ""],
    ])(
      "a push rule whose repeat was %s is asked for one",
      async (_label: string, value: unknown) => {
        await renderOwnTable();

        expect(
          validate({
            notificationMethod: OWN_BROWSER_ID,
            repeatEveryMinutes: value,
            notifyAfterMinutes: 0,
          })["repeatEveryMinutes"],
        ).toContain("required");
      },
    );
  });

  describe("on your own page", () => {
    test.each([
      ["an iPhone", OWN_IPHONE_ID],
      ["an Android phone", OWN_ANDROID_ID],
      ["a browser", OWN_BROWSER_ID],
    ])("is shown once %s is picked", async (_label: string, id: string) => {
      await renderOwnTable();

      expect(isRepeatFieldShownFor(id)).toBe(true);
    });

    test("is shown when the dropdown hands over an ObjectID rather than a string", async () => {
      await renderOwnTable();

      expect(isRepeatFieldShownFor(new ObjectID(OWN_BROWSER_ID))).toBe(true);
    });

    test("a browser is asked how often to repeat, though not how loud", async () => {
      await renderOwnTable();

      expect(isRepeatFieldShownFor(OWN_BROWSER_ID)).toBe(true);
      expect(isLevelFieldShownFor(OWN_BROWSER_ID)).toBe(false);
    });

    test.each([
      ["an email address", OWN_EMAIL_ID],
      ["nothing picked yet", undefined],
      ["an empty pick", ""],
      ["an id nobody has", NOBODYS_ID],
    ])("is not shown for %s", async (_label: string, value: unknown) => {
      await renderOwnTable();

      expect(isRepeatFieldShownFor(value)).toBe(false);
    });
  });

  describe("on somebody else's page", () => {
    test("is shown for any of their push methods", async () => {
      await renderOtherUsersTable();

      expect(isRepeatFieldShownFor(SUPPLIED_PUSH_ID)).toBe(true);
    });

    test("is not shown for their other methods", async () => {
      await renderOtherUsersTable();

      expect(isRepeatFieldShownFor(SUPPLIED_SMS_ID)).toBe(false);
      expect(isRepeatFieldShownFor(undefined)).toBe(false);
    });
  });

  describe("the rule it creates", () => {
    test("a new push rule keeps the interval the form wrote, beside the device it pages", async () => {
      await renderOwnTable();

      const model: UserNotificationRule = new UserNotificationRule();
      model.repeatEveryMinutes = 5;

      const created: UserNotificationRule = await lastTable().onBeforeCreate(
        model,
        { notificationMethod: OWN_BROWSER_ID },
      );

      expect(created.repeatEveryMinutes).toBe(5);
      expect(created.userPushId?.toString()).toBe(OWN_BROWSER_ID);
    });

    test("a phone rule keeps its level and its interval side by side", async () => {
      await renderOwnTable();

      const model: UserNotificationRule = new UserNotificationRule();
      model.pushNotificationLevel = PushNotificationLevel.Standard;
      model.repeatEveryMinutes = 2;

      const created: UserNotificationRule = await lastTable().onBeforeCreate(
        model,
        { notificationMethod: OWN_ANDROID_ID },
      );

      expect(created.pushNotificationLevel).toBe(
        PushNotificationLevel.Standard,
      );
      expect(created.repeatEveryMinutes).toBe(2);
      expect(created.userPushId?.toString()).toBe(OWN_ANDROID_ID);
    });

    test.each([
      ["an email address", OWN_EMAIL_ID],
      ["nothing at all", undefined],
      ["an id nobody has", NOBODYS_ID],
    ])(
      "an interval left behind is not sent with a rule that pages %s",
      async (_label: string, notificationMethod: unknown) => {
        /*
         * The form sends a hidden field's value too, so an interval picked
         * for a push device survives the method being changed - and the
         * server refuses a repeating rule that pages anything but a push
         * device, in words about a field the form no longer shows.
         */
        await renderOwnTable();

        const model: UserNotificationRule = new UserNotificationRule();
        model.repeatEveryMinutes = 5;

        const created: UserNotificationRule = await lastTable().onBeforeCreate(
          model,
          { notificationMethod: notificationMethod },
        );

        expect(created.repeatEveryMinutes).toBe(NO_NOTIFICATION_REPEAT);
        expect(created.userPushId).toBeUndefined();
      },
    );

    test("a new rule to a member's push method keeps its interval", async () => {
      await renderOtherUsersTable();

      const model: UserNotificationRule = new UserNotificationRule();
      model.repeatEveryMinutes = 10;

      const created: UserNotificationRule = await lastTable().onBeforeCreate(
        model,
        { notificationMethod: SUPPLIED_PUSH_ID },
      );

      expect(created.repeatEveryMinutes).toBe(10);
      expect(created.userPushId?.toString()).toBe(SUPPLIED_PUSH_ID);
    });

    test("a new rule to a member's phone number does not repeat, whatever was left behind", async () => {
      await renderOtherUsersTable();

      const model: UserNotificationRule = new UserNotificationRule();
      model.repeatEveryMinutes = 10;

      const created: UserNotificationRule = await lastTable().onBeforeCreate(
        model,
        { notificationMethod: SUPPLIED_SMS_ID },
      );

      expect(created.repeatEveryMinutes).toBe(NO_NOTIFICATION_REPEAT);
      expect(created.userSmsId?.toString()).toBe(SUPPLIED_SMS_ID);
    });
  });
});

describe("what the table asks the server for", () => {
  test("your own page reads each rule's interval, beside its level and device", async () => {
    await renderOwnTable();

    expect(lastTable().selectMoreFields["repeatEveryMinutes"]).toBe(true);
    expect(lastTable().selectMoreFields["pushNotificationLevel"]).toBe(true);
    expect(lastTable().selectMoreFields["userPushId"]).toBe(true);
  });

  test("somebody else's page reads the interval and still no method row", async () => {
    await renderOtherUsersTable();

    const projection: Array<string> = Object.keys(lastTable().selectMoreFields);

    for (const column of lastTable().columns) {
      projection.push(...Object.keys(column.field || {}));
    }

    expect(projection).toContain("repeatEveryMinutes");

    for (const relation of METHOD_RELATIONS) {
      expect(projection).not.toContain(relation);
    }

    expect(
      getListMock.mock.calls.map((call: Array<any>) => {
        return call[0].modelType;
      }),
    ).not.toContain(UserPush);
  });
});

describe("each push rule's row on your own page", () => {
  test("a phone rule says how it sounds and how often it repeats, side by side under the phone", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Standard,
        repeatEveryMinutes: 5,
      }),
    );

    const controls: HTMLElement = controlsIn(cell)!;

    expect(controls).not.toBeNull();
    // How it sounds first, then how often - in one row that wraps.
    expect(
      Array.from(controls.children).map((child: Element): string | null => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual(["push-notification-level", "push-repeat"]);
    expect(levelPillIn(controls)).toHaveTextContent(STANDARD_TITLE);
    expect(repeatPillIn(controls)!.textContent).toBe(repeatsEvery(5));

    // Under the phone's name, which still reads first.
    const cellText: string = cell.textContent || "";

    expect(cellText).toContain("iPhone 17");
    expect(cellText.indexOf("iPhone 17")).toBeLessThan(
      cellText.indexOf(repeatsEvery(5)),
    );
  });

  test("the row spaces the controls once - the level no longer adds a margin of its own", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({ deviceId: OWN_IPHONE_ID, device: deviceById(OWN_IPHONE_ID) }),
    );

    const controls: HTMLElement = controlsIn(cell)!;

    expect(controls).toHaveClass("mt-1.5", "flex", "flex-wrap");
    expect(inCell(cell, "push-notification-level")).not.toHaveClass("mt-1.5");
    expect(inCell(cell, "push-repeat")).not.toHaveClass("mt-1.5");
  });

  test("a rule that never chose an interval does not repeat, which is how it pages", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({ deviceId: OWN_IPHONE_ID, device: deviceById(OWN_IPHONE_ID) }),
    );

    expect(repeatPillIn(cell)!.textContent).toBe(DOES_NOT_REPEAT);
    // And the level beside it still reads its own default.
    expect(levelPillIn(cell)).toHaveTextContent(CRITICAL_TITLE);
  });

  test("an interval this build does not offer reads as not repeating", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        repeatEveryMinutes: 7,
      }),
    );

    expect(repeatPillIn(cell)!.textContent).toBe(DOES_NOT_REPEAT);
  });

  test("a browser push rule repeats, but has no level", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_BROWSER_ID,
        device: deviceById(OWN_BROWSER_ID),
        repeatEveryMinutes: 1,
      }),
    );

    expect(cell).toHaveTextContent("Chrome on Mac");
    expect(levelPillIn(cell)).toBeNull();
    expect(
      Array.from(controlsIn(cell)!.children).map(
        (child: Element): string | null => {
          return child.getAttribute("data-testid");
        },
      ),
    ).toEqual(["push-repeat"]);
    expect(repeatPillIn(cell)!.textContent).toBe(repeatsEvery(1));
  });

  test("a rule to a phone that is no longer verified still shows both, without guessing at the phone", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: UNVERIFIED_PHONE_ID,
        level: PushNotificationLevel.Standard,
        repeatEveryMinutes: 30,
      }),
    );

    expect(levelPillIn(cell)).toHaveTextContent(STANDARD_TITLE);
    expect(repeatPillIn(cell)!.textContent).toBe(repeatsEvery(30));
    expect(inCell(cell, "push-notification-level-device-hint")).toBeNull();
  });

  test("an email rule has neither control", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(emailRule());

    expect(cell).toHaveTextContent("me@example.com");
    expect(controlsIn(cell)).toBeNull();
    expect(inCell(cell, "push-repeat")).toBeNull();
    expect(levelPillIn(cell)).toBeNull();
  });

  test("a muted rule has neither - it pages nothing, even with a stale push id", async () => {
    await renderOwnTable();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = RULE_ID;
    rule.isOptOut = true;
    rule.userPushId = new ObjectID(OWN_IPHONE_ID);
    rule.repeatEveryMinutes = 5;

    const cell: HTMLElement = methodCell(rule);

    expect(cell).toHaveTextContent("Muted");
    expect(controlsIn(cell)).toBeNull();
    expect(inCell(cell, "push-repeat")).toBeNull();
  });
});

describe("somebody else's push rules", () => {
  test("show both controls, read from the rule alone, with nothing said about the device", async () => {
    await renderOtherUsersTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: SUPPLIED_PUSH_ID,
        level: PushNotificationLevel.Standard,
        repeatEveryMinutes: 15,
      }),
    );

    expect(cell).toHaveTextContent("Push: Pixel •••");
    expect(levelPillIn(cell)).toHaveTextContent(STANDARD_TITLE);
    expect(repeatPillIn(cell)!.textContent).toBe(repeatsEvery(15));
    expect(inCell(cell, "push-notification-level-device-hint")).toBeNull();
  });

  test("their other rules have neither control", async () => {
    await renderOtherUsersTable();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = RULE_ID;
    rule.userSmsId = new ObjectID(SUPPLIED_SMS_ID);

    const cell: HTMLElement = methodCell(rule);

    expect(cell).toHaveTextContent("SMS: +1 ••• ••• 4821");
    expect(controlsIn(cell)).toBeNull();
  });
});

describe("changing a push rule's repeat from its row", () => {
  test("somebody who may change rules gets the menu", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({ deviceId: OWN_IPHONE_ID, device: deviceById(OWN_IPHONE_ID) }),
    );

    expect(repeatPillIn(cell)!.tagName).toBe("BUTTON");
    expect(repeatPillIn(cell)).toHaveAttribute("aria-haspopup", "menu");
  });

  test("somebody whose permissions have not been confirmed gets read-only pills - both of them", async () => {
    /*
     * The same gate the row editor, the Delete action and the level use:
     * until the permission snapshot says otherwise, no control is offered
     * that the server might refuse.
     */
    isMasterAdmin = false;
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        repeatEveryMinutes: 5,
      }),
    );

    expect(repeatPillIn(cell)!.tagName).toBe("SPAN");
    expect(levelPillIn(cell)!.tagName).toBe("SPAN");
    // Still said, just not changeable.
    expect(repeatPillIn(cell)!.textContent).toBe(repeatsEvery(5));
  });

  test("a table that is not editable never offers either menu", async () => {
    isMasterAdmin = true;
    await renderOtherUsersTable({ isEditable: false });

    const cell: HTMLElement = methodCell(
      pushRule({ deviceId: SUPPLIED_PUSH_ID, repeatEveryMinutes: 2 }),
    );

    expect(repeatPillIn(cell)!.tagName).toBe("SPAN");
    expect(levelPillIn(cell)!.tagName).toBe("SPAN");
    expect(within(controlsIn(cell)!).queryByRole("button")).toBeNull();
  });

  test("picking an interval saves just the interval, on that rule - the level is left alone", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Standard,
      }),
    );

    await chooseRepeat(5);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: any = updateRequests()[0];

    expect(request.modelType).toBe(UserNotificationRule);
    expect(request.id.toString()).toBe(RULE_ID);
    expect(request.data).toEqual({ repeatEveryMinutes: 5 });
    expect(Object.keys(request.data)).not.toContain("pushNotificationLevel");

    expect(screen.getByTestId("push-repeat-pill").textContent).toBe(
      repeatsEvery(5),
    );
    expect(
      screen.getByTestId("push-notification-level-pill"),
    ).toHaveTextContent(STANDARD_TITLE);
  });

  test("picking Don't repeat saves 0 - turning repeating off reaches the server", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        repeatEveryMinutes: 1,
      }),
    );

    await chooseRepeat(NO_NOTIFICATION_REPEAT);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateRequests()[0].data).toEqual({
      repeatEveryMinutes: NO_NOTIFICATION_REPEAT,
    });
    expect(screen.getByTestId("push-repeat-pill").textContent).toBe(
      DOES_NOT_REPEAT,
    );
  });

  test("a browser rule's interval is saved the same way", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_BROWSER_ID,
        device: deviceById(OWN_BROWSER_ID),
      }),
    );

    await chooseRepeat(2);

    expect(updateRequests()).toHaveLength(1);
    expect(updateRequests()[0].id.toString()).toBe(RULE_ID);
    expect(updateRequests()[0].data).toEqual({ repeatEveryMinutes: 2 });
  });

  test("the level and the interval are saved apart, each with only its own field", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    await chooseRepeat(10);
    await chooseLevel(STANDARD_TITLE);

    expect(
      updateRequests().map((request: any) => {
        return [request.id.toString(), request.data];
      }),
    ).toEqual([
      [RULE_ID, { repeatEveryMinutes: 10 }],
      [RULE_ID, { pushNotificationLevel: PushNotificationLevel.Standard }],
    ]);

    // Neither undid the other on screen.
    expect(screen.getByTestId("push-repeat-pill").textContent).toBe(
      repeatsEvery(10),
    );
    expect(
      screen.getByTestId("push-notification-level-pill"),
    ).toHaveTextContent(STANDARD_TITLE);
  });

  test("a level still saving does not hold up the interval beside it", async () => {
    isMasterAdmin = true;

    let finishLevelSave: () => void = (): void => {
      return undefined;
    };

    updateByIdMock.mockReset();
    updateByIdMock
      .mockReturnValueOnce(
        new Promise<void>((resolve: () => void) => {
          finishLevelSave = resolve;
        }),
      )
      .mockResolvedValue({});

    await renderOwnTable();

    methodCell(
      pushRule({ deviceId: OWN_IPHONE_ID, device: deviceById(OWN_IPHONE_ID) }),
    );

    await chooseLevel(STANDARD_TITLE);

    expect(screen.getByTestId("push-notification-level-pill")).toBeDisabled();
    expect(screen.getByTestId("push-repeat-pill")).not.toBeDisabled();

    await chooseRepeat(3);

    expect(updateRequests()[1].data).toEqual({ repeatEveryMinutes: 3 });

    await act(async () => {
      finishLevelSave();
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(2);
  });

  test("an administrator changes a member's interval the same way", async () => {
    isMasterAdmin = true;
    await renderOtherUsersTable();

    methodCell(pushRule({ deviceId: SUPPLIED_PUSH_ID, repeatEveryMinutes: 5 }));

    await chooseRepeat(15);

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(updateRequests()[0].modelType).toBe(UserNotificationRule);
    expect(updateRequests()[0].id.toString()).toBe(RULE_ID);
    expect(updateRequests()[0].data).toEqual({ repeatEveryMinutes: 15 });
  });

  test("a refused save puts the stored interval back and says why - under the repeat, not the level", async () => {
    isMasterAdmin = true;
    updateByIdMock.mockRejectedValue(
      new Error("Only push notification rules can repeat until acknowledged."),
    );

    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        repeatEveryMinutes: 5,
      }),
    );

    await chooseRepeat(1);

    expect(screen.getByTestId("push-repeat-pill").textContent).toBe(
      repeatsEvery(5),
    );
    expect(screen.getByTestId("push-repeat-error")).toHaveTextContent(
      "Only push notification rules can repeat until acknowledged.",
    );
    expect(screen.queryByTestId("push-notification-level-error")).toBeNull();
  });

  test("a row with no id cannot be saved, and says so instead of failing silently", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    const rule: UserNotificationRule = pushRule({
      deviceId: OWN_BROWSER_ID,
      device: deviceById(OWN_BROWSER_ID),
    });
    rule._id = undefined as unknown as string;

    methodCell(rule);

    await chooseRepeat(5);

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("push-repeat-error")).toHaveTextContent(
      "reloaded",
    );
    expect(screen.getByTestId("push-repeat-pill").textContent).toBe(
      DOES_NOT_REPEAT,
    );
  });
});
