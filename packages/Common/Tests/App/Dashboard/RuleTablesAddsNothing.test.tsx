import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A label or owner rule saved before the form asked what it adds - through
 * the API, Terraform, an import or the old form - may add nothing: it
 * matches and does nothing. Its Edit form lets it be renamed, switched off
 * or deleted, and its table says "Adds nothing" beside its status, so it can
 * be found and fixed (Common/UI/Components/RuleRun/RuleAction).
 *
 * The real pages, through the real RuleTable and ModelTable: only the
 * network, the permissions and the translations are stubbed. What the list
 * asks the API for, and what each row draws, is read off the page.
 */

configure({ asyncUtilTimeout: 15000 });

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import Route from "../../../Types/API/Route";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import Label from "../../../Models/DatabaseModels/Label";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import Team from "../../../Models/DatabaseModels/Team";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import MonitorLabelRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorLabelRules";
import IncidentOwnerRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

type RulePage = FunctionComponent<RuleSettingsPageProps>;

interface ListRequest {
  modelType: { name: string };
  select?: Record<string, unknown>;
}

let listRequests: Array<ListRequest> = [];

// Answers the rule table with these rows; every other list is empty.
function serveRules(modelName: string, rules: Array<BaseModel>): void {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (request: unknown): Promise<never> => {
      const listRequest: ListRequest = request as ListRequest;
      listRequests.push(listRequest);

      const rows: Array<BaseModel> =
        listRequest.modelType.name === modelName ? rules : [];

      return {
        data: rows,
        count: rows.length,
        skip: 0,
        limit: 50,
      } as unknown as never;
    });

  jest.spyOn(ModelAPI, "count").mockImplementation(async (): Promise<never> => {
    return 0 as unknown as never;
  });
}

async function renderPage(Page: RulePage): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <Page
        pageRoute={new Route(`/dashboard/${PROJECT_ID}/settings/label-rules`)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });
}

// The table row a rule is drawn in, found by its name.
async function rowOf(name: string): Promise<HTMLElement> {
  const cell: HTMLElement = await screen.findByText(name);
  const row: HTMLElement | null = cell.closest("tr");

  if (!row) {
    throw new Error(`The rule ${name} is not drawn in a table row.`);
  }

  return row;
}

function ruleListRequest(modelName: string): ListRequest {
  const request: ListRequest | undefined = listRequests.find(
    (candidate: ListRequest): boolean => {
      return candidate.modelType.name === modelName;
    },
  );

  if (!request) {
    throw new Error(`The page never listed ${modelName}.`);
  }

  return request;
}

beforeEach(() => {
  listRequests = [];
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/monitors/settings/label-rules`,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Monitors > Settings > Label Rules", () => {
  test("says Adds nothing beside the rule that adds no label, and only there", async () => {
    serveRules("MonitorLabelRule", [
      Object.assign(new MonitorLabelRule(), {
        _id: "22222222-2222-4222-8222-000000000001",
        name: "Tag production",
        description: "",
        isEnabled: true,
        labelsToAdd: [
          Object.assign(new Label(), {
            _id: "0000000a-0000-4000-8000-000000000001",
          }),
        ],
      }),
      Object.assign(new MonitorLabelRule(), {
        _id: "22222222-2222-4222-8222-000000000002",
        name: "Old rule",
        description: "",
        isEnabled: true,
        labelsToAdd: [],
      }),
    ]);

    await renderPage(MonitorLabelRules);

    const oldRule: HTMLElement = await rowOf("Old rule");
    const tagged: HTMLElement = await rowOf("Tag production");

    expect(within(oldRule).getByTestId("rule-adds-nothing")).toHaveTextContent(
      "Adds nothing",
    );
    // Its status is still said: on, but doing nothing.
    expect(oldRule).toHaveTextContent("Enabled");
    expect(within(tagged).queryByTestId("rule-adds-nothing")).toBeNull();
    expect(screen.getAllByTestId("rule-adds-nothing")).toHaveLength(1);
  });

  test("asks the API for each rule's labels by id, beside what the page reads", async () => {
    serveRules("MonitorLabelRule", []);

    await renderPage(MonitorLabelRules);

    await waitFor(() => {
      expect(ruleListRequest("MonitorLabelRule")).toBeDefined();
    });

    const select: Record<string, unknown> =
      ruleListRequest("MonitorLabelRule").select || {};

    expect(select["labelsToAdd"]).toEqual({ _id: true });
    expect(select["isEnabled"]).toBe(true);
    expect(select["name"]).toBe(true);
  });
});

describe("Incidents > Settings > Owner Rules", () => {
  test("never says it of a rule that inherits its owners, nor of one that names some", async () => {
    const switchesOff: Record<string, boolean> = {
      inheritOwnersFromMonitors: false,
      inheritOwnersFromHosts: false,
      inheritOwnersFromKubernetesClusters: false,
      inheritOwnersFromDockerHosts: false,
      inheritOwnersFromPodmanHosts: false,
      inheritOwnersFromServices: false,
    };

    serveRules("IncidentOwnerRule", [
      Object.assign(new IncidentOwnerRule(), {
        _id: "33333333-3333-4333-8333-000000000001",
        name: "Platform owns it",
        isEnabled: true,
        ownerUsers: [],
        ownerTeams: [
          Object.assign(new Team(), {
            _id: "0000000b-0000-4000-8000-000000000001",
          }),
        ],
        ...switchesOff,
      }),
      Object.assign(new IncidentOwnerRule(), {
        _id: "33333333-3333-4333-8333-000000000002",
        name: "Hosts' owners own it",
        isEnabled: true,
        ownerUsers: [],
        ownerTeams: [],
        ...switchesOff,
        inheritOwnersFromHosts: true,
      }),
      Object.assign(new IncidentOwnerRule(), {
        _id: "33333333-3333-4333-8333-000000000003",
        name: "Old rule",
        isEnabled: false,
        ownerUsers: [],
        ownerTeams: [],
        ...switchesOff,
      }),
    ]);

    await renderPage(IncidentOwnerRules);

    const oldRule: HTMLElement = await rowOf("Old rule");

    expect(
      within(oldRule).getByTestId("rule-adds-nothing"),
    ).toBeInTheDocument();
    expect(oldRule).toHaveTextContent("Disabled");
    expect(
      within(await rowOf("Platform owns it")).queryByTestId(
        "rule-adds-nothing",
      ),
    ).toBeNull();
    expect(
      within(await rowOf("Hosts' owners own it")).queryByTestId(
        "rule-adds-nothing",
      ),
    ).toBeNull();

    const select: Record<string, unknown> =
      ruleListRequest("IncidentOwnerRule").select || {};

    expect(select["ownerUsers"]).toEqual({ _id: true });
    expect(select["ownerTeams"]).toEqual({ _id: true });
    expect(select["inheritOwnersFromHosts"]).toBe(true);
  });
});
