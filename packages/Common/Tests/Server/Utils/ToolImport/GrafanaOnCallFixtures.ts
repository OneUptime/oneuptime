import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * A Grafana OnCall organisation as its HTTP API answers, in the shapes its
 * API reference (grafana.com/docs/oncall/latest/oncall-api-reference) and
 * its public API serializers document: every list is page-numbered
 * ({ count, next, previous, results, current_page_number, page_size,
 * total_pages }); a user lists the ids of their teams; a schedule is of
 * type web, calendar or ical and lists the ids of its rotations; a rotation
 * (on-call shift) gives its times without a zone - in UTC for a web
 * schedule's, in the schedule's zone for a calendar schedule's - with its
 * recurrence, its groups of people (rolling_users) and its layer priority
 * (level); an escalation chain's steps are listed together, by position.
 *
 * The organisation, at Grafana Cloud's address
 * https://oncall-prod-us-central-0.grafana.net/oncall:
 *  - three people: alice and bob on Platform, bob on Payments too, carol
 *    on no team;
 *  - Platform primary (a web schedule, shown in Berlin): office hours on
 *    weekdays (layer 2) over a weekly 24/7 rotation edited in March
 *    (layer 1) over a pair of people on call together (layer 0), plus a
 *    one-off shift and an override;
 *  - Payments API (a calendar schedule in New York): a daily 9-to-5
 *    rotation that started from its second group and ends next year, and a
 *    rotation that ended;
 *  - Legacy calendar (an iCal schedule);
 *  - two escalation chains with every kind of step.
 */

export const GRAFANA_API_URL: string =
  "https://oncall-prod-us-central-0.grafana.net/oncall";
export const GRAFANA_HOST: string = "oncall-prod-us-central-0.grafana.net";
export const GRAFANA_TOKEN: string = "4f7c2a9e1b8d3f6a0c5e7b9d2f4a6c8e";

export const ALICE_ID: string = "U1ALICE00000A";
export const BOB_ID: string = "U2BOB0000000B";
export const CAROL_ID: string = "U3CAROL00000C";

export const PLATFORM_TEAM_ID: string = "TPLATFORM0001";
export const PAYMENTS_TEAM_ID: string = "TPAYMENTS0002";

export const WEB_SCHEDULE_ID: string = "SWEBPRIMARY01";
export const CALENDAR_SCHEDULE_ID: string = "SCALPAYMENTS2";
export const ICAL_SCHEDULE_ID: string = "SICALLEGACY03";

export const CRITICAL_CHAIN_ID: string = "FCHAINCRIT001";
export const LOW_CHAIN_ID: string = "FCHAINLOW0002";

const BASE: string = `${GRAFANA_API_URL}/api/v1`;

// One page of a page-numbered list, as Grafana OnCall answers it.
export function page(
  path: string,
  results: Array<unknown>,
  data: { page?: number; totalPages?: number; count?: number } = {},
): unknown {
  const current: number = data.page ?? 1;
  const total: number = data.totalPages ?? 1;

  return {
    count: data.count ?? results.length,
    next: current < total ? `${BASE}/${path}/?page=${current + 1}` : null,
    previous: current > 1 ? `${BASE}/${path}/?page=${current - 1}` : null,
    results: results,
    page_size: 100,
    current_page_number: current,
    total_pages: total,
  };
}

function user(data: {
  id: string;
  username: string;
  email: string;
  teams: Array<string>;
}): Record<string, unknown> {
  return {
    id: data.id,
    grafana_id: 100 + data.id.length,
    email: data.email,
    slack: [],
    username: data.username,
    role: "user",
    is_phone_number_verified: true,
    timezone: "Europe/Berlin",
    teams: data.teams,
  };
}

export const GRAFANA_USERS: Array<Record<string, unknown>> = [
  user({
    id: ALICE_ID,
    username: "alice",
    email: "alice@example.com",
    teams: [PLATFORM_TEAM_ID],
  }),
  user({
    id: BOB_ID,
    username: "bob",
    email: "Bob@Example.com",
    teams: [PLATFORM_TEAM_ID, PAYMENTS_TEAM_ID],
  }),
  user({
    id: CAROL_ID,
    username: "carol",
    email: "carol@example.com",
    teams: [],
  }),
];

export const GRAFANA_TEAMS: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_TEAM_ID,
    grafana_id: 11,
    name: "Platform",
    email: "",
    avatar_url: "/avatar/3f49c15916554246daa714b9bd0ee398",
  },
  {
    id: PAYMENTS_TEAM_ID,
    grafana_id: 12,
    name: "Payments",
    email: "payments@example.com",
    avatar_url: "/avatar/1a2b3c",
  },
];

