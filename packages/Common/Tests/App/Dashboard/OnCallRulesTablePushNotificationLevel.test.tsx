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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The On-Call Rules page's half of the push notification level: every push
 * rule on every severity card says whether it rings through silent mode
 * (Critical) or follows the phone's settings (Standard), the form that adds a
 * push rule asks, and the row changes it in place.
 *
 * Asserted against the real OnCallRulesTable with ModelTable replaced by a
 * stand-in that records its props - the form fields, the projection and the
 * rendered method cell are what is under test, not the pager.
 *
 * Two audiences, as everywhere on this page:
 *
 *   - your own rules: your devices are loaded, so the page knows which phone
 *     a rule pages, whether it is a phone at all (a browser has no level),
 *     and whether that phone has turned critical alerts on;
 *   - somebody else's rules (an administrator): only masked methods are known,
 *     so every push method gets the level and none gets a device note - and
 *     no method model is read to find out more.
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

const SUPPLIED_PUSH_ID: string = "00000000-0000-4000-8000-0000000000d4";
const SUPPLIED_SMS_ID: string = "00000000-0000-4000-8000-0000000000d1";

const RULE_ID: string = "00000000-0000-4000-8000-000000000101";

const CRITICAL_TITLE: string = "Critical alert";
const STANDARD_TITLE: string = "Standard";

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
  cardSelectSingleColumn?: boolean | undefined;
  cardSelectOptions?:
    | Array<{ value: string; title: string; description: string }>
    | undefined;
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
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import PushNotificationLevel from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
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
  level?: PushNotificationLevel | undefined;
  device?: UserPush | undefined;
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

function levelField(): CapturedFormField {
  const field: CapturedFormField | undefined = lastTable().formFields.find(
    (candidate: CapturedFormField): boolean => {
      return Boolean(
        candidate.field && "pushNotificationLevel" in candidate.field,
      );
    },
  );

  if (!field) {
    throw new Error("no push notification level form field");
  }

  return field;
}

function isLevelFieldShownFor(selectedValue: unknown): boolean {
  return levelField().showIf!({ notificationMethod: selectedValue });
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

function pillIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="push-notification-level-pill"]',
  );
}

