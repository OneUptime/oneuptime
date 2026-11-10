import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import IncomingCallPolicyPhoneNumberService from "../../../Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import UserType from "../../../Types/UserType";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Refusals below are deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * ONE DEFAULT FOR SMS AND ONE FOR CALLS, END TO END (#6574).
 *
 * A customer's project had a Twilio config used for SMS only and one used
 * for calls only, and could make only one of them the project default: the
 * project's SMS or its calls went through OneUptime's own account, paid for
 * from the project's balance. These drive the real create, updateOneById
 * and deleteOneById of ProjectCallSMSConfigService - its hooks, the
 * permission checks and the success hooks that settle the project's
 * defaults - over an in-memory table, and read the defaults back as the
 * senders do (getProjectDefaultTwilioConfig).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6574a000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6574a000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("6574a000-0000-4000-8000-000000000003");
const OTHER_PROJECT_CONFIG_ID: string = "6574a000-0000-4000-8000-0000000000b1";

// Numbers for calls (a Singapore national number) and for SMS (a mobile).
const CALLS_NUMBER: string = "+6561234567";
const SMS_NUMBER: string = "+6581234567";
const BOTH_NUMBER: string = "+15551234567";

function memberProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

// May edit the project's Twilio configs, and do nothing else with them.
const editorProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([
      Permission.ReadProjectCallSMSConfig,
      Permission.EditProjectCallSMSConfig,
    ]);
  };

const readerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ReadProjectCallSMSConfig]);
  };

interface NewConfig {
  name: string;
  use: TwilioConfigUse;
  isProjectDefault?: boolean | undefined;
}

function newConfig(data: NewConfig): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config.name = data.name;
  config.usedFor = data.use;
  config.twilioAccountSID = "AC00000000000000000000000000006574";
  config.twilioAuthToken = "00000000000000000000000000006574";

  if (data.use === TwilioConfigUse.SmsOnly) {
    config.twilioSmsPhoneNumbers = SMS_NUMBER;
  } else if (data.use === TwilioConfigUse.CallsOnly) {
    config.twilioPrimaryPhoneNumber = new Phone(CALLS_NUMBER);
  } else {
    config.twilioPrimaryPhoneNumber = new Phone(BOTH_NUMBER);
  }

  if (data.isProjectDefault !== undefined) {
    config.isProjectDefault = data.isProjectDefault;
  }

  return config;
}

let table: InMemoryTable;
let madeAt: number;

// Creates a config as a project admin; each a second after the one before.
async function create(data: NewConfig): Promise<ProjectCallSMSConfig> {
  const created: ProjectCallSMSConfig =
    await ProjectCallSMSConfigService.create({
      data: newConfig(data),
      props: adminProps(),
    });

  madeAt += 1000;
  table.get(created.id!)!["createdAt"] = new Date(madeAt);

  return created;
}

async function setDefault(
  config: ProjectCallSMSConfig,
  isProjectDefault: boolean,
  props: DatabaseCommonInteractionProps = adminProps(),
): Promise<void> {
  await ProjectCallSMSConfigService.updateOneById({
    id: config.id!,
    data: { isProjectDefault: isProjectDefault },
    props: props,
  });
}

// What each config of the project is the default for, by name.
function defaults(): Record<string, string> {
  const result: Record<string, string> = {};

  for (const row of table.rows) {
    if (
      String(row["projectId"]).toLowerCase() !==
      PROJECT_ID.toString().toLowerCase()
    ) {
      continue;
    }

    const kinds: Array<string> = [];

    if (row["isProjectDefaultForSms"] === true) {
      kinds.push("sms");
    }

    if (row["isProjectDefaultForCalls"] === true) {
      kinds.push("calls");
    }

    // A default for nothing is no default; one for something is one.
    expect(row["isProjectDefault"] === true).toBe(kinds.length > 0);

    result[String(row["name"])] = kinds.join("+");
  }

  return result;
}

