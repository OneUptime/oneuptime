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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { MemoryRouter } from "react-router-dom";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import RunnerView from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/Runners/RunnerView";
import RunnerAiRuleList, {
  MAX_LISTED_AI_RULES,
  RUNNER_AI_RULES_TEST_ID,
  RunnerAiRuleRow,
  RunnerAiRulesCopy,
  getRunnerAiRuleLaneText,
  getRunnerAiRuleRoute,
  loadRunnerAiRules,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerAiRules";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Runner from "../../../Models/DatabaseModels/Runner";
import Route from "../../../Types/API/Route";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A RUNNER'S PAGE LISTS THE AI RULES THAT PICK IT (Components/Runner/
 * RunnerAiRules), in Runner Details after the code repositories that pick
 * it: the incident and alert AI rules whose Runner is this one, each linked
 * to its lane's AI settings at the AI Rules card, where the Runner is
 * changed - or one line saying where a rule picks one. Not on the
 * Kubernetes agent's in-cluster Runner, which no rule may pick, nor for a
 * reader who cannot read AI rules.
 *
 * The real page; only the model API and the permissions are stubbed.
 */

const WAIT: { timeout: number } = { timeout: 20000 };

const RUNNER_ID: string = "99999999-0000-4000-8000-000000000011";
const AGENT_RUNNER_ID: string = "99999999-0000-4000-8000-000000000012";
const CHECKOUT_RULE_ID: string = "88888888-0000-4000-8000-000000000001";
const DATABASE_RULE_ID: string = "88888888-0000-4000-8000-000000000002";

const ADMIN: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectAdmin,
];

let rules: Array<AutoRemediationRule> | Error = [];
let ruleReads: Array<Record<string, unknown>> = [];

function rule(
  id: string,
  name: string,
  triggerEntityType: AutoRemediationTriggerEntity,
): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    _id: id,
    name,
    triggerEntityType,
  });
}

function runner(id: string, name: string): Runner {
  return Object.assign(new Runner(), {
    _id: id,
    name,
    description: "",
    key: "runner-key",
    canRunRunbooks: true,
    isProjectDefault: false,
    lastAlive: new Date(),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  rules = [];
  ruleReads = [];

  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(ADMIN);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockImplementation(() => {
    return {
      projectId: new ObjectID(PROJECT_ID),
      userId: ObjectID.generate(),
      permissions: ADMIN.map((permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          _type: "UserPermission",
        };
      }),
      _type: "UserTenantAccessPermission",
    } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>;
  });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (args: unknown): Promise<Runner | null> => {
      const id: string = String((args as { id?: unknown }).id);

      if (id === AGENT_RUNNER_ID) {
        return runner(AGENT_RUNNER_ID, "kubernetes-agent/prod-eu");
      }

      return runner(RUNNER_ID, "prod-eu-west-1");
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (args: unknown): Promise<ListResult<never>> => {
      const read: { modelType: unknown } & Record<string, unknown> = args as {
        modelType: unknown;
      } & Record<string, unknown>;

      if (read.modelType === AutoRemediationRule) {
        ruleReads.push(read);

        if (rules instanceof Error) {
          throw rules;
        }

        return {
          data: rules as Array<never>,
          count: rules.length,
          skip: 0,
          limit: MAX_LISTED_AI_RULES,
        };
      }

      if (read.modelType === CodeRepository) {
        return { data: [], count: 0, skip: 0, limit: 50 };
      }

      return { data: [], count: 0, skip: 0, limit: 10 };
    });

  jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// Lets a read that has been answered (or refused) reach the page.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });
}

async function openRunnerView(runnerId: string): Promise<HTMLElement> {
  const pagePath: string = `/dashboard/${PROJECT_ID}/runbooks/runners/${runnerId}`;
  goTo(pagePath);

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter initialEntries={[pagePath]}>
        <RunnerView
          pageRoute={RouteMap[PageMap.RUNBOOKS_RUNNER_VIEW] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });

  await screen.findAllByText("Runner Details", {}, WAIT);

  return screen
    .getByText("Runner Details", { exact: true })
    .closest('[data-testid="card"]') as HTMLElement;
}

