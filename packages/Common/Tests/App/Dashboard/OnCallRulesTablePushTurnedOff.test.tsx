import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ON-CALL RULES, WHILE THE SERVER HAS PUSH TURNED OFF.
 *
 * The "Notification Method" dropdown of an on-call rule offers no push
 * device while a master admin has push turned off for the whole server:
 * nothing would be pushed to it. That holds on a person's own rules, where
 * the dropdown is built from their methods, and on an admin's view of a
 * member, where it is built from the methods readiness hands over (channel
 * "Push" left out). A choice of a push device that arrives anyway is not
 * written to the rule on the person's own page. Until the server answers,
 * and when it cannot be read, push devices are offered as they always were;
 * and the rules already pointed at a push device still name it.
 */

const PROJECT_ID_STRING: string = "c8000000-0000-4000-8000-0000000000a1";
const CURRENT_USER_ID_STRING: string = "c8000000-0000-4000-8000-0000000000b1";
const OTHER_USER_ID_STRING: string = "c8000000-0000-4000-8000-0000000000b2";
const SEVERITY_ID: string = "c8000000-0000-4000-8000-0000000000c1";
const PUSH_DEVICE_ID: string = "c8000000-0000-4000-8000-0000000000d1";
const EMAIL_ID: string = "c8000000-0000-4000-8000-0000000000d2";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
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
        return false;
      },
    },
  };
});

interface CapturedFormField {
  overrideFieldKey?: string | undefined;
  dropdownOptions?: Array<{ label: string; value: string }> | undefined;
}

interface CapturedColumn {
  title: string;
  getElement?: ((item: UserNotificationRule) => ReactElement) | undefined;
}