const SLACK: Record<string, unknown> = {
  channel_id: null,
  user_group_id: null,
};

export const GRAFANA_SCHEDULES: Array<Record<string, unknown>> = [
  {
    id: WEB_SCHEDULE_ID,
    team_id: PLATFORM_TEAM_ID,
    name: "Platform primary",
    type: "web",
    time_zone: "Europe/Berlin",
    slack: SLACK,
    on_call_now: [ALICE_ID],
    shifts: ["OOFFICE00001", "ONIGHTS00002", "OPAIR0000003", "OONEOFF00004"],
  },
  {
    id: CALENDAR_SCHEDULE_ID,
    team_id: PAYMENTS_TEAM_ID,
    name: "Payments API",
    type: "calendar",
    time_zone: "America/New_York",
    slack: SLACK,
    on_call_now: [CAROL_ID],
    shifts: ["OCALDAILY005", "OCALOLD00006"],
    ical_url_overrides: null,
    enable_web_overrides: false,
  },
  {
    id: ICAL_SCHEDULE_ID,
    team_id: null,
    name: "Legacy calendar",
    type: "ical",
    ical_url_primary: "https://calendar.example.com/oncall.ics",
    ical_url_overrides: null,
    slack: SLACK,
    on_call_now: [],
  },
];

export function rotation(
  data: Record<string, unknown> & { id: string; name: string; type: string },
): Record<string, unknown> {
  return {
    team_id: null,
    schedule: null,
    time_zone: null,
    level: 0,
    duration: 86400,
    ...data,
  };
}

export const GRAFANA_SHIFTS: Array<Record<string, unknown>> = [
  // Layer 2: weekday office hours, 08:00-16:00 UTC, a week each.
  rotation({
    id: "OOFFICE00001",
    schedule: WEB_SCHEDULE_ID,
    name: "Office hours",
    type: "rolling_users",
    level: 2,
    start: "2026-01-05T08:00:00",
    rotation_start: "2026-01-05T08:00:00",
    duration: 28800,
    frequency: "weekly",
    interval: 1,
    until: null,
    week_start: "MO",
    by_day: ["MO", "TU", "WE", "TH", "FR"],
    by_month: null,
    by_monthday: null,
    rolling_users: [[CAROL_ID], [ALICE_ID]],
    start_rotation_from_user_index: 0,
  }),
  // Layer 1: a weekly 24/7 rotation whose rotation was edited on March 4.
  rotation({
    id: "ONIGHTS00002",
    schedule: WEB_SCHEDULE_ID,
    name: "Night and weekend",
    type: "rolling_users",
    level: 1,
    start: "2026-01-05T08:00:00",
    rotation_start: "2026-03-04T12:00:00",
    duration: 604800,
    frequency: "weekly",
    interval: 1,
    until: null,
    week_start: "MO",
    by_day: null,
    by_month: null,
    by_monthday: null,
    rolling_users: [[ALICE_ID], [BOB_ID]],
    start_rotation_from_user_index: 0,
  }),
  // Layer 0: alice and bob on call together, every day.
  rotation({
    id: "OPAIR0000003",
    schedule: WEB_SCHEDULE_ID,
    name: "Pair support",
    type: "rolling_users",
    level: 0,
    start: "2026-01-05T00:00:00",
    rotation_start: "2026-01-05T00:00:00",
    duration: 86400,
    frequency: "daily",
    interval: 1,
    until: null,
    by_day: null,
    by_month: null,
    by_monthday: null,
    rolling_users: [[ALICE_ID, BOB_ID]],
    start_rotation_from_user_index: 0,
  }),
  rotation({
    id: "OONEOFF00004",
    schedule: WEB_SCHEDULE_ID,
    name: "Launch day",
    type: "single_event",
    level: 3,
    start: "2026-10-20T06:00:00",
    rotation_start: "2026-10-20T06:00:00",
    duration: 43200,
    users: [BOB_ID],
  }),
  // An override of the web schedule: never brought over.
  rotation({
    id: "OOVERRIDE007",
    schedule: WEB_SCHEDULE_ID,
    name: "Bob covers",
    type: "override",
    start: "2026-10-09T00:00:00",
    rotation_start: "2026-10-09T00:00:00",
    duration: 86400,
    users: [BOB_ID],
  }),
  // The calendar schedule's: times in New York.
  rotation({
    id: "OCALDAILY005",
    name: "Payments days",
    type: "rolling_users",
    team_id: PAYMENTS_TEAM_ID,
    level: 0,
    start: "2026-02-02T09:00:00",
    rotation_start: "2026-02-02T09:00:00",
    duration: 28800,
    frequency: "daily",
    interval: 1,
    until: "2027-03-01T00:00:00",
    by_day: null,
    by_month: null,
    by_monthday: null,
    rolling_users: [[BOB_ID], [CAROL_ID]],
    start_rotation_from_user_index: 1,
  }),
  rotation({
    id: "OCALOLD00006",
    name: "Old rota",
    type: "rolling_users",
    level: 0,
    start: "2025-01-06T09:00:00",
    rotation_start: "2025-01-06T09:00:00",
    duration: 604800,
    frequency: "weekly",
    interval: 1,
    until: "2026-01-01T00:00:00",
    week_start: "MO",
    by_day: null,
    by_month: null,
    by_monthday: null,
    rolling_users: [[BOB_ID]],
    start_rotation_from_user_index: 0,
  }),
];

