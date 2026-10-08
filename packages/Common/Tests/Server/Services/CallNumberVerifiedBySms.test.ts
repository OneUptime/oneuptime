import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import CallService from "../../../Server/Services/CallService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

/*
 * "DOES VERIFYING VIA SMS ALSO VERIFY FOR CALL NOTIFICATION, AND VICE VERSA?"
 *
 * It does now, one way. Typing back a code texted to a number proves the
 * number is the person's, and a phone that takes texts takes calls - so a
 * number verified for SMS is verified for calls without a robot reading
 * digits down the line. Not the other way round: a call proves only that a
 * number rings, and a landline rings without ever showing a text.
 *
 * And only for the person's own adds, in the same project. A number an
 * administrator adds for somebody still needs that person's own code: an
 * administrator can type a number in, but never make it live.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000009",
);
const OWNER_ID: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000002");
const ADMIN_ID: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000003");
const CALL_ITEM_ID: ObjectID = new ObjectID(
  "9f000000-0000-4000-8000-000000000004",
);

const SENT: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  {},
  {},
);

function callNumber(values: {
  id?: ObjectID;
  phone?: string;
  createdByUserId?: ObjectID | undefined;
}): UserCall {
  const row: UserCall = new UserCall();
  row.id = values.id || CALL_ITEM_ID;
  row.projectId = PROJECT_ID;
  row.userId = OWNER_ID;
  row.phone = new Phone(values.phone || "+15551230100");
  row.isVerified = false;

  if (values.createdByUserId) {
    row.createdByUserId = values.createdByUserId;
  }

  return row;
}

function smsNumber(phone: string): UserSMS {
  const row: UserSMS = new UserSMS();
  row.phone = new Phone(phone);
  return row;
}

function addedBy(userId: ObjectID | undefined): OnCreate<UserCall> {
  return {
    createBy: {
      data: {} as UserCall,
      props: userId ? { userId: userId, tenantId: PROJECT_ID } : { isRoot: true },
    },
    carryForward: null,
  } as unknown as OnCreate<UserCall>;
}

type OnCreateSuccess = (
  onCreate: OnCreate<UserCall>,
  item: UserCall,
) => Promise<UserCall>;

const onCreateSuccess: OnCreateSuccess = (
  onCreate: OnCreate<UserCall>,
  item: UserCall,
): Promise<UserCall> => {
  return (
    UserCallService as unknown as { onCreateSuccess: OnCreateSuccess }
  ).onCreateSuccess(onCreate, item);
};

let smsFindBy: jest.SpyInstance;
let callUpdate: jest.SpyInstance;
let makeCall: jest.SpyInstance;
let addDefaultRules: jest.SpyInstance;

beforeEach(() => {
  smsFindBy = getJestSpyOn(UserSmsService, "findBy").mockResolvedValue([]);
  callUpdate = getJestSpyOn(UserCallService, "updateOneById").mockResolvedValue(
    1,
  );
  getJestSpyOn(UserCallService, "deleteOneById").mockResolvedValue(1);
  makeCall = getJestSpyOn(CallService, "makeCall").mockResolvedValue(SENT);
  addDefaultRules = getJestSpyOn(
    UserNotificationRuleService,
    "addDefaultNotificationRulesForVerifiedMethod",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
  ).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isNumberVerifiedForSms", () => {
  test("a number the person verified for SMS, added by them for calls, is proven", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);

    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({}),
        addedByUserId: OWNER_ID,
      }),
    ).toBe(true);
  });

  test("however either was typed", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+155-512-30100")]);

    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({ phone: "+15551230100" }),
        addedByUserId: OWNER_ID,
      }),
    ).toBe(true);
  });

  test("asks only for the person's own verified SMS numbers, in this project, as OneUptime", async () => {
    await UserCallService.isNumberVerifiedForSms({
      item: callNumber({}),
      addedByUserId: OWNER_ID,
    });

    const query: {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
    } = smsFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
    };

    expect(String(query.query["userId"])).toBe(OWNER_ID.toString());
    expect(String(query.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query.query["isVerified"]).toBe(true);
    expect(query.props.isRoot).toBe(true);
  });

  test("a different number is not proven by it", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230199")]);

    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({}),
        addedByUserId: OWNER_ID,
      }),
    ).toBe(false);
  });

  test("a number with no verified SMS number at all is not proven", async () => {
    smsFindBy.mockResolvedValue([]);

    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({}),
        addedByUserId: OWNER_ID,
      }),
    ).toBe(false);
  });

  test("never for a number an administrator added for somebody", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);

    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({}),
        addedByUserId: ADMIN_ID,
      }),
    ).toBe(false);

    // OneUptime acting for an administrator names nobody.
    expect(
      await UserCallService.isNumberVerifiedForSms({
        item: callNumber({}),
        addedByUserId: undefined,
      }),
    ).toBe(false);

    expect(smsFindBy).not.toHaveBeenCalled();
  });
});

describe("adding a call number already verified for SMS", () => {
  test("is verified on the spot: no call, no code", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);

    const created: UserCall = await onCreateSuccess(
      addedBy(OWNER_ID),
      callNumber({}),
    );

    expect(created.isVerified).toBe(true);
    expect(makeCall).not.toHaveBeenCalled();

    const written: Record<string, unknown> = (
      callUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(written["isVerified"]).toBe(true);
    expect(written["verificationFailedAttempts"]).toBe(0);
    // No code is left on a row that never needed one.
    expect(written["verificationCodeExpiresAt"]).toBeNull();
  });

  test("gets the default notification rules a number verified by its own code gets", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);

    await onCreateSuccess(addedBy(OWNER_ID), callNumber({}));

    expect(addDefaultRules).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: OWNER_ID,
      notificationMethod: { userCallId: CALL_ITEM_ID },
    });
  });

  test("is still verified if the default rules cannot be created", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);
    addDefaultRules.mockRejectedValue(new Error("boom"));

    const created: UserCall = await onCreateSuccess(
      addedBy(OWNER_ID),
      callNumber({}),
    );

    expect(created.isVerified).toBe(true);
  });

  test("a number not verified for SMS gets its call with a code, as before", async () => {
    const created: UserCall = await onCreateSuccess(
      addedBy(OWNER_ID),
      callNumber({}),
    );

    expect(created.isVerified).toBe(false);
    expect(makeCall).toHaveBeenCalledTimes(1);
    expect(addDefaultRules).not.toHaveBeenCalled();
  });

  test("a number an administrator adds is called with a code for its owner to enter", async () => {
    smsFindBy.mockResolvedValue([smsNumber("+15551230100")]);

    const created: UserCall = await onCreateSuccess(
      addedBy(undefined),
      callNumber({}),
    );

    expect(created.isVerified).toBe(false);
    expect(makeCall).toHaveBeenCalledTimes(1);
  });
});

describe("verifying a number for SMS verifies the call numbers added for it", () => {
  let callFindBy: jest.SpyInstance;

  beforeEach(() => {
    callFindBy = getJestSpyOn(UserCallService, "findBy").mockResolvedValue([]);
  });

  test("the person's own unverified call number for the same number is verified, and counted", async () => {
    callFindBy.mockResolvedValue([
      callNumber({ phone: "+155 512 30100", createdByUserId: OWNER_ID }),
    ]);

    const count: number = await UserCallService.verifyNumbersProvenBySms({
      userId: OWNER_ID,
      projectId: PROJECT_ID,
      phone: new Phone("+15551230100"),
    });

    expect(count).toBe(1);
    expect(
      (callUpdate.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(CALL_ITEM_ID.toString());
    expect(
      (callUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data[
        "isVerified"
      ],
    ).toBe(true);
    expect(addDefaultRules).toHaveBeenCalledTimes(1);
  });

  test("only unverified numbers of this person in this project are looked at, as OneUptime", async () => {
    await UserCallService.verifyNumbersProvenBySms({
      userId: OWNER_ID,
      projectId: PROJECT_ID,
      phone: new Phone("+15551230100"),
    });

    const query: {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
    } = callFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot: boolean };
    };

    expect(String(query.query["userId"])).toBe(OWNER_ID.toString());
    expect(String(query.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query.query["projectId"])).not.toBe(
      OTHER_PROJECT_ID.toString(),
    );
    expect(query.query["isVerified"]).toBe(false);
    expect(query.props.isRoot).toBe(true);
  });

  test("a call number for a different number is left alone", async () => {
    callFindBy.mockResolvedValue([
      callNumber({ phone: "+15551230199", createdByUserId: OWNER_ID }),
    ]);

    expect(
      await UserCallService.verifyNumbersProvenBySms({
        userId: OWNER_ID,
        projectId: PROJECT_ID,
        phone: new Phone("+15551230100"),
      }),
    ).toBe(0);
    expect(callUpdate).not.toHaveBeenCalled();
  });

  test("a call number an administrator added for the person is left for its own code", async () => {
    callFindBy.mockResolvedValue([
      // Added by OneUptime acting for an administrator: nobody is its creator.
      callNumber({ phone: "+15551230100" }),
      callNumber({
        id: new ObjectID("9f000000-0000-4000-8000-000000000005"),
        phone: "+15551230100",
        createdByUserId: ADMIN_ID,
      }),
    ]);

    expect(
      await UserCallService.verifyNumbersProvenBySms({
        userId: OWNER_ID,
        projectId: PROJECT_ID,
        phone: new Phone("+15551230100"),
      }),
    ).toBe(0);
    expect(callUpdate).not.toHaveBeenCalled();
    expect(addDefaultRules).not.toHaveBeenCalled();
  });

  test("every matching number the person added is verified, the others are not", async () => {
    callFindBy.mockResolvedValue([
      callNumber({ phone: "+15551230100", createdByUserId: OWNER_ID }),
      callNumber({
        id: new ObjectID("9f000000-0000-4000-8000-000000000006"),
        phone: "+155.512.30100",
        createdByUserId: OWNER_ID,
      }),
      callNumber({
        id: new ObjectID("9f000000-0000-4000-8000-000000000007"),
        phone: "+15551239999",
        createdByUserId: OWNER_ID,
      }),
    ]);

    expect(
      await UserCallService.verifyNumbersProvenBySms({
        userId: OWNER_ID,
        projectId: PROJECT_ID,
        phone: new Phone("+15551230100"),
      }),
    ).toBe(2);
    expect(callUpdate).toHaveBeenCalledTimes(2);
  });
});