interface CapturedTableProps {
  onBeforeCreate: (
    model: UserNotificationRule,
    miscDataProps: Record<string, unknown>,
  ) => Promise<UserNotificationRule>;
  formFields: Array<CapturedFormField>;
  columns: Array<CapturedColumn>;
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
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(PROJECT_ID_STRING);
const currentUserId: ObjectID = new ObjectID(CURRENT_USER_ID_STRING);
const OTHER_USER_ID: ObjectID = new ObjectID(OTHER_USER_ID_STRING);

const PUSH_OPTION: { label: string; value: string } = {
  label: "Push: Pixel 8",
  value: PUSH_DEVICE_ID,
};
const EMAIL_OPTION: { label: string; value: string } = {
  label: "Email: jane@example.com",
  value: EMAIL_ID,
};

// What readiness hands an admin's view of a member: masked, by channel.
const SUPPLIED_METHODS: Array<NotificationMethodChoice> = [
  {
    methodType: "Push",
    methodId: PUSH_DEVICE_ID,
    maskedIdentifier: "Pixel 8",
    isVerified: true,
  },
  {
    methodType: "Email",
    methodId: EMAIL_ID,
    maskedIdentifier: "j•••@example.com",
    isVerified: true,
  },
];

let fetchVars: jest.SpyInstance;

function vars(disablePushNotifications: boolean): GlobalConfigVars {
  return {
    disableUserProjectCreation: false,
    disablePushNotifications: disablePushNotifications,
  };
}

function lastTable(): CapturedTableProps {
  expect(capturedTables.length).toBeGreaterThan(0);
  return capturedTables[capturedTables.length - 1]!;
}

function methodOptions(): Array<{ label: string; value: string }> {
  const field: CapturedFormField | undefined = lastTable().formFields.find(
    (candidate: CapturedFormField): boolean => {
      return candidate.overrideFieldKey === "notificationMethod";
    },
  );

  if (!field) {
    throw new Error("no notification method form field");
  }

  return field.dropdownOptions || [];
}

function ownRules(): ReactElement {
  return (
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
      userPreferencesKeyPrefix="push-turned-off-rules"
      cardDescription="What these rules are for."
    />
  );
}

function membersRules(): ReactElement {
  return (
    <OnCallRulesTable
      severityModelType={IncidentSeverity}
      severityForeignKeyColumn="incidentSeverityId"
      ruleType={NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}
      userPreferencesKeyPrefix="push-turned-off-admin-rules"
      userId={OTHER_USER_ID}
      notificationMethods={SUPPLIED_METHODS}
      cardDescription="What these rules are for."
    />
  );
}

// Drawn, with the person's methods read and the server's answer in.
async function renderAndSettle(
  element: ReactElement,
  expected: Array<{ label: string; value: string }>,
): Promise<void> {
  render(element);

  await waitFor(() => {
    expect(methodOptions()).toEqual(expected);
  });
}

beforeEach(() => {
  capturedTables = [];
  getListMock.mockReset();

  // One severity; the person's own push device and email; nothing else.
  getListMock.mockImplementation((data: { modelType: unknown }) => {
    if (data.modelType === IncidentSeverity) {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = SEVERITY_ID;
      severity.name = "Sev 1";

      return Promise.resolve({ data: [severity], count: 1, skip: 0, limit: 1 });
    }

    if (data.modelType === UserPush) {
      const device: UserPush = new UserPush();
      device._id = PUSH_DEVICE_ID;
      device.deviceName = "Pixel 8";

      return Promise.resolve({ data: [device], count: 1, skip: 0, limit: 1 });
    }

    if (data.modelType === UserEmail) {
      const email: UserEmail = new UserEmail();
      email._id = EMAIL_ID;
      email.email = new Email("jane@example.com");

      return Promise.resolve({ data: [email], count: 1, skip: 0, limit: 1 });
    }

    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  // No custom channel is on.
  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { channels: [] }, {}) as never,
    );

  fetchVars = jest
    .spyOn(GlobalConfigUtil, "fetchVars")
    .mockResolvedValue(vars(false));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a person's own on-call rules", () => {
  test("push on: their push device is offered beside their other methods", async () => {
    await renderAndSettle(ownRules(), [EMAIL_OPTION, PUSH_OPTION]);
  });

  test("push off: no push device is offered; every other method is", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(ownRules(), [EMAIL_OPTION]);
  });

  test("push off: the device is still read - only the offer is left out", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(ownRules(), [EMAIL_OPTION]);

    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === UserPush;
      }),
    ).toBe(true);
  });

  test("a read of the server's settings that fails offers push devices, as before the switch", async () => {
    fetchVars.mockRejectedValue(new Error("Network Error"));

    await renderAndSettle(ownRules(), [EMAIL_OPTION, PUSH_OPTION]);
  });

  test("push off: a push device chosen anyway is not written to the rule", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(ownRules(), [EMAIL_OPTION]);

    const created: UserNotificationRule = await lastTable().onBeforeCreate(
      new UserNotificationRule(),
      { notificationMethod: PUSH_DEVICE_ID },
    );

    expect(created.userPushId).toBeUndefined();
  });

  test("push on: choosing the push device points the rule at it", async () => {
    await renderAndSettle(ownRules(), [EMAIL_OPTION, PUSH_OPTION]);

    const created: UserNotificationRule = await lastTable().onBeforeCreate(
      new UserNotificationRule(),
      { notificationMethod: PUSH_DEVICE_ID },
    );

    expect(created.userPushId?.toString()).toBe(PUSH_DEVICE_ID);
  });

  test("push off: choosing email still points the rule at it", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(ownRules(), [EMAIL_OPTION]);

    const created: UserNotificationRule = await lastTable().onBeforeCreate(
      new UserNotificationRule(),
      { notificationMethod: EMAIL_ID },
    );

    expect(created.userEmailId?.toString()).toBe(EMAIL_ID);
    expect(created.userPushId).toBeUndefined();
  });

  test("push off: a rule already pointed at a push device still names it", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(ownRules(), [EMAIL_OPTION]);

    const column: CapturedColumn | undefined = lastTable().columns.find(
      (candidate: CapturedColumn): boolean => {
        return candidate.title === "Notification Method";
      },
    );

    const device: UserPush = new UserPush();
    device._id = PUSH_DEVICE_ID;
    device.deviceName = "Pixel 8";

    const rule: UserNotificationRule = new UserNotificationRule();
    rule._id = ObjectID.generate().toString();
    rule.userPushId = new ObjectID(PUSH_DEVICE_ID);
    rule.userPush = device;

    const { container } = render(column!.getElement!(rule));

    expect(container.textContent).toContain("Pixel 8");
  });
});

describe("an admin's view of a member's on-call rules", () => {
  test("push on: the member's push device is offered, as readiness handed it over", async () => {
    await renderAndSettle(membersRules(), [
      { label: "Push: Pixel 8", value: PUSH_DEVICE_ID },
      { label: "Email: j•••@example.com", value: EMAIL_ID },
    ]);
  });

  test("push off: methods on channel Push are left out; the rest are offered", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(membersRules(), [
      { label: "Email: j•••@example.com", value: EMAIL_ID },
    ]);
  });

  test("no member's method model is read for either answer", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderAndSettle(membersRules(), [
      { label: "Email: j•••@example.com", value: EMAIL_ID },
    ]);

    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        const modelType: unknown = (call[0] as { modelType: unknown })
          .modelType;

        return modelType === UserPush || modelType === UserEmail;
      }),
    ).toBe(false);
  });
});