function hintIn(container: HTMLElement): HTMLElement | null {
  return container.querySelector(
    '[data-testid="push-notification-level-device-hint"]',
  );
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

describe("the form that adds a rule asks how a push should sound", () => {
  test("offers the level as a card per level, right after the method", async () => {
    await renderOwnTable();

    const keys: Array<string> = lastTable().formFields.map(
      (field: CapturedFormField): string => {
        return field.overrideFieldKey || Object.keys(field.field || {})[0]!;
      },
    );

    expect(keys).toEqual([
      "notificationMethod",
      "pushNotificationLevel",
      "notifyAfterMinutes",
    ]);

    const field: CapturedFormField = levelField();

    expect(field.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(field.cardSelectSingleColumn).toBe(true);
    expect(
      (field.cardSelectOptions || []).map(
        (option: { value: string; title: string }) => {
          return [option.value, option.title];
        },
      ),
    ).toEqual([
      [PushNotificationLevel.Critical, CRITICAL_TITLE],
      [PushNotificationLevel.Standard, STANDARD_TITLE],
    ]);
    expect(field.dataTestId).toBe("push-notification-level-field");
  });

  test("says the phone has to turn critical alerts on too", async () => {
    await renderOwnTable();

    expect(levelField().title).toBe("Push notification");
    expect(levelField().description).toContain("Critical On-Call Alerts");
    expect(levelField().description).toContain("OneUptime On-Call app");
  });

  test("is not required - left alone it is the column's default, Critical", async () => {
    await renderOwnTable();

    expect(levelField().required).toBe(false);
  });

  test("is not on the edit form, which cannot tell a push rule from any other", async () => {
    await renderOwnTable();

    expect(levelField().doNotShowWhenEditing).toBe(true);
  });

  describe("on your own page", () => {
    test.each([
      ["an iPhone", OWN_IPHONE_ID],
      ["an Android phone", OWN_ANDROID_ID],
    ])("is shown once %s is picked", async (_label: string, id: string) => {
      await renderOwnTable();

      expect(isLevelFieldShownFor(id)).toBe(true);
    });

    test("is shown when the dropdown hands over an ObjectID rather than a string", async () => {
      await renderOwnTable();

      expect(isLevelFieldShownFor(new ObjectID(OWN_IPHONE_ID))).toBe(true);
    });

    test("is not shown for a browser - no browser rings through silent mode", async () => {
      await renderOwnTable();

      expect(isLevelFieldShownFor(OWN_BROWSER_ID)).toBe(false);
    });

    test.each([
      ["an email address", OWN_EMAIL_ID],
      ["nothing picked yet", undefined],
      ["an empty pick", ""],
      ["an id nobody has", "00000000-0000-4000-8000-0000000000ff"],
    ])("is not shown for %s", async (_label: string, value: unknown) => {
      await renderOwnTable();

      expect(isLevelFieldShownFor(value)).toBe(false);
    });
  });

  describe("on somebody else's page", () => {
    test("is shown for any of their push methods - their device type is not known", async () => {
      await renderOtherUsersTable();

      expect(isLevelFieldShownFor(SUPPLIED_PUSH_ID)).toBe(true);
    });

    test("is not shown for their other methods", async () => {
      await renderOtherUsersTable();

      expect(isLevelFieldShownFor(SUPPLIED_SMS_ID)).toBe(false);
      expect(isLevelFieldShownFor(undefined)).toBe(false);
    });
  });

  test("a new push rule keeps the level the form wrote, beside the phone it pages", async () => {
    await renderOwnTable();

    const model: UserNotificationRule = new UserNotificationRule();
    model.pushNotificationLevel = PushNotificationLevel.Standard;

    const created: UserNotificationRule = await lastTable().onBeforeCreate(
      model,
      { notificationMethod: OWN_ANDROID_ID },
    );

    expect(created.pushNotificationLevel).toBe(PushNotificationLevel.Standard);
    expect(created.userPushId?.toString()).toBe(OWN_ANDROID_ID);
  });
});

describe("what the table asks the server for", () => {
  test("your own page reads each rule's level and the phone it pages", async () => {
    await renderOwnTable();

    expect(lastTable().selectMoreFields["pushNotificationLevel"]).toBe(true);
    expect(lastTable().selectMoreFields["userPushId"]).toBe(true);
    // Still beside the opt-out flag the cell already relied on.
    expect(lastTable().selectMoreFields["isOptOut"]).toBe(true);
  });

  test("your own devices are read with their critical alerts switch, still only your verified ones", async () => {
    await renderOwnTable();

    const pushRequest: any = getListMock.mock.calls
      .map((call: Array<any>) => {
        return call[0];
      })
      .find((request: any) => {
        return request.modelType === UserPush;
      });

    expect(pushRequest).toBeDefined();
    expect(pushRequest.select).toEqual({
      deviceName: true,
      deviceType: true,
      isCriticalAlertEnabled: true,
    });
    expect(pushRequest.query.isVerified).toBe(true);
    expect(pushRequest.query.userId?.toString()).toBe(CURRENT_USER_ID_STRING);
  });

  test("somebody else's page reads the level and still no method row", async () => {
    await renderOtherUsersTable();

    const projection: Array<string> = Object.keys(lastTable().selectMoreFields);

    for (const column of lastTable().columns) {
      projection.push(...Object.keys(column.field || {}));
    }

    expect(projection).toContain("pushNotificationLevel");
    expect(projection).toContain("userPushId");

    for (const relation of METHOD_RELATIONS) {
      expect(projection).not.toContain(relation);
    }

    // And no method model is read to label or describe their devices.
    expect(
      getListMock.mock.calls.map((call: Array<any>) => {
        return call[0].modelType;
      }),
    ).not.toContain(UserPush);
  });
});

describe("each push rule's row on your own page", () => {
  test("names the phone and how it will sound", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Standard,
      }),
    );

    expect(cell).toHaveTextContent("iPhone 17");
    expect(pillIn(cell)).toHaveTextContent(STANDARD_TITLE);
  });

  test("a rule that never chose reads Critical, which is how it pages", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
      }),
    );

    expect(pillIn(cell)).toHaveTextContent(CRITICAL_TITLE);
  });

  test("a Critical rule to a phone with critical alerts off says it will not ring through yet", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_ANDROID_ID,
        device: deviceById(OWN_ANDROID_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    expect(pillIn(cell)).toHaveTextContent(CRITICAL_TITLE);
    expect(hintIn(cell)).not.toBeNull();
    expect(hintIn(cell)).toHaveTextContent("Critical On-Call Alerts");
  });

  test("a Critical rule to a phone that opted in carries no note", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    expect(hintIn(cell)).toBeNull();
  });

  test("a browser push rule has no level at all", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_BROWSER_ID,
        device: deviceById(OWN_BROWSER_ID),
      }),
    );

    expect(cell).toHaveTextContent("Chrome on Mac");
    expect(pillIn(cell)).toBeNull();
  });

  test("a rule to a phone that is no longer verified still shows its level, without guessing at the phone", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: UNVERIFIED_PHONE_ID,
        level: PushNotificationLevel.Standard,
      }),
    );

    expect(pillIn(cell)).toHaveTextContent(STANDARD_TITLE);
    expect(hintIn(cell)).toBeNull();
  });

  test("an email rule has no level", async () => {
    await renderOwnTable();

    const cell: HTMLElement = methodCell(emailRule());

    expect(cell).toHaveTextContent("me@example.com");
    expect(pillIn(cell)).toBeNull();
  });

  test("a muted rule has no level - it pages nothing", async () => {
    await renderOwnTable();

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = RULE_ID;
    rule.isOptOut = true;
    // Even carrying a stale phone id, an opt-out row is not a push rule.
    rule.userPushId = new ObjectID(OWN_IPHONE_ID);

    const cell: HTMLElement = methodCell(rule);

    expect(cell).toHaveTextContent("Muted");
    expect(pillIn(cell)).toBeNull();
  });
});

