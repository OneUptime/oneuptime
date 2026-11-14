import { JSONObject } from "../../../../Types/JSON";

/*
 * A FIXED LIST OF SETUP REQUESTS, AND THE PLAN EACH SHOULD BECOME (issue
 * #6829).
 *
 * "Tests: ... a fixed list of setup requests that is re-run against a
 * model." Each entry is a request a person types into Ask AI, the project it
 * is asked in, and the calls a good answer proposes - in one answer, so they
 * share one approval card. AskAiSetupRequests.test.ts checks the list
 * offline against the toolbox (every call names a tool, every argument is
 * one its schema takes, a plan is proposed whole and runs in its plan's
 * order, a project that pages people already gets no second policy). A
 * runner that asks a live model each request and grades its calls against
 * these is a follow-up; this list is what it replays.
 *
 * `arguments` holds what the calls must say: a model may add an argument the
 * schema takes (a name it was given, isApi: false), never contradict one.
 */

export enum SetupRequestProject {
  // A new project: no on-call policy and no on-call rule yet.
  PagesNobody = "PagesNobody",
  // A project whose on-call policies and rules page people already.
  PagesPeople = "PagesPeople",
}

export interface ExpectedSetupCall {
  tool: string;
  arguments: JSONObject;
}

export interface SetupRequest {
  request: string;
  project: SetupRequestProject;
  expected: Array<ExpectedSetupCall>;
  // Why, when it is not plain from the calls.
  note?: string | undefined;
}

export const ASK_AI_SETUP_REQUESTS: ReadonlyArray<SetupRequest> = [
  {
    request: "Monitor example.com every minute and text me if it is down.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "example.com", checkEveryMinutes: 1 },
      },
      { tool: "set_up_paging", arguments: { reachMeBy: ["sms"] } },
    ],
    note: "The issue's own sentence: one plan, one approval, an SMS the card says is missing until the number is verified.",
  },
  {
    request: "Monitor example.com every minute and text me if it is down.",
    project: SetupRequestProject.PagesPeople,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "example.com", checkEveryMinutes: 1 },
      },
    ],
    note: "The project's own policies and rules decide who is paged: no second policy, and who_is_told says who it reaches once the monitor exists.",
  },
  {
    request: "Tell me when https://api.acme.example/health stops answering.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: {
          address: "https://api.acme.example/health",
          isApi: true,
        },
      },
      { tool: "set_up_paging", arguments: {} },
    ],
  },
  {
    request: "Watch acme.example and call me if it goes down.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "acme.example" },
      },
      { tool: "set_up_paging", arguments: { reachMeBy: ["call"] } },
    ],
  },
  {
    request: "Notify my phone if shop.acme.example is down.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "shop.acme.example" },
      },
      { tool: "set_up_paging", arguments: { reachMeBy: ["push"] } },
    ],
  },
  {
    request: "Page me and Ana Lopez when checkout.acme.example fails.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "checkout.acme.example" },
      },
      { tool: "set_up_paging", arguments: { alsoPage: ["Ana Lopez"] } },
    ],
  },
  {
    request: "If status.acme.example is down, page the Platform team, not me.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "status.acme.example" },
      },
      {
        tool: "set_up_paging",
        arguments: { includeMe: false, teams: ["Platform"] },
      },
    ],
  },
  {
    request: "Publish a status page that shows our API and Website monitors.",
    project: SetupRequestProject.PagesPeople,
    expected: [
      {
        tool: "publish_status_page",
        arguments: { monitors: ["API", "Website"] },
      },
    ],
  },
  {
    request: "Monitor docs.acme.example and put it on our Acme Status page.",
    project: SetupRequestProject.PagesPeople,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "docs.acme.example" },
      },
      {
        tool: "add_monitors_to_status_page",
        arguments: {
          statusPage: "Acme Status",
          monitors: ["docs.acme.example"],
        },
      },
    ],
  },
  {
    request:
      "Set up a status page called Acme Uptime showing example.com, and monitor example.com.",
    project: SetupRequestProject.PagesPeople,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "example.com" },
      },
      {
        tool: "publish_status_page",
        arguments: { name: "Acme Uptime", monitors: ["example.com"] },
      },
    ],
    note: "The status page names the monitor its plan sets up; once approved, the monitor is made first.",
  },
  {
    request: "Add the API monitor to the Acme Status page.",
    project: SetupRequestProject.PagesPeople,
    expected: [
      {
        tool: "add_monitors_to_status_page",
        arguments: { statusPage: "Acme Status", monitors: ["API"] },
      },
    ],
  },
  {
    request: "Who is told when example.com goes down?",
    project: SetupRequestProject.PagesPeople,
    expected: [{ tool: "who_is_told", arguments: { monitor: "example.com" } }],
    note: "A read, from #6810's resolver: it needs no approval.",
  },
  {
    request: "Alert me when memory on test01 goes above 75%.",
    project: SetupRequestProject.PagesPeople,
    expected: [],
    note: "A metric threshold is a Host monitor a person creates: no setup action makes one, and the answer says so.",
  },
  {
    request: "Überwache example.com und schick mir eine SMS, wenn es ausfällt.",
    project: SetupRequestProject.PagesNobody,
    expected: [
      {
        tool: "set_up_website_monitoring",
        arguments: { address: "example.com" },
      },
      { tool: "set_up_paging", arguments: { reachMeBy: ["sms"] } },
    ],
    note: "In German: the same plan, answered in German.",
  },
];
