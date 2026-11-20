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
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN INCOMING CALL POLICY'S TWILIO CONFIGURATION PICKER LISTS ONLY THE
 * CONFIGS USED FOR CALLS (#8885).
 *
 * A project's Twilio config is used for calls and SMS, SMS only or calls
 * only. The policy's picker listed every config, one used for SMS only among
 * them, so a policy was set up on an account the project said was not for
 * calls, and nothing said so. The policy's real Overview is drawn here, with
 * the API stood in for:
 *
 *   - Select opens the picker, which asks the server only for the configs
 *     used for calls and SMS, or calls only - as a status page's asks only for
 *     the ones that send SMS - and says that the rest are not listed;
 *   - a project whose configs are all used for SMS only is told so, with what
 *     to change, rather than that it has no config at all; a project with no
 *     config is still asked to add one;
 *   - a policy already on a config used for SMS only keeps it - calls to its
 *     numbers still ring - and its Setup card, or once set up its Phone
 *     Numbers & Twilio Configuration card, says what to change. A config used
 *     for calls, or one whose use could not be read, shows no such note.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "7b000000-0000-4000-8000-0000000000d1";
const TWILIO_ID: string = "7a000000-0000-4000-8000-0000000000d1";

const SMS_ONLY_NOTE: string =
  "This config is used for SMS only. Set it to Calls and SMS, or Calls only, in Project Settings.";

let storedPolicy: JSONObject = {};
let ruleCount: number = 0;
let phoneNumbers: Array<JSONObject> = [];
// What the project's configs number: all of them, and the ones used for calls.
let configCount: number = 0;
let callConfigCount: number = 0;
let configCounts: Array<JSONObject> = [];
let configLists: Array<JSONObject> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/PhoneNumberPurchase",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="phone-number-purchase" />;
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  // The model a request names, by its table name.
  const tableOf: (modelType: { new (): unknown }) => string = (modelType: {
    new (): unknown;
  }): string => {
    return (
      (new modelType() as { tableName?: string | undefined }).tableName || ""
    );
  };

  // A query as JSON: its Includes as { _type, value }.
  const asJSON: (query: unknown) => JSONObject = (
    query: unknown,
  ): JSONObject => {
    return JSON.parse(JSON.stringify(query || {})) as JSONObject;
  };

  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        return Object.assign(
          new data.modelType() as Record<string, unknown>,
          { _id: POLICY_ID },
          storedPolicy,
        );
      },
      updateById: async (): Promise<unknown> => {
        return {};
      },
      getList: async (data: {
        modelType: { new (): unknown };
        query?: unknown;
      }): Promise<unknown> => {
        if (tableOf(data.modelType) === "ProjectCallSMSConfig") {
          configLists.push(asJSON(data.query));

          return {
            data: [],
            count: 0,
            skip: 0,
            limit: 10,
          };
        }

        return {
          data: phoneNumbers,
          count: phoneNumbers.length,
          skip: 0,
          limit: 10,
        };
      },
      count: async (data: {
        modelType: { new (): unknown };
        query?: unknown;
      }): Promise<number> => {
        if (tableOf(data.modelType) !== "ProjectCallSMSConfig") {
          return ruleCount;
        }

        const query: JSONObject = asJSON(data.query);
        configCounts.push(query);

        return query["usedFor"] ? callConfigCount : configCount;
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import IncomingCallPolicyOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Index";
import {
  INCOMING_CALL_TWILIO_CONFIG_USES,
  IncomingCallTwilioConfigCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallTwilioConfigCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/:projectId/on-call-duty"),
} as unknown as PageComponentProps;

beforeEach(() => {
  storedPolicy = {};
  ruleCount = 0;
  phoneNumbers = [];
  configCount = 0;
  callConfigCount = 0;
  configCounts = [];
  configLists = [];
  PermissionGate.clearPermissionPropsCache();
  goTo(
    `/dashboard/${PROJECT_ID}/on-call-duty/incoming-call-policies/${POLICY_ID}`,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <IncomingCallPolicyOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await settle();
}

// A policy on a config, before its numbers and rules: its Setup card leads.
function onConfig(usedFor: TwilioConfigUse | undefined): void {
  storedPolicy = {
    name: "Support hotline",
    isEnabled: true,
    projectCallSMSConfigId: new ObjectID(TWILIO_ID),
    projectCallSMSConfig: {
      name: "Support Twilio",
      ...(usedFor ? { usedFor: usedFor } : {}),
    },
  };
}

// The same policy with its number and rules: what is set up leads.
function setUpOnConfig(usedFor: TwilioConfigUse | undefined): void {
  onConfig(usedFor);
  ruleCount = 2;
  phoneNumbers = [
    {
      _id: "7c000000-0000-4000-8000-0000000000d1",
      incomingCallPolicyId: POLICY_ID,
      phoneNumber: "+14155550101",
    },
  ];
}

// What a query of the project's configs asks of their use: its Includes' values.
function usesAskedFor(query: JSONObject): Array<string> {
  const usedFor: JSONObject | undefined = query["usedFor"] as
    | JSONObject
    | undefined;

  expect(usedFor?.["_type"]).toBe(ObjectType.Includes);

  return [...(usedFor?.["value"] as Array<string>)].sort();
}

const USES_THAT_MAKE_CALLS: Array<string> = [
  TwilioConfigUse.CallsAndSms,
  TwilioConfigUse.CallsOnly,
].sort();

describe("the copy the page draws", () => {
  test("lists the uses that make calls, and not SMS only", () => {
    expect([...INCOMING_CALL_TWILIO_CONFIG_USES].sort()).toEqual(
      USES_THAT_MAKE_CALLS,
    );
    expect(INCOMING_CALL_TWILIO_CONFIG_USES).not.toContain(
      TwilioConfigUse.SmsOnly,
    );
  });

  test("the note is the one this suite reads on the cards", () => {
    expect(IncomingCallTwilioConfigCopy.smsOnlyNote).toBe(SMS_ONLY_NOTE);
  });
});

describe("a policy on a config used for SMS only", () => {
  test("its Setup card names the config and says what to change, not that it is selected", async () => {
    onConfig(TwilioConfigUse.SmsOnly);

    await renderOverview();

    const note: HTMLElement = await screen.findByTestId(
      "incoming-call-twilio-config-sms-only",
    );

    expect(note).toHaveTextContent("Support Twilio");
    expect(note).toHaveTextContent(SMS_ONLY_NOTE);
    expect(document.body).not.toHaveTextContent(
      "Twilio configuration selected",
    );
    // The policy keeps its config: the next steps are open, as before.
    expect(screen.getByTestId("phone-number-purchase")).toBeInTheDocument();
  });

  test("once set up, its Phone Numbers & Twilio Configuration card says it too", async () => {
    setUpOnConfig(TwilioConfigUse.SmsOnly);

    await renderOverview();

    await screen.findByText("Phone Numbers & Twilio Configuration");

    const note: HTMLElement = screen.getByTestId(
      "incoming-call-twilio-config-sms-only",
    );

    expect(note).toHaveTextContent(SMS_ONLY_NOTE);
  });
});

describe("a policy on a config used for calls", () => {
  test.each([TwilioConfigUse.CallsAndSms, TwilioConfigUse.CallsOnly])(
    "%s: its Setup card says the config is selected, with no note",
    async (usedFor: TwilioConfigUse) => {
      onConfig(usedFor);

      await renderOverview();

      expect(
        await screen.findByText("Twilio configuration selected"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("incoming-call-twilio-config-sms-only"),
      ).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(SMS_ONLY_NOTE);
    },
  );

  test.each([TwilioConfigUse.CallsAndSms, TwilioConfigUse.CallsOnly])(
    "%s: once set up, no note on its card",
    async (usedFor: TwilioConfigUse) => {
      setUpOnConfig(usedFor);

      await renderOverview();

      await screen.findByText("Phone Numbers & Twilio Configuration");

      expect(
        screen.queryByTestId("incoming-call-twilio-config-sms-only"),
      ).not.toBeInTheDocument();
    },
  );

  test("a config whose use could not be read is not called SMS only", async () => {
    onConfig(undefined);

    await renderOverview();

    expect(
      await screen.findByText("Twilio configuration selected"),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SMS_ONLY_NOTE);
  });
});

describe("Select, on a policy with no config yet", () => {
  async function openPicker(): Promise<void> {
    storedPolicy = { name: "Support hotline", isEnabled: true };

    await renderOverview();

    fireEvent.click(await screen.findByRole("button", { name: "Select" }));

    await settle();
  }

  test("counts the configs used for calls, and all of them", async () => {
    configCount = 1;
    callConfigCount = 1;

    await openPicker();

    expect(configCounts).toHaveLength(2);

    const forCalls: JSONObject | undefined = configCounts.find(
      (query: JSONObject): boolean => {
        return Boolean(query["usedFor"]);
      },
    );

    expect(usesAskedFor(forCalls!)).toEqual(USES_THAT_MAKE_CALLS);
    expect(
      configCounts.find((query: JSONObject): boolean => {
        return !query["usedFor"];
      }),
    ).toEqual({});
  });

  test("lists only the configs used for calls, and says the rest are not listed", async () => {
    configCount = 3;
    callConfigCount = 2;

    await openPicker();

    // The picker's dialog, under the Setup card's own "Select Twilio Configuration".
    expect(
      await screen.findByText(
        "The Twilio account this policy's numbers and calls run on.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(IncomingCallTwilioConfigCopy.pickerDescription),
    ).toBeInTheDocument();

    // The dropdown's options are read with the same query: no SMS only config among them.
    expect(configLists.length).toBeGreaterThan(0);

    for (const query of configLists) {
      expect(usesAskedFor(query)).toEqual(USES_THAT_MAKE_CALLS);
    }
  });

  test("in a project whose configs are all used for SMS only, says so, with what to change", async () => {
    configCount = 2;
    callConfigCount = 0;

    await openPicker();

    expect(
      await screen.findByText(IncomingCallTwilioConfigCopy.noCallConfigTitle),
    ).toBeInTheDocument();
    expect(
      screen.getByText(IncomingCallTwilioConfigCopy.noCallConfigMessage),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      "No Twilio Configuration Found",
    );
    // Nothing to pick: the picker is not opened on an empty list.
    expect(configLists).toEqual([]);
  });

  test("in a project with no config at all, asks for one to be added, as before", async () => {
    configCount = 0;
    callConfigCount = 0;

    await openPicker();

    expect(
      await screen.findByText("No Twilio Configuration Found"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a Twilio configuration first, under Project Settings > Notifications > Notification Channels.",
      ),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      IncomingCallTwilioConfigCopy.noCallConfigMessage,
    );
  });
});