describe("changing a push rule's level from its row", () => {
  test("somebody who may change rules gets the menu", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    expect(pillIn(cell)!.tagName).toBe("BUTTON");
    expect(pillIn(cell)).toHaveAttribute("aria-haspopup", "menu");
  });

  test("somebody whose permissions have not been confirmed gets a read-only pill", async () => {
    /*
     * The same gate the row editor and the Delete action use: until the
     * permission snapshot says otherwise, no control is offered that the
     * server might refuse.
     */
    isMasterAdmin = false;
    await renderOwnTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
      }),
    );

    expect(pillIn(cell)!.tagName).toBe("SPAN");
  });

  test("a table that is not editable never offers the menu", async () => {
    isMasterAdmin = true;
    await renderOtherUsersTable({ isEditable: false });

    const cell: HTMLElement = methodCell(
      pushRule({ deviceId: SUPPLIED_PUSH_ID }),
    );

    expect(pillIn(cell)!.tagName).toBe("SPAN");
  });

  test("picking Standard saves just the level, on that rule", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("push-notification-level-pill"));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: STANDARD_TITLE }),
      );
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const request: any = updateByIdMock.mock.calls[0]![0];

    expect(request.modelType).toBe(UserNotificationRule);
    expect(request.id.toString()).toBe(RULE_ID);
    expect(request.data).toEqual({
      pushNotificationLevel: PushNotificationLevel.Standard,
    });
    expect(
      screen.getByTestId("push-notification-level-pill"),
    ).toHaveTextContent(STANDARD_TITLE);
  });

  test("an administrator changes a member's level the same way", async () => {
    isMasterAdmin = true;
    await renderOtherUsersTable();

    const cell: HTMLElement = methodCell(
      pushRule({
        deviceId: SUPPLIED_PUSH_ID,
        level: PushNotificationLevel.Standard,
      }),
    );

    // Their phone cannot be read, so the row says nothing about it.
    expect(hintIn(cell)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("push-notification-level-pill"));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: CRITICAL_TITLE }),
      );
    });

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect((updateByIdMock.mock.calls[0]![0] as any).data).toEqual({
      pushNotificationLevel: PushNotificationLevel.Critical,
    });
  });

  test("a refused save puts the stored level back and says why", async () => {
    isMasterAdmin = true;
    updateByIdMock.mockRejectedValue(
      new Error("Push notification level must be one of: Critical, Standard."),
    );

    await renderOwnTable();

    methodCell(
      pushRule({
        deviceId: OWN_IPHONE_ID,
        device: deviceById(OWN_IPHONE_ID),
        level: PushNotificationLevel.Critical,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("push-notification-level-pill"));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: STANDARD_TITLE }),
      );
    });

    expect(
      screen.getByTestId("push-notification-level-pill"),
    ).toHaveTextContent(CRITICAL_TITLE);
    expect(
      screen.getByTestId("push-notification-level-error"),
    ).toHaveTextContent(
      "Push notification level must be one of: Critical, Standard.",
    );
  });

  test("a row with no id cannot be saved, and says so instead of failing silently", async () => {
    isMasterAdmin = true;
    await renderOwnTable();

    const rule: UserNotificationRule = pushRule({
      deviceId: OWN_IPHONE_ID,
      device: deviceById(OWN_IPHONE_ID),
    });
    rule._id = undefined as unknown as string;

    methodCell(rule);

    await act(async () => {
      fireEvent.click(screen.getByTestId("push-notification-level-pill"));
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemradio", { name: STANDARD_TITLE }),
      );
    });

    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("push-notification-level-error"),
    ).toHaveTextContent("reloaded");
    expect(
      screen.getByTestId("push-notification-level-pill"),
    ).toHaveTextContent(CRITICAL_TITLE);
  });
});