describe("reading the AI rules that pick a Runner", () => {
  test("by their Runner, by name, as many as the row lists, with the lane each belongs to", async () => {
    rules = [
      rule(
        CHECKOUT_RULE_ID,
        "Restart checkout",
        AutoRemediationTriggerEntity.Incident,
      ),
      rule(
        DATABASE_RULE_ID,
        "Fix database alerts",
        AutoRemediationTriggerEntity.Alert,
      ),
    ];

    const rows: Array<RunnerAiRuleRow> | null = await loadRunnerAiRules(
      new ObjectID(RUNNER_ID),
    );

    expect(rows).toEqual([
      {
        id: CHECKOUT_RULE_ID,
        name: "Restart checkout",
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
      },
      {
        id: DATABASE_RULE_ID,
        name: "Fix database alerts",
        triggerEntityType: AutoRemediationTriggerEntity.Alert,
      },
    ]);

    const read: Record<string, unknown> = ruleReads[0]!;

    expect(String((read["query"] as Record<string, unknown>)["runnerId"])).toBe(
      RUNNER_ID,
    );
    expect(read["select"]).toEqual({
      _id: true,
      name: true,
      triggerEntityType: true,
    });
    expect(Object.keys(read["sort"] as Record<string, unknown>)).toEqual([
      "name",
    ]);
    expect(read["limit"]).toBe(MAX_LISTED_AI_RULES);
  });

  test("a read that is refused is null - the row is left out - not an empty list", async () => {
    rules = new Error("Permission denied");

    expect(await loadRunnerAiRules(new ObjectID(RUNNER_ID))).toBe(null);
  });
});

describe("where a rule's Runner is changed", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/runbooks/runners/${RUNNER_ID}`);
  });

  test("an incident rule: Incidents › AI › Settings, at the AI Rules card", () => {
    const route: Route | null = getRunnerAiRuleRoute({
      id: CHECKOUT_RULE_ID,
      name: "Restart checkout",
      triggerEntityType: AutoRemediationTriggerEntity.Incident,
    });

    expect(route?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/incidents/ai/settings#AiRules`,
    );
  });

  test("an alert rule: Alerts › AI › Settings, at the AI Rules card", () => {
    const route: Route | null = getRunnerAiRuleRoute({
      id: DATABASE_RULE_ID,
      name: "Fix database alerts",
      triggerEntityType: AutoRemediationTriggerEntity.Alert,
    });

    expect(route?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/alerts/ai/settings#AiRules`,
    );
  });

  test("a lane that picks no Runner has no place to go, and no lane word", () => {
    const row: RunnerAiRuleRow = {
      id: CHECKOUT_RULE_ID,
      name: "Slow checkout traces",
      triggerEntityType: AutoRemediationTriggerEntity.Trace,
    };

    expect(getRunnerAiRuleRoute(row)).toBe(null);
    expect(getRunnerAiRuleLaneText(row)).toBe(null);
    expect(getRunnerAiRuleRoute({ ...row, triggerEntityType: null })).toBe(
      null,
    );
  });
});

