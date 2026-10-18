import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, configure, render, screen } from "@testing-library/react";
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
 *   - the Overview leads with its Setup card while a step is left, and says
 *     a set-up policy that is turned off is not answering calls;
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/PhoneNumberPurchase", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="phone-number-purchase" />;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
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
import { getJestSpyOn } from "../../Spy";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/:projectId/on-call-duty"),
} as unknown as PageComponentProps;

beforeEach(() => {
  capturedTableProps = {};
  storedPolicy = {};
  ruleCount = 0;
  phoneNumbers = [];
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
      screen.getByText("Three steps, in order, before this policy can take calls."),
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

  test("says a set-up policy that is turned off is not answering calls, and where to turn it on", async () => {
    setUp(false);

    await renderOverview();

    expect(
      await screen.findByText(
        "Set up, but not answering calls. Turn on Answer Calls under Settings.",
      ),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("ready to receive calls");
  });
});