async function defaultFor(
  kind: TwilioMessageKind,
): Promise<TwilioConfig | undefined> {
  return await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
    PROJECT_ID,
    kind,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

beforeEach(() => {
  madeAt = Date.UTC(2026, 10, 10);

  table = useInMemoryTable(ProjectCallSMSConfigService, [
    // Another project's default, which nothing here may touch.
    {
      _id: OTHER_PROJECT_CONFIG_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Other project's Twilio",
      usedFor: TwilioConfigUse.CallsAndSms,
      isProjectDefault: true,
      isProjectDefaultForSms: true,
      isProjectDefaultForCalls: true,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    } as StoredRow,
  ]);

  // A deleted config releases the incoming-call numbers bought through it: none here.
  getJestSpyOn(
    IncomingCallPolicyPhoneNumberService,
    "findAllBy",
  ).mockResolvedValue([]);
  getJestSpyOn(IncomingCallPolicyService, "findAllBy").mockResolvedValue([]);
});

afterEach(() => {
  // The other project's default is where it was, whatever happened here.
  expect(table.get(OTHER_PROJECT_CONFIG_ID)).toEqual(
    expect.objectContaining({
      isProjectDefault: true,
      isProjectDefaultForSms: true,
      isProjectDefaultForCalls: true,
    }),
  );

  jest.restoreAllMocks();
});

describe("the customer's project: a config for SMS and one for calls", () => {
  test("both are the project default, and each message goes through its own", async () => {
    const sms: ProjectCallSMSConfig = await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
    });

    // The project's first config: the default for what it is used for.
    expect(sms.isProjectDefault).toBe(true);
    expect(sms.isProjectDefaultForSms).toBe(true);
    expect(sms.isProjectDefaultForCalls).toBe(false);

    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
    });

    expect(defaults()).toEqual({ SMS: "sms", Calls: "" });

    // Set as Project Default, on the calls config.
    await setDefault(calls, true);

    expect(defaults()).toEqual({ SMS: "sms", Calls: "calls" });

    const forSms: TwilioConfig | undefined = await defaultFor(
      TwilioMessageKind.SMS,
    );
    const forCalls: TwilioConfig | undefined = await defaultFor(
      TwilioMessageKind.Call,
    );

    expect(forSms?.smsPhoneNumbers?.map(String)).toEqual([SMS_NUMBER]);
    expect(TwilioPhoneNumbers.canSend(forSms, TwilioMessageKind.SMS)).toBe(
      true,
    );
    expect(forCalls?.primaryPhoneNumber?.toString()).toBe(CALLS_NUMBER);
    expect(TwilioPhoneNumbers.canSend(forCalls, TwilioMessageKind.Call)).toBe(
      true,
    );
  });

  test("the calls config created as the default joins the SMS default instead of replacing it", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });

    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
    });

    expect(calls.isProjectDefaultForCalls).toBe(true);
    expect(calls.isProjectDefaultForSms).toBe(false);
    expect(defaults()).toEqual({ SMS: "sms", Calls: "calls" });
  });

  test("someone who may only edit the configs sets the second default", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });
    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
    });

    await setDefault(calls, true, editorProps());

    expect(defaults()).toEqual({ SMS: "sms", Calls: "calls" });
  });
});

describe("Set as Project Default", () => {
  test("a config for calls and SMS takes both from the two that had them", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });
    await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
    });
    const both: ProjectCallSMSConfig = await create({
      name: "Both",
      use: TwilioConfigUse.CallsAndSms,
    });

    await setDefault(both, true);

    expect(defaults()).toEqual({ SMS: "", Calls: "", Both: "sms+calls" });
    expect(
      (await defaultFor(TwilioMessageKind.SMS))?.primaryPhoneNumber?.toString(),
    ).toBe(BOTH_NUMBER);
  });

  /*
   * The row's menu offers "Set as Project Default for SMS" on a config for
   * calls and SMS that is the default for calls alone: it writes the same
   * isProjectDefault: true the config already reads, and the config takes
   * what it does not hold yet.
   */
  test("the default for calls, used for SMS too, takes the SMS from the default for SMS only", async () => {
    const both: ProjectCallSMSConfig = await create({
      name: "Both",
      use: TwilioConfigUse.CallsAndSms,
    });
    await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: true,
    });

    expect(defaults()).toEqual({ Both: "calls", SMS: "sms" });

    await setDefault(both, true);

    expect(defaults()).toEqual({ Both: "sms+calls", SMS: "" });
    expect(
      (await defaultFor(TwilioMessageKind.SMS))?.primaryPhoneNumber?.toString(),
    ).toBe(BOTH_NUMBER);
  });

  test("a config for SMS only takes the SMS from the default for both, which keeps the calls", async () => {
    await create({ name: "Both", use: TwilioConfigUse.CallsAndSms });
    const sms: ProjectCallSMSConfig = await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
    });

    await setDefault(sms, true);

    expect(defaults()).toEqual({ Both: "calls", SMS: "sms" });
  });

  test("a member who may only read the configs is refused, and every default stays where it was", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });
    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
    });

    expect(
      await rejectionOf(setDefault(calls, true, readerProps())),
    ).toBeInstanceOf(NotAuthorizedException);
    expect(defaults()).toEqual({ SMS: "sms", Calls: "" });
  });
});

describe("Stop Using as Project Default", () => {
  test("the SMS go back to the default for calls when it is used for SMS too", async () => {
    await create({ name: "Both", use: TwilioConfigUse.CallsAndSms });
    const sms: ProjectCallSMSConfig = await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: true,
    });

    expect(defaults()).toEqual({ Both: "calls", SMS: "sms" });

    await setDefault(sms, false);

    expect(defaults()).toEqual({ Both: "sms+calls", SMS: "" });
  });

  test("the calls go to nobody when no other default makes calls: OneUptime's account makes them", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });
    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
    });

    await setDefault(calls, false);

    expect(defaults()).toEqual({ SMS: "sms", Calls: "" });

    // The SMS default is handed on for a call, and cannot make it.
    const forCalls: TwilioConfig | undefined = await defaultFor(
      TwilioMessageKind.Call,
    );

    expect(forCalls?.use).toBe(TwilioConfigUse.SmsOnly);
    expect(TwilioPhoneNumbers.canSend(forCalls, TwilioMessageKind.Call)).toBe(
      false,
    );
  });
});

