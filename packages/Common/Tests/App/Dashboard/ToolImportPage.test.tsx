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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import ImportFromTool, {
  TOOL_IMPORT_POLL_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ImportFromTool";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { APIRequestOptions } from "../../../Utils/API";
import {
  ToolImportAction,
  ToolImportOutcome,
  ToolImportPlan,
  ToolImportPlanItem,
  ToolImportReportItem,
  ToolImportRunView,
} from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind, {
  getToolImportItemKey,
} from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource, {
  AllToolImportSources,
} from "../../../Types/ToolImport/ToolImportSource";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Project Settings > Import from another tool, end to end in the browser
 * against a stand-in import API: pick a tool, connect it (the region picked,
 * the key sent once and never kept), watch the read, tick what to bring
 * over, start it, watch it run and read the report - and the turns a person
 * can take: discard a preview, try a failed read again in the same region,
 * open an import from a link, wait for somebody else's.
 */

const WAIT: { timeout: number } = { timeout: 8000 };

const RUN_ID: string = "6c1f8a52-0d43-4e7b-9a55-2f0c3b9d7e10";
const OTHER_RUN_ID: string = "b7d2e9f4-1a3c-4b6d-8e0f-5a7c9b1d3e2f";
const MEMBERS_TEAM_ID: string = "1d9e8c7b-6a5f-4e3d-9c2b-0a1f2e3d4c5b";
const TEAM_RECORD_ID: string = "3a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";
const API_KEY: string = "og-5c1e0d7f-key";

const ALICE: ToolImportPlanItem = planItem(
  ToolImportResourceKind.Person,
  "alice",
  "Alice Example",
  { action: ToolImportAction.Invite },
);
const BOB: ToolImportPlanItem = planItem(
  ToolImportResourceKind.Person,
  "bob",
  "Bob Example",
  {
    action: ToolImportAction.Match,
    isSelectable: false,
    isSelectedByDefault: false,
  },
);
const PLATFORM: ToolImportPlanItem = planItem(
  ToolImportResourceKind.Team,
  "platform",
  "Platform",
  { references: [ALICE.key, BOB.key] },
);
const PRIMARY: ToolImportPlanItem = planItem(
  ToolImportResourceKind.OnCallSchedule,
  "primary",
  "Primary rota",
);

const PLAN: ToolImportPlan = {
  source: ToolImportSource.OpsGenie,
  accountName: "acme",
  readAt: "2026-10-08T10:00:00.000Z",
  items: [ALICE, BOB, PLATFORM, PRIMARY],
  inviteTeams: [{ id: MEMBERS_TEAM_ID, name: "Members" }],
  defaultInviteTeamId: MEMBERS_TEAM_ID,
  notes: [],
};

function planItem(
  kind: ToolImportResourceKind,
  sourceId: string,
  name: string,
  data: Partial<ToolImportPlanItem> = {},
): ToolImportPlanItem {
  return {
    key: getToolImportItemKey(kind, sourceId),
    kind,
    sourceId,
    name,
    action: ToolImportAction.Create,
    notes: [],
    isSelectable: true,
    isSelectedByDefault: true,
    summary: {},
    references: [],
    ...data,
  };
}

function runView(data: Partial<ToolImportRunView>): ToolImportRunView {
  return {
    id: RUN_ID,
    source: ToolImportSource.OpsGenie,
    status: ToolImportRunStatus.Reading,
    createdAt: "2026-10-08T10:00:00.000Z",
    createdByUserName: "Sam Admin",
    isMine: true,
    ...data,
  };
}

function reportItem(
  item: ToolImportPlanItem,
  outcome: ToolImportOutcome,
  recordIds: Array<string>,
): ToolImportReportItem {
  return {
    key: item.key,
    kind: item.kind,
    sourceId: item.sourceId,
    name: item.name,
    outcome,
    recordIds,
    notes: [],
  };
}

type Answer = JSONObject | HTTPErrorResponse;

/*
 * The stand-in import API. The list of runs, and for each run a sequence of
 * answers (the last one repeats), as the server would give them while a
 * worker moves the run along.
 */
interface FakeImportApi {
  runs: Array<ToolImportRunView>;
  runAnswers: Map<string, Array<Answer>>;
  readAnswer: Answer;
  gets: Array<string>;
  posts: Array<{ route: string; body: JSONObject }>;
}

let server: FakeImportApi;

function routeOf(url: URL): string {
  return url.toString().replace(/^.*\/api/, "");
}

function respond(answer: Answer): HTTPResponse<JSONObject> | HTTPErrorResponse {
  return answer instanceof HTTPErrorResponse
    ? answer
    : new HTTPResponse<JSONObject>(200, answer, {});
}

function notFound(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(404, { message }, {});
}

function answerRun(runId: string, ...answers: Array<Answer>): void {
  server.runAnswers.set(runId, answers);
}

function details(run: ToolImportRunView, extra: JSONObject = {}): JSONObject {
  return { run: run as unknown as JSONObject, ...extra };
}

beforeEach(() => {
  server = {
    runs: [],
    runAnswers: new Map(),
    readAnswer: { runId: RUN_ID },
    gets: [],
    posts: [],
  };

  goTo(`/dashboard/${PROJECT_ID}/settings/import`);
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});

  jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        options: APIRequestOptions,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const route: string = routeOf(options.url);
        server.gets.push(route);

        if (route === "/tool-import/runs") {
          return respond({ runs: server.runs as unknown as JSONObject[] });
        }

        const runId: string = route.replace("/tool-import/run/", "");
        const answers: Array<Answer> | undefined = server.runAnswers.get(runId);

        if (!answers || answers.length === 0) {
          return notFound("This import was not found.");
        }

        return respond(answers.length > 1 ? answers.shift()! : answers[0]!);
      },
    );

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: APIRequestOptions,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const route: string = routeOf(options.url);
        server.posts.push({
          route,
          body: (options.data || {}) as JSONObject,
        });

        if (route === "/tool-import/read") {
          return respond(server.readAnswer);
        }

        return respond({});
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<RenderResult> {
  const view: RenderResult = render(
    <MemoryRouter>
      <ImportFromTool
        pageRoute={RouteMap[PageMap.SETTINGS_IMPORT_FROM_TOOL] as Route}
        currentProject={null}
        hasPaymentMethod={false}
      />
    </MemoryRouter>,
  );

  await act(async () => {
    await Promise.resolve();
  });

  return view;
}

