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
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * An incoming call policy, from the list to its first call, kept simple:
 *
 *   - the list says what a policy is for ("Phone numbers people can call to
 *     reach whoever is on call.") where it said "Configure incoming call
 *     routing policies ...", an empty list says "No incoming call policies
 *     yet" - not "No incoming call policy found", the words of a search that
 *     missed - and its ⋯ menu links to the docs page that explains the set-up;
 *   - Create asks for the name, with the description and the labels under
 *     More fields, as Create On-Call Policy does, and opens the new policy's
 *     Overview: it used to leave a "Setup Needed" row in the list;
 *   - the Overview leads with its Setup card while a step is left, and a
 *     policy whose Answer Calls is off opens with a banner that says so,
 *     with Start answering calls to turn it back on right there (the UI
 *     review: it was one line in a card's description, "Turn on Answer
 *     Calls under Settings");
 *   - the Setup and Phone Numbers cards start their rows at the title's
 *     edge, and keep each step's number and icon round on a phone, where
 *     a row's button wraps under it;
 *   - its side menu reads like an on-call policy's: no Documentation page of
 *     its own, and Delete Policy under Advanced, not a Danger Zone of one.
 *
 * The side menu, the Overview and its cards are the real ones; the list's
 * table is replaced by one that hands its props to the test.
 */

configure({ asyncUtilTimeout: 15000 });

const POLICY_ID: string = "7b000000-0000-4000-8000-0000000000c1";
const TWILIO_ID: string = "7a000000-0000-4000-8000-0000000000a1";

let capturedTableProps: Record<string, any> = {};
let storedPolicy: JSONObject = {};
let ruleCount: number = 0;
let phoneNumbers: Array<JSONObject> = [];
let updates: Array<JSONObject> = [];
let policyReads: number = 0;

const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, any>): null => {
      capturedTableProps = props;
      return null;
    },
  };
});

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
  return {
    __esModule: true,
    default: {
      getItem: async (data: {
        modelType: { new (): unknown };
      }): Promise<unknown> => {
        policyReads++;
        return Object.assign(
          new data.modelType() as Record<string, unknown>,
          { _id: POLICY_ID },
          storedPolicy,
        );
      },
      updateById: async (data: { data: JSONObject }): Promise<unknown> => {
        updates.push(data.data);
        storedPolicy = { ...storedPolicy, ...data.data };
        return {};
      },
      getList: async (): Promise<unknown> => {
        return {
          data: phoneNumbers,
          count: phoneNumbers.length,
          skip: 0,
          limit: 10,
        };
      },
      count: async (): Promise<number> => {
        return ruleCount;
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

import IncomingCallPoliciesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicies";
import IncomingCallPolicyOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/Index";
import IncomingCallPolicySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/IncomingCallPolicy/SideMenu";
import OnCallDutyPolicySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/SideMenu";
import {
  INCOMING_CALL_POLICIES_CARD_DESCRIPTION,
  INCOMING_CALL_POLICY_DOCS_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallPolicyCreateForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import IncomingCallPolicy from "../../../Models/DatabaseModels/IncomingCallPolicy";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
  INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID,
  IncomingCallAnswerCallsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncomingCallPolicy/IncomingCallPolicySettingsCopy";
import { getJestSpyOn } from "../../Spy";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/:projectId/on-call-duty"),
} as unknown as PageComponentProps;

beforeEach(() => {
  capturedTableProps = {};
  storedPolicy = {};
  ruleCount = 0;
  phoneNumbers = [];
  updates = [];
  policyReads = 0;
  PermissionGate.clearPermissionPropsCache();
  navigateMock.mockReset();
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (...args: Array<unknown>): void => {
      navigateMock(...args);
    },
  );
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
    for (let i: number = 0; i < 4; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

describe("a policy's side menu", () => {
  test("reads like an on-call policy's: Basic, Logs, Developer, Advanced", async () => {
    await renderMenu(
      <MemoryRouter>
        <IncomingCallPolicySideMenu modelId={new ObjectID(POLICY_ID)} />
      </MemoryRouter>,
    );

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Logs",
      "Developer",
      "Advanced",
    ]);
    expect(
      linksIn("Basic").map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Overview", "Escalation Rules", "Owners"]);
    expect(
      linksIn("Advanced").map((link: { title: string }): string => {
        return link.title;
      }),
    ).toEqual(["Settings", "Audit Logs", "Delete Policy"]);
  });

  test("has no Documentation page and no Danger Zone", async () => {
    await renderMenu(
      <MemoryRouter>
        <IncomingCallPolicySideMenu modelId={new ObjectID(POLICY_ID)} />
      </MemoryRouter>,
    );

    expect(titlesInMenu()).not.toContain("Documentation");
    expect(sectionTitlesInOrder()).not.toContain("Danger Zone");
  });

  test("puts Delete Policy where an on-call policy's menu does: last, under Advanced", async () => {
    await renderMenu(
      <MemoryRouter>
        <OnCallDutyPolicySideMenu modelId={new ObjectID(POLICY_ID)} />
      </MemoryRouter>,
    );

    const onCallAdvanced: Array<string> = linksIn("Advanced").map(
      (link: { title: string }): string => {
        return link.title;
      },
    );

    expect(onCallAdvanced[onCallAdvanced.length - 1]).toBe("Delete Policy");
    expect(sectionTitlesInOrder()).not.toContain("Danger Zone");
  });
});

describe("the list of incoming call policies", () => {
  test("says what a policy is for, and leaves the empty list to say 'No incoming call policies yet'", async () => {
    render(
      <MemoryRouter>
        <IncomingCallPoliciesPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await settle();

    expect(capturedTableProps["cardProps"].title).toBe(
      "Incoming Call Policies",
    );
    expect(capturedTableProps["cardProps"].description).toBe(
      INCOMING_CALL_POLICIES_CARD_DESCRIPTION,
    );
    expect(INCOMING_CALL_POLICIES_CARD_DESCRIPTION).toBe(
      "Phone numbers people can call to reach whoever is on call.",
    );
    // No sentence of its own: the table's "No incoming call policies yet" and its Create button.
    expect(capturedTableProps["noItemsMessage"]).toBeUndefined();
  });

  test("links to the docs page that explains the set-up", async () => {
    render(
      <MemoryRouter>
        <IncomingCallPoliciesPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await settle();

    expect(INCOMING_CALL_POLICY_DOCS_PATH).toBe(
      "/docs/on-call/incoming-call-policy",
    );
    expect(capturedTableProps["documentationLink"].toString()).toBe(
      INCOMING_CALL_POLICY_DOCS_PATH,
    );
  });

  test("Create asks for the name, and folds the description and labels under More fields", async () => {
    render(
      <MemoryRouter>
        <IncomingCallPoliciesPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await settle();

    const fields: Array<Record<string, any>> = capturedTableProps["formFields"];

    expect(
      fields.map((field: Record<string, any>): string => {
        return Object.keys(field["field"] || {})[0] || "";
      }),
    ).toEqual(["name", "description", "labels"]);

    const [name, description, labels] = fields as Array<Record<string, any>>;

    expect(name!["required"]).toBe(true);
    expect(name!["collapsibleSection"]).toBeUndefined();
    // "Any friendly name of this policy" restated the title.
    expect(name!["hideColumnDescription"]).toBe(true);
    expect(description!["hideColumnDescription"]).toBe(true);

    expect(description!["collapsibleSection"]).toBeTruthy();
    expect(labels!["collapsibleSection"]).toBe(
      description!["collapsibleSection"],
    );
    expect(description!["collapsibleSection"].title).toBe("More fields");
  });

  test("a new policy opens on its Overview, where its Setup card is", async () => {
    render(
      <MemoryRouter>
        <IncomingCallPoliciesPage {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    await settle();

    const created: IncomingCallPolicy = new IncomingCallPolicy();
    created._id = POLICY_ID;

    const returned: IncomingCallPolicy =
      await capturedTableProps["onCreateSuccess"](created);

    expect(returned).toBe(created);
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW] as Route,
        { modelId: new ObjectID(POLICY_ID) },
      ).toString(),
    );
  });
});

// Where, in the page, a card's title is: to compare the order of two cards.
function positionOf(text: string): number {
  return (document.body.textContent || "").indexOf(text);
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <IncomingCallPolicyOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await settle();
}

function setUp(isEnabled: boolean): void {
  storedPolicy = {
    name: "Support hotline",
    isEnabled: isEnabled,
    projectCallSMSConfigId: new ObjectID(TWILIO_ID),
    projectCallSMSConfig: { name: "Support Twilio" },
  };
  ruleCount = 2;
  phoneNumbers = [
    {
      _id: "7c000000-0000-4000-8000-0000000000c1",
      incomingCallPolicyId: POLICY_ID,
      phoneNumber: "+14155550101",
    },
  ];
}

describe("a policy's Overview", () => {
  test("leads with Setup while a step is left", async () => {
    storedPolicy = { name: "Sandbox line", isEnabled: true };

    await renderOverview();

    expect(await screen.findByText("Setup")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Three steps, in order, before this policy can take calls.",
      ),
    ).toBeInTheDocument();
    expect(positionOf("Setup")).toBeGreaterThan(-1);
    expect(positionOf("Setup")).toBeLessThan(
      positionOf("Incoming Call Policy Details"),
    );
  });

  test("leads with the policy's details once it is set up, then what is set up", async () => {
    setUp(true);

    await renderOverview();

    expect(
      await screen.findByText("Phone Numbers & Twilio Configuration"),
    ).toBeInTheDocument();
    expect(positionOf("Incoming Call Policy Details")).toBeLessThan(
      positionOf("Phone Numbers & Twilio Configuration"),
    );
    expect(document.body).not.toHaveTextContent(
      "Three steps, in order, before this policy can take calls.",
    );
    expect(
      screen.getByText(
        "Calls to these numbers ring the people its escalation rules name.",
      ),
    ).toBeInTheDocument();
  });

  test("a policy that answers calls opens with no banner", async () => {
    setUp(true);

    await renderOverview();

    await screen.findByText("Phone Numbers & Twilio Configuration");

    expect(
      screen.queryByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("a policy whose Answer Calls is off", () => {
  test("opens with a banner that says so, above everything, with the button that answers calls", async () => {
    setUp(false);

    await renderOverview();

    const banner: HTMLElement = await screen.findByTestId(
      INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID,
    );

    expect(banner).toHaveTextContent("Not answering calls");
    expect(banner).toHaveTextContent(
      IncomingCallAnswerCallsCopy.switchOffDescription,
    );
    expect(
      screen.getByTestId(INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID),
    ).toHaveTextContent("Start answering calls");

    // First on the page: before the details card.
    expect(positionOf("Not answering calls")).toBeLessThan(
      positionOf("Incoming Call Policy Details"),
    );
    // No longer a line sending the reader to Settings.
    expect(document.body).not.toHaveTextContent("under Settings");
    expect(document.body).not.toHaveTextContent(
      "Set up, but not answering calls",
    );
  });

  test("the set-up card says what its numbers do, as it does while calls are answered", async () => {
    setUp(false);

    await renderOverview();

    expect(
      await screen.findByText(
        "Calls to these numbers ring the people its escalation rules name.",
      ),
    ).toBeInTheDocument();
  });

  test("Start answering calls turns calls on in place: the banner goes and the Status says Enabled", async () => {
    setUp(false);

    await renderOverview();

    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID);
    expect(await screen.findByText("Disabled")).toBeInTheDocument();

    const readsBefore: number = policyReads;

    await act(async () => {
      fireEvent.click(
        screen.getByTestId(INCOMING_CALL_START_ANSWERING_BUTTON_TEST_ID),
      );
    });
    await settle();

    expect(updates).toEqual([{ isEnabled: true }]);
    expect(
      screen.queryByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).not.toBeInTheDocument();

    // The details card reads the policy again, and says what it is now.
    expect(policyReads).toBeGreaterThan(readsBefore);
    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument();
    // In place: no trip to another page.
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("a policy that is off and not set up shows the banner over its Setup card", async () => {
    storedPolicy = { name: "Sandbox line", isEnabled: false };

    await renderOverview();

    await screen.findByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID);

    expect(positionOf("Not answering calls")).toBeLessThan(positionOf("Setup"));
  });

  test("a policy whose switch could not be read is not called off", async () => {
    storedPolicy = { name: "Support hotline" };

    await renderOverview();

    await screen.findByText("Setup");

    expect(
      screen.queryByTestId(INCOMING_CALL_ANSWER_CALLS_OFF_BANNER_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

// A flex item that never shrinks below its own size.
const KEEPS_ITS_SIZE: RegExp = /(^|\s)(shrink-0|flex-shrink-0)(\s|$)/;

describe("the Setup and Phone Numbers cards, on a phone", () => {
  // The box a step's number, or a row's icon, is drawn in.
  function circleOf(text: string): HTMLElement {
    return screen
      .getAllByText(text, { exact: true })
      .find((element: HTMLElement): boolean => {
        return element.className.includes("rounded-full");
      }) as HTMLElement;
  }

  test("start their rows at the title's edge, as every card's body does", async () => {
    storedPolicy = { name: "Sandbox line", isEnabled: true };

    await renderOverview();

    const step: HTMLElement = await screen.findByText(
      "Select Twilio Configuration",
    );
    const body: HTMLElement = step.closest(".space-y-6") as HTMLElement;

    expect(body).not.toBeNull();
    // An inner p-6 set the steps 24px in from the title.
    expect(body.className.split(" ")).not.toContain("p-6");
  });

  test("keep each step's number round: it never shrinks beside a long step", async () => {
    storedPolicy = { name: "Sandbox line", isEnabled: true };

    await renderOverview();

    await screen.findByText("Select Twilio Configuration");

    for (const number of ["1", "2", "3"]) {
      const circle: HTMLElement = circleOf(number);

      expect({ number, circle: Boolean(circle) }).toEqual({
        number,
        circle: true,
      });
      expect({
        number,
        keepsItsSize: KEEPS_ITS_SIZE.test(circle.className),
      }).toEqual({ number, keepsItsSize: true });
    }
  });

  test("wrap a row's button under it, at the right, instead of squeezing its words", async () => {
    storedPolicy = { name: "Sandbox line", isEnabled: true };

    await renderOverview();

    const select: HTMLElement = await screen.findByRole("button", {
      name: "Select",
    });
    const wrapper: HTMLElement = select.parentElement as HTMLElement;
    const row: HTMLElement = wrapper.parentElement as HTMLElement;

    expect(wrapper.className).toContain("ml-auto");
    expect(wrapper.className).toContain("shrink-0");
    expect(row.className).toContain("flex-wrap");
  });
});