describe("deleting a default", () => {
  test("the default for calls, used for SMS too, takes the SMS back", async () => {
    await create({ name: "Both", use: TwilioConfigUse.CallsAndSms });
    const sms: ProjectCallSMSConfig = await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
      isProjectDefault: true,
    });

    await ProjectCallSMSConfigService.deleteOneById({
      id: sms.id!,
      props: adminProps(),
    });

    expect(defaults()).toEqual({ Both: "sms+calls" });
  });

  test("a config that is no default takes nothing when the default goes", async () => {
    const both: ProjectCallSMSConfig = await create({
      name: "Both",
      use: TwilioConfigUse.CallsAndSms,
    });
    await create({ name: "Spare", use: TwilioConfigUse.CallsAndSms });

    await ProjectCallSMSConfigService.deleteOneById({
      id: both.id!,
      props: adminProps(),
    });

    expect(defaults()).toEqual({ Spare: "" });
    expect(await defaultFor(TwilioMessageKind.SMS)).toBeUndefined();
    expect(await defaultFor(TwilioMessageKind.Call)).toBeUndefined();
  });
});

describe("changing what a default is used for", () => {
  test("a default made SMS only stops being the default for calls", async () => {
    const both: ProjectCallSMSConfig = await create({
      name: "Both",
      use: TwilioConfigUse.CallsAndSms,
    });

    await ProjectCallSMSConfigService.updateOneById({
      id: both.id!,
      data: {
        usedFor: TwilioConfigUse.SmsOnly,
        twilioSmsPhoneNumbers: SMS_NUMBER,
      },
      props: adminProps(),
    });

    expect(defaults()).toEqual({ Both: "sms" });
  });

  test("a default that starts making calls too takes them when no config has them", async () => {
    const sms: ProjectCallSMSConfig = await create({
      name: "SMS",
      use: TwilioConfigUse.SmsOnly,
    });

    await ProjectCallSMSConfigService.updateOneById({
      id: sms.id!,
      data: {
        usedFor: TwilioConfigUse.CallsAndSms,
        twilioPrimaryPhoneNumber: new Phone(BOTH_NUMBER),
      },
      props: adminProps(),
    });

    expect(defaults()).toEqual({ SMS: "sms+calls" });
  });
});

describe("what a config is the default for is the server's to say", () => {
  test("a member's update that writes it is refused, and nothing changes", async () => {
    await create({ name: "Both", use: TwilioConfigUse.CallsAndSms });
    const spare: ProjectCallSMSConfig = await create({
      name: "Spare",
      use: TwilioConfigUse.CallsAndSms,
    });

    for (const column of [
      "isProjectDefaultForSms",
      "isProjectDefaultForCalls",
    ]) {
      expect(
        await rejectionOf(
          ProjectCallSMSConfigService.updateOneById({
            id: spare.id!,
            data: { [column]: true },
            props: adminProps(),
          }),
        ),
      ).toBeInstanceOf(ColumnWriteRefusedException);
    }

    expect(defaults()).toEqual({ Both: "sms+calls", Spare: "" });
  });

  test("a member's create that says it is dropped: the rule says it", async () => {
    await create({ name: "Both", use: TwilioConfigUse.CallsAndSms });

    const config: ProjectCallSMSConfig = newConfig({
      name: "Sneaky",
      use: TwilioConfigUse.CallsAndSms,
      isProjectDefault: false,
    });
    config.isProjectDefaultForSms = true;
    config.isProjectDefaultForCalls = true;

    const created: ProjectCallSMSConfig =
      await ProjectCallSMSConfigService.create({
        data: config,
        props: adminProps(),
      });

    expect(created.isProjectDefaultForSms).toBe(false);
    expect(defaults()).toEqual({ Both: "sms+calls", Sneaky: "" });
  });

  test("renaming a default leaves every default where it was, unwritten", async () => {
    await create({ name: "SMS", use: TwilioConfigUse.SmsOnly });
    const calls: ProjectCallSMSConfig = await create({
      name: "Calls",
      use: TwilioConfigUse.CallsOnly,
      isProjectDefault: true,
    });
    const updatesBefore: number = table.updates.length;

    await ProjectCallSMSConfigService.updateOneById({
      id: calls.id!,
      data: { name: "Calls (Singapore)" },
      props: adminProps(),
    });

    expect(table.updates.length).toBe(updatesBefore + 1);
    expect(defaults()).toEqual({ SMS: "sms", "Calls (Singapore)": "calls" });
  });
});