function runQueryParam(): string | null {
  return new URLSearchParams(window.location.search).get("run");
}

async function pickTool(source: ToolImportSource): Promise<void> {
  fireEvent.click(
    await screen.findByTestId(`tool-import-pick-${source}`, {}, WAIT),
  );
  await screen.findByTestId("tool-import-connect", {}, WAIT);
}

function regionRadio(value: string): HTMLInputElement {
  return within(screen.getByTestId(`tool-import-region-${value}`)).getByRole(
    "radio",
  ) as HTMLInputElement;
}

function ticked(item: ToolImportPlanItem): boolean {
  return (
    screen.getByTestId(`tool-import-tick-${item.key}`) as HTMLInputElement
  ).checked;
}

describe("starting an import", () => {
  test("with nothing in flight, the page opens on the tool picker and lists earlier imports", async () => {
    server.runs = [
      runView({
        id: OTHER_RUN_ID,
        status: ToolImportRunStatus.Completed,
        accountName: "acme",
        counts: {
          [ToolImportOutcome.Created]: 12,
          [ToolImportOutcome.Invited]: 3,
          [ToolImportOutcome.Matched]: 0,
          [ToolImportOutcome.AlreadyImported]: 0,
          [ToolImportOutcome.Skipped]: 0,
          [ToolImportOutcome.Failed]: 0,
        },
      }),
    ];

    await renderPage();

    await screen.findByTestId("tool-import-picker", {}, WAIT);
    for (const source of AllToolImportSources) {
      expect(screen.getByTestId(`tool-import-pick-${source}`)).toBeVisible();
    }

    const history: HTMLElement = screen.getByTestId(
      `tool-import-history-${OTHER_RUN_ID}`,
    );
    expect(history).toHaveTextContent("Opsgenie · acme");
    expect(history).toHaveTextContent("12 created");
    expect(history).toHaveTextContent("3 invited");
    expect(runQueryParam()).toBeNull();
  });

  test("connecting Opsgenie sends the tool, the picked region and the key once, and the key is not kept on the page", async () => {
    answerRun(
      RUN_ID,
      details(runView({ status: ToolImportRunStatus.Reading })),
    );

    await renderPage();
    await pickTool(ToolImportSource.OpsGenie);

    // The region is picked, never typed: the US to start with.
    expect(regionRadio("US").checked).toBe(true);
    expect(regionRadio("EU").checked).toBe(false);

    // No key, no read.
    fireEvent.click(screen.getByTestId("tool-import-read"));
    expect(
      await screen.findByText("Paste your Opsgenie API key.", {}, WAIT),
    ).toBeVisible();
    expect(server.posts).toEqual([]);

    fireEvent.click(regionRadio("EU"));
    expect(regionRadio("EU").checked).toBe(true);
    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: `  ${API_KEY}  ` },
    });
    expect(screen.getByTestId("tool-import-api-key")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByTestId("tool-import-read"));

    expect(
      await screen.findByText("Reading your Opsgenie account", {}, WAIT),
    ).toBeVisible();
    expect(server.posts).toEqual([
      {
        route: "/tool-import/read",
        body: { source: "OpsGenie", region: "EU", apiKey: API_KEY },
      },
    ]);
    expect(runQueryParam()).toBe(RUN_ID);
    expect(document.body.innerHTML).not.toContain(API_KEY);
    expect(screen.queryByTestId("tool-import-api-key")).not.toBeInTheDocument();
  });

  test("a read the server refuses says why, and keeps the form to fix it", async () => {
    server.readAnswer = new HTTPErrorResponse(
      400,
      { message: "Choose one of Opsgenie's regions." },
      {},
    );

    await renderPage();
    await pickTool(ToolImportSource.OpsGenie);
    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    expect(
      await screen.findByText("Choose one of Opsgenie's regions.", {}, WAIT),
    ).toBeVisible();
    expect(screen.getByTestId("tool-import-connect")).toBeVisible();
    expect(runQueryParam()).toBeNull();
  });

  test("incident.io has one API, so nobody is asked for a region", async () => {
    answerRun(
      RUN_ID,
      details(
        runView({
          source: ToolImportSource.IncidentIo,
          status: ToolImportRunStatus.Reading,
        }),
      ),
    );

    await renderPage();
    await pickTool(ToolImportSource.IncidentIo);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("incident.io API key")).toBeVisible();

    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    await screen.findByTestId("tool-import-progress", {}, WAIT);
    expect(server.posts[0]).toEqual({
      route: "/tool-import/read",
      body: { source: "IncidentIo", region: "", apiKey: API_KEY },
    });
  });

  test("PagerDuty asks which region the account is in, and sends the one picked with the key", async () => {
    answerRun(
      RUN_ID,
      details(
        runView({
          source: ToolImportSource.PagerDuty,
          status: ToolImportRunStatus.Reading,
        }),
      ),
    );

    await renderPage();
    await pickTool(ToolImportSource.PagerDuty);

    expect(screen.getByText("Where is your PagerDuty account?")).toBeVisible();
    expect(regionRadio("US").checked).toBe(true);
    expect(
      screen.getByText("You sign in at yourcompany.eu.pagerduty.com."),
    ).toBeVisible();
    expect(screen.queryByTestId("tool-import-api-key-id")).toBeNull();
    expect(screen.queryByTestId("tool-import-api-url")).toBeNull();

    fireEvent.click(regionRadio("EU"));
    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    await screen.findByTestId("tool-import-progress", {}, WAIT);
    expect(server.posts).toEqual([
      {
        route: "/tool-import/read",
        body: { source: "PagerDuty", region: "EU", apiKey: API_KEY },
      },
    ]);
  });

  test("Splunk On-Call asks for its API ID before the key, checks both, and sends both", async () => {
    answerRun(
      RUN_ID,
      details(
        runView({
          source: ToolImportSource.SplunkOnCall,
          status: ToolImportRunStatus.Reading,
        }),
      ),
    );

    await renderPage();
    await pickTool(ToolImportSource.SplunkOnCall);

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();

    const id: HTMLInputElement = screen.getByTestId(
      "tool-import-api-key-id",
    ) as HTMLInputElement;
    const key: HTMLInputElement = screen.getByTestId(
      "tool-import-api-key",
    ) as HTMLInputElement;

    // The ID comes first, is a plain field, and is named for the tool.
    expect(
      id.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(id).toHaveAttribute("type", "text");
    expect(key).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Splunk On-Call API ID")).toBe(id);
    expect(screen.getByLabelText("Splunk On-Call API key")).toBe(key);

    // Nothing given: both are asked for, and nothing is sent.
    fireEvent.click(screen.getByTestId("tool-import-read"));
    expect(
      await screen.findByText("Paste your Splunk On-Call API ID.", {}, WAIT),
    ).toBeVisible();
    expect(
      screen.getByText("Paste your Splunk On-Call API key."),
    ).toBeVisible();

    fireEvent.change(id, { target: { value: "two words" } });
    fireEvent.change(key, { target: { value: API_KEY } });
    fireEvent.click(screen.getByTestId("tool-import-read"));
    expect(
      await screen.findByText(
        "That does not look like your Splunk On-Call API ID. Paste the ID on its own.",
        {},
        WAIT,
      ),
    ).toBeVisible();
    expect(server.posts).toEqual([]);

    fireEvent.change(id, { target: { value: " 8f2a6c1e " } });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    await screen.findByTestId("tool-import-progress", {}, WAIT);
    expect(server.posts).toEqual([
      {
        route: "/tool-import/read",
        body: {
          source: "SplunkOnCall",
          region: "",
          apiKey: API_KEY,
          apiKeyId: "8f2a6c1e",
        },
      },
    ]);
    expect(document.body.innerHTML).not.toContain(API_KEY);
  });

  test("Grafana OnCall asks for its API URL, with Grafana Cloud's as the example, and sends it with the key", async () => {
    answerRun(
      RUN_ID,
      details(
        runView({
          source: ToolImportSource.GrafanaOnCall,
          status: ToolImportRunStatus.Reading,
        }),
      ),
    );

    await renderPage();
    await pickTool(ToolImportSource.GrafanaOnCall);

    const url: HTMLInputElement = screen.getByLabelText(
      "Grafana OnCall API URL",
    ) as HTMLInputElement;

    expect(url).toBe(screen.getByTestId("tool-import-api-url"));
    expect(url).toHaveAttribute(
      "placeholder",
      "https://oncall-prod-us-central-0.grafana.net/oncall",
    );
    expect(url).toHaveAttribute("type", "url");
    expect(screen.getByLabelText("Grafana OnCall API key")).toBe(
      screen.getByTestId("tool-import-api-key"),
    );

    fireEvent.change(url, { target: { value: "oncall.example.com" } });
    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));
    expect(
      await screen.findByText(
        "That does not look like your Grafana OnCall API URL. Copy it from Grafana OnCall's settings.",
        {},
        WAIT,
      ),
    ).toBeVisible();
    expect(server.posts).toEqual([]);

    fireEvent.change(url, {
      target: {
        value: "https://oncall-prod-us-central-0.grafana.net/oncall ",
      },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    await screen.findByTestId("tool-import-progress", {}, WAIT);
    expect(server.posts).toEqual([
      {
        route: "/tool-import/read",
        body: {
          source: "GrafanaOnCall",
          region: "",
          apiKey: API_KEY,
          apiUrl: "https://oncall-prod-us-central-0.grafana.net/oncall",
        },
      },
    ]);
  });

  test("trying a failed read again keeps the address and the ID given, never the key", async () => {
    const failed: ToolImportRunView = runView({
      source: ToolImportSource.GrafanaOnCall,
      status: ToolImportRunStatus.Failed,
      error: "Grafana OnCall host oncall.acme.example could not be reached.",
    });
    answerRun(RUN_ID, details(failed));

    await renderPage();
    await pickTool(ToolImportSource.GrafanaOnCall);

    fireEvent.change(screen.getByTestId("tool-import-api-url"), {
      target: { value: "https://oncall.acme.example" },
    });
    fireEvent.change(screen.getByTestId("tool-import-api-key"), {
      target: { value: API_KEY },
    });
    fireEvent.click(screen.getByTestId("tool-import-read"));

    expect(
      await screen.findByText(
        "Grafana OnCall host oncall.acme.example could not be reached.",
        {},
        WAIT,
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("tool-import-try-again"));

    await screen.findByTestId("tool-import-connect", {}, WAIT);
    expect(
      (screen.getByTestId("tool-import-api-url") as HTMLInputElement).value,
    ).toBe("https://oncall.acme.example");
    expect(
      (screen.getByTestId("tool-import-api-key") as HTMLInputElement).value,
    ).toBe("");
    expect(document.body.innerHTML).not.toContain(API_KEY);

    // Another tool starts empty.
    fireEvent.click(screen.getByTestId("tool-import-back"));
    await pickTool(ToolImportSource.SplunkOnCall);
    expect(
      (screen.getByTestId("tool-import-api-key-id") as HTMLInputElement).value,
    ).toBe("");
  });
});