describe("the row's value", () => {
  test("each rule a link to where its Runner is changed, its lane beside it", () => {
    goTo(`/dashboard/${PROJECT_ID}/runbooks/runners/${RUNNER_ID}`);

    render(
      <MemoryRouter>
        <RunnerAiRuleList
          rules={[
            {
              id: CHECKOUT_RULE_ID,
              name: "Restart checkout",
              triggerEntityType: AutoRemediationTriggerEntity.Incident,
            },
            {
              id: DATABASE_RULE_ID,
              name: "Restart checkout",
              triggerEntityType: AutoRemediationTriggerEntity.Alert,
            },
          ]}
        />
      </MemoryRouter>,
    );

    const list: HTMLElement = screen.getByTestId(RUNNER_AI_RULES_TEST_ID);
    const links: Array<HTMLElement> = screen.getAllByTestId(
      `${RUNNER_AI_RULES_TEST_ID}-link`,
    );
    const lanes: Array<HTMLElement> = screen.getAllByTestId(
      `${RUNNER_AI_RULES_TEST_ID}-lane`,
    );

    expect(list.tagName).toBe("UL");
    expect(links).toHaveLength(2);
    // The same name in two lanes: the lane word tells them apart.
    expect(links[0]).toHaveTextContent("Restart checkout");
    expect(lanes[0]).toHaveTextContent("Incidents");
    expect(links[0]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/ai/settings#AiRules`,
    );
    expect(links[1]).toHaveTextContent("Restart checkout");
    expect(lanes[1]).toHaveTextContent("Alerts");
    expect(links[1]).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/ai/settings#AiRules`,
    );
    expect(screen.queryByTestId(`${RUNNER_AI_RULES_TEST_ID}-empty`)).toBeNull();
  });

  test("none: one short line says so, and where a rule picks its Runner", () => {
    render(<RunnerAiRuleList rules={[]} />);

    const empty: HTMLElement = screen.getByTestId(
      `${RUNNER_AI_RULES_TEST_ID}-empty`,
    );

    expect(empty).toHaveTextContent(
      "None. An AI rule picks its Runner in its More fields, on Incidents › AI › Settings or Alerts › AI › Settings.",
    );
    expect(empty.className).toContain("text-gray-500");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("a Runner's page", () => {
  test("Runner Details lists the AI rules that pick it, after the code repositories and before the labels", async () => {
    rules = [
      rule(
        CHECKOUT_RULE_ID,
        "Restart checkout",
        AutoRemediationTriggerEntity.Incident,
      ),
    ];

    const details: HTMLElement = await openRunnerView(RUNNER_ID);

    const row: HTMLElement = await within(details).findByTestId(
      RUNNER_AI_RULES_TEST_ID,
      {},
      WAIT,
    );

    expect(within(row).getByRole("link")).toHaveTextContent("Restart checkout");
    expect(within(details).getByText(RunnerAiRulesCopy.title)).toBeVisible();

    // Its place: after the code repositories' row, before the labels.
    const titles: Array<string> = within(details)
      .getAllByText(/^(Code Repositories|AI Rules|Labels)$/)
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });

    expect(titles).toEqual(["Code Repositories", "AI Rules", "Labels"]);
  });

  test("with none, the row says where a rule picks its Runner", async () => {
    const details: HTMLElement = await openRunnerView(RUNNER_ID);

    expect(
      await within(details).findByTestId(
        `${RUNNER_AI_RULES_TEST_ID}-empty`,
        {},
        WAIT,
      ),
    ).toHaveTextContent(RunnerAiRulesCopy.empty);
  });

  test("a reader who cannot read AI rules gets no row", async () => {
    rules = new Error("Permission denied");

    const details: HTMLElement = await openRunnerView(RUNNER_ID);

    await waitFor(() => {
      expect(ruleReads.length).toBeGreaterThan(0);
    }, WAIT);
    // The repositories' row is drawn: the details have loaded.
    await within(details).findByText("Code Repositories", {}, WAIT);
    await settle();

    expect(within(details).queryByText(RunnerAiRulesCopy.title)).toBeNull();
    expect(within(details).queryByTestId(RUNNER_AI_RULES_TEST_ID)).toBeNull();
  });

  test("the Kubernetes agent's in-cluster Runner, which no rule may pick, gets no row", async () => {
    const details: HTMLElement = await openRunnerView(AGENT_RUNNER_ID);

    await waitFor(() => {
      expect(ruleReads.length).toBeGreaterThan(0);
    }, WAIT);
    await within(details).findByText("kubernetes-agent/prod-eu", {}, WAIT);
    await settle();

    expect(within(details).queryByText(RunnerAiRulesCopy.title)).toBeNull();
  });
});

describe("the words", () => {
  test("every Dashboard language has the empty line, translated", () => {
    const localesDir: string = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "App",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );
    const files: Array<string> = fs
      .readdirSync(localesDir)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      });

    expect(files).toHaveLength(17);

    for (const file of files) {
      const locale: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localesDir, file), "utf8"),
      );

      for (const key of [
        RunnerAiRulesCopy.title,
        RunnerAiRulesCopy.empty,
        "Incidents",
        "Alerts",
      ]) {
        expect([file, key, typeof locale[key]]).toEqual([file, key, "string"]);
      }

      if (file !== "en.json") {
        expect([
          file,
          locale[RunnerAiRulesCopy.empty] === RunnerAiRulesCopy.empty,
        ]).toEqual([file, false]);
      }
    }
  });
});