export const GRAFANA_CHAINS: Array<Record<string, unknown>> = [
  {
    id: CRITICAL_CHAIN_ID,
    name: "Platform critical",
    team_id: PLATFORM_TEAM_ID,
  },
  { id: LOW_CHAIN_ID, name: "Low urgency", team_id: null },
];

function step(
  chain: string,
  position: number,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: `E${chain.slice(-4)}${position}`,
    escalation_chain_id: chain,
    position: position,
    ...data,
  };
}

// Out of order on purpose: steps are read by position.
export const GRAFANA_STEPS: Array<Record<string, unknown>> = [
  step(CRITICAL_CHAIN_ID, 2, { type: "wait", duration: 300 }),
  step(CRITICAL_CHAIN_ID, 0, {
    type: "notify_on_call_from_schedule",
    important: false,
    notify_on_call_from_schedule: WEB_SCHEDULE_ID,
  }),
  step(CRITICAL_CHAIN_ID, 1, {
    type: "notify_persons",
    important: true,
    persons_to_notify: [BOB_ID],
  }),
  step(CRITICAL_CHAIN_ID, 3, {
    type: "notify_team_members",
    important: false,
    team_to_notify: PLATFORM_TEAM_ID,
  }),
  step(CRITICAL_CHAIN_ID, 4, {
    type: "trigger_webhook",
    action_to_trigger: "WHSTATUSBOT01",
  }),
  step(CRITICAL_CHAIN_ID, 5, { type: "wait", duration: 600 }),
  step(CRITICAL_CHAIN_ID, 6, {
    type: "notify_person_next_each_time",
    important: false,
    persons_to_notify_next_each_time: [ALICE_ID, CAROL_ID],
  }),
  step(CRITICAL_CHAIN_ID, 7, {
    type: "notify_if_time_from_to",
    notify_if_time_from: "09:00:00Z",
    notify_if_time_to: "18:00:00Z",
  }),
  step(CRITICAL_CHAIN_ID, 8, { type: "repeat_escalation" }),
  // After the repeat: never runs.
  step(CRITICAL_CHAIN_ID, 9, { type: "notify_whole_channel" }),
  step(LOW_CHAIN_ID, 0, { type: "wait", duration: 120 }),
  step(LOW_CHAIN_ID, 1, {
    type: "notify_user_group",
    important: false,
    group_to_notify: "GSLACKGROUP01",
  }),
  step(LOW_CHAIN_ID, 2, {
    type: "notify_persons",
    important: false,
    persons_to_notify: [CAROL_ID],
  }),
  step(LOW_CHAIN_ID, 3, { type: "resolve" }),
];

// Grafana OnCall's refusal, as Django REST framework writes it.
export function grafanaError(detail: string): unknown {
  return { detail: detail };
}

/*
 * The routes of the whole organisation, under the address's path. A test
 * changes one route with FixtureApi.add, which wins over these.
 */
export function grafanaOnCallRoutes(
  basePath: string = "/oncall",
): Array<FixtureRoute> {
  return [
    {
      path: `${basePath}/api/v1/users/`,
      answers: [json(page("users", GRAFANA_USERS))],
    },
    {
      path: `${basePath}/api/v1/teams/`,
      answers: [json(page("teams", GRAFANA_TEAMS))],
    },
    {
      path: `${basePath}/api/v1/schedules/`,
      answers: [json(page("schedules", GRAFANA_SCHEDULES))],
    },
    {
      path: `${basePath}/api/v1/on_call_shifts/`,
      answers: [json(page("on_call_shifts", GRAFANA_SHIFTS))],
    },
    {
      path: `${basePath}/api/v1/escalation_chains/`,
      answers: [json(page("escalation_chains", GRAFANA_CHAINS))],
    },
    {
      path: `${basePath}/api/v1/escalation_policies/`,
      answers: [json(page("escalation_policies", GRAFANA_STEPS))],
    },
  ];
}

export function grafanaOnCallApi(basePath: string = "/oncall"): FixtureApi {
  return new FixtureApi(grafanaOnCallRoutes(basePath));
}