describe("a run from read to report", () => {
  test("the page asks again while the run reads, then shows what was found; starting sends the ticked keys and the team new people join", async () => {
    const reading: ToolImportRunView = runView({
      status: ToolImportRunStatus.Reading,
    });
    server.runs = [reading];
    answerRun(
      RUN_ID,
      details(reading),
      details(runView({ status: ToolImportRunStatus.ReadyToReview }), {
        plan: PLAN as unknown as JSONObject,
      }),
    );

    await renderPage();

    // The person's own run in flight is the one the page opens on.
    await screen.findByTestId("tool-import-progress", {}, WAIT);
    expect(runQueryParam()).toBe(RUN_ID);

    await screen.findByTestId(
      "tool-import-review",
      {},
      {
        timeout: TOOL_IMPORT_POLL_INTERVAL_MS + WAIT.timeout,
      },
    );

    // What would be created starts ticked; what is in OneUptime cannot be.
    expect(ticked(ALICE)).toBe(true);
    expect(ticked(PLATFORM)).toBe(true);
    expect(ticked(PRIMARY)).toBe(true);
    expect(
      screen.queryByTestId(`tool-import-tick-${BOB.key}`),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tool-import-ticked-count")).toHaveTextContent(
      "3 of 3 ticked",
    );

    fireEvent.click(screen.getByTestId(`tool-import-tick-${PRIMARY.key}`));
    expect(screen.getByTestId("tool-import-ticked-count")).toHaveTextContent(
      "2 of 3 ticked",
    );

    answerRun(
      RUN_ID,
      details(
        runView({
          status: ToolImportRunStatus.Importing,
          progress: {
            done: 1,
            total: 2,
            kind: ToolImportResourceKind.Team,
          },
        }),
      ),
      details(runView({ status: ToolImportRunStatus.Completed }), {
        report: {
          items: [
            reportItem(PLATFORM, ToolImportOutcome.Created, [TEAM_RECORD_ID]),
            reportItem(ALICE, ToolImportOutcome.Invited, []),
          ],
        } as unknown as JSONObject,
      }),
    );

    fireEvent.click(screen.getByTestId("tool-import-start"));

    expect(
      await screen.findByText(
        "Bringing your team over from Opsgenie",
        {},
        WAIT,
      ),
    ).toBeVisible();
    expect(screen.getByTestId("tool-import-now")).toHaveTextContent(
      "Now bringing over teams.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(server.posts).toEqual([
      {
        route: `/tool-import/run/${RUN_ID}/start`,
        body: {
          selectedKeys: [ALICE.key, PLATFORM.key],
          inviteTeamId: MEMBERS_TEAM_ID,
        },
      },
    ]);

    const runListsBefore: number = server.gets.filter((route: string) => {
      return route === "/tool-import/runs";
    }).length;

    const headline: HTMLElement = await screen.findByTestId(
      "tool-import-report-headline",
      {},
      { timeout: TOOL_IMPORT_POLL_INTERVAL_MS + WAIT.timeout },
    );
    expect(headline).toHaveTextContent("The import from Opsgenie is done");
    expect(screen.getByTestId("tool-import-report-counts")).toHaveTextContent(
      "1 created",
    );

    // Every record links to what it became.
    const team: HTMLElement = screen.getByTestId(
      `tool-import-report-item-${PLATFORM.key}`,
    );
    expect(
      within(team).getByRole("link", { name: "Platform" }),
    ).toHaveAttribute("href", expect.stringContaining(TEAM_RECORD_ID));
    expect(screen.getByTestId("tool-import-finish")).toBeVisible();

    // Once the run settles, the list is asked for again to show how it ended.
    expect(
      server.gets.filter((route: string) => {
        return route === "/tool-import/runs";
      }).length,
    ).toBeGreaterThan(runListsBefore);
  }, 40000);

  test("a ticked item that uses something left unticked says so, and Tick them too ticks it", async () => {
    server.runs = [runView({ status: ToolImportRunStatus.ReadyToReview })];
    answerRun(
      RUN_ID,
      details(runView({ status: ToolImportRunStatus.ReadyToReview }), {
        plan: PLAN as unknown as JSONObject,
      }),
    );

    await renderPage();
    await screen.findByTestId("tool-import-review", {}, WAIT);

    expect(
      screen.queryByTestId(`tool-import-left-out-${PLATFORM.key}`),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`tool-import-tick-${ALICE.key}`));

    // Bob is in OneUptime already, so only Alice is left out.
    const leftOut: HTMLElement = screen.getByTestId(
      `tool-import-left-out-${PLATFORM.key}`,
    );
    expect(leftOut).toHaveTextContent("Alice Example");
    expect(leftOut).not.toHaveTextContent("Bob Example");

    fireEvent.click(
      screen.getByTestId(`tool-import-tick-left-out-${PLATFORM.key}`),
    );

    expect(ticked(ALICE)).toBe(true);
    expect(
      screen.queryByTestId(`tool-import-left-out-${PLATFORM.key}`),
    ).not.toBeInTheDocument();
  });

  test("with nobody new ticked, nobody is invited and no team is asked for", async () => {
    server.runs = [runView({ status: ToolImportRunStatus.ReadyToReview })];
    answerRun(
      RUN_ID,
      details(runView({ status: ToolImportRunStatus.ReadyToReview }), {
        plan: PLAN as unknown as JSONObject,
      }),
    );

    await renderPage();
    await screen.findByTestId("tool-import-review", {}, WAIT);

    expect(screen.getByText("Invite new people to")).toBeVisible();
    fireEvent.click(screen.getByTestId(`tool-import-tick-${ALICE.key}`));
    expect(screen.queryByText("Invite new people to")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tool-import-start"));

    await screen.findByTestId("tool-import-review", {}, WAIT);
    await act(async () => {
      await Promise.resolve();
    });
    expect(server.posts[0]).toEqual({
      route: `/tool-import/run/${RUN_ID}/start`,
      body: {
        selectedKeys: [PLATFORM.key, PRIMARY.key],
        inviteTeamId: null,
      },
    });
  });

  test("Discard throws the preview away and goes back to the tool picker", async () => {
    server.runs = [runView({ status: ToolImportRunStatus.ReadyToReview })];
    answerRun(
      RUN_ID,
      details(runView({ status: ToolImportRunStatus.ReadyToReview }), {
        plan: PLAN as unknown as JSONObject,
      }),
    );

    await renderPage();
    await screen.findByTestId("tool-import-review", {}, WAIT);
    expect(runQueryParam()).toBe(RUN_ID);

    fireEvent.click(screen.getByTestId("tool-import-discard"));

    await screen.findByTestId("tool-import-picker", {}, WAIT);
    expect(server.posts).toEqual([
      { route: `/tool-import/run/${RUN_ID}/cancel`, body: {} },
    ]);
    expect(runQueryParam()).toBeNull();
  });

  test("a failed read says why, and Try again opens the same tool in the same region", async () => {
    const failed: ToolImportRunView = runView({
      status: ToolImportRunStatus.Failed,
      region: "EU",
      error:
        "Opsgenie did not accept the API key. Check that you copied the whole key, that it is a key from API key management with Read and Configuration access, and that you picked the region your Opsgenie account is in.",
    });
    server.runs = [failed];
    answerRun(RUN_ID, details(failed));
    goTo(`/dashboard/${PROJECT_ID}/settings/import?run=${RUN_ID}`);

    await renderPage();

    expect(
      await screen.findByText("Reading Opsgenie did not work", {}, WAIT),
    ).toBeVisible();
    expect(screen.getByTestId("tool-import-run-error")).toHaveTextContent(
      "Opsgenie did not accept the API key.",
    );

    fireEvent.click(screen.getByTestId("tool-import-try-again"));

    await screen.findByTestId("tool-import-connect", {}, WAIT);
    expect(regionRadio("EU").checked).toBe(true);
    expect(
      (screen.getByTestId("tool-import-api-key") as HTMLInputElement).value,
    ).toBe("");
    expect(runQueryParam()).toBeNull();
  });
});

describe("imports other people run, and links", () => {
  test("somebody else's import in progress is shown, and a read of one's own waits for it", async () => {
    const theirs: ToolImportRunView = runView({
      id: OTHER_RUN_ID,
      status: ToolImportRunStatus.Importing,
      isMine: false,
      createdByUserName: "Dana Owner",
    });
    const mine: ToolImportRunView = runView({
      status: ToolImportRunStatus.Completed,
    });
    server.runs = [theirs, mine];
    answerRun(OTHER_RUN_ID, details(theirs));
    answerRun(RUN_ID, details(mine, { report: { items: [] } }));

    await renderPage();

    expect(
      await screen.findByText(
        "Dana Owner is importing from Opsgenie",
        {},
        WAIT,
      ),
    ).toBeVisible();
    expect(runQueryParam()).toBe(OTHER_RUN_ID);

    // Their run is the one shown, so the list offers only the person's own.
    expect(
      screen.queryByTestId(`tool-import-history-open-${OTHER_RUN_ID}`),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`tool-import-history-open-${RUN_ID}`));
    fireEvent.click(
      await screen.findByTestId("tool-import-start-another", {}, WAIT),
    );
    await pickTool(ToolImportSource.IncidentIo);

    expect(screen.getByTestId("tool-import-blocked")).toHaveTextContent(
      "Dana Owner is importing from Opsgenie now. One import runs at a time, so start yours when it finishes.",
    );
    expect(screen.getByTestId("tool-import-read")).toBeDisabled();
  });

  test("somebody else's preview is theirs to start: the page says so and offers a new import", async () => {
    const theirs: ToolImportRunView = runView({
      status: ToolImportRunStatus.ReadyToReview,
      isMine: false,
      createdByUserName: "Dana Owner",
    });
    server.runs = [theirs];
    answerRun(RUN_ID, details(theirs));
    goTo(`/dashboard/${PROJECT_ID}/settings/import?run=${RUN_ID}`);

    await renderPage();

    expect(
      await screen.findByTestId("tool-import-waiting", {}, WAIT),
    ).toHaveTextContent(
      "Dana Owner read Opsgenie and has not started the import yet.",
    );
    expect(screen.queryByTestId("tool-import-review")).not.toBeInTheDocument();
  });

  test("a link to an import that is gone says so, and offers a new import", async () => {
    server.runs = [runView({ status: ToolImportRunStatus.Completed })];
    goTo(`/dashboard/${PROJECT_ID}/settings/import?run=${RUN_ID}`);

    await renderPage();

    expect(
      await screen.findByText("This import was not found.", {}, WAIT),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("tool-import-start-another"));
    await screen.findByTestId("tool-import-picker", {}, WAIT);
  });

  test("a link to an import the list does not have opens the tool picker", async () => {
    goTo(`/dashboard/${PROJECT_ID}/settings/import?run=${OTHER_RUN_ID}`);

    await renderPage();

    await screen.findByTestId("tool-import-picker", {}, WAIT);
    expect(server.gets).toEqual(["/tool-import/runs"]);
    expect(runQueryParam()).toBeNull();
  });
});
