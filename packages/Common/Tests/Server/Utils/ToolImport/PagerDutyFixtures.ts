import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * A PagerDuty account as its REST API v2 answers, in the shapes PagerDuty's
 * OpenAPI definition (github.com/PagerDuty/api-schema,
 * reference/REST/openapiv3.json) documents: every list wraps its records in
 * a field named after them, with `limit`, `offset`, `more` and `total`
 * beside it; a record names another by a reference ({ id, type, summary,
 * self, html_url }); a schedule lists its layers highest first; errors are
 * { error: { message, code, errors } }. The ids are PagerDuty's own
 * seven-character ids.
 *
 * The account (acme.pagerduty.com):
 *  - three people: Alice and Bob on Platform, Bob on Payments too, Carol on
 *    no team;
 *  - two teams;
 *  - three schedules: Primary (New York) with a weekend layer over a daily
 *    layer and a layer that ended; Business hours (London) with a 9-to-6
 *    layer that ends next year and a layer that only takes over in November;
 *    Backup, which the list gives without its layers (read on its own), with
 *    a 12-hour layer;
 *  - two escalation policies: Platform's (a schedule, then Bob and someone
 *    who is gone, in turn; it loops twice) and one that only pages a
 *    shift-based schedule;
 *  - two services, one of them disabled;
 *  - one shift-based (v3) schedule.
 */

export const PAGERDUTY_KEY: string = "u+Zx3pQe7fJk2wVnR9sT";

export const ALICE_ID: string = "PALICE1";
export const BOB_ID: string = "PBOB002";
export const CAROL_ID: string = "PCAROL3";
export const GONE_USER_ID: string = "PGONE99";

export const PLATFORM_TEAM_ID: string = "PTEAM01";
export const PAYMENTS_TEAM_ID: string = "PTEAM02";

export const PRIMARY_SCHEDULE_ID: string = "PSCHED1";
export const BUSINESS_SCHEDULE_ID: string = "PSCHED2";
export const BACKUP_SCHEDULE_ID: string = "PSCHED3";
export const SHIFT_BASED_SCHEDULE_ID: string = "PV3SCH1";

export const PLATFORM_POLICY_ID: string = "PEP0001";
export const SHIFT_BASED_POLICY_ID: string = "PEP0002";

export const CHECKOUT_SERVICE_ID: string = "PSVC001";
export const LEGACY_SERVICE_ID: string = "PSVC002";

const API: string = "https://api.pagerduty.com";
const WEB: string = "https://acme.pagerduty.com";

export function reference(
  type: string,
  id: string,
  summary: string,
  path: string,
): Record<string, unknown> {
  return {
    id: id,
    type: type,
    summary: summary,
    self: `${API}/${path}/${id}`,
    html_url: `${WEB}/${path}/${id}`,
  };
}

function teamReference(id: string, name: string): Record<string, unknown> {
  return reference("team_reference", id, name, "teams");
}

function userReference(id: string, name: string): Record<string, unknown> {
  return reference("user_reference", id, name, "users");
}

export function pagerDutyUser(data: {
  id: string;
  name: string;
  email: string;
  teams: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    id: data.id,
    type: "user",
    summary: data.name,
    self: `${API}/users/${data.id}`,
    html_url: `${WEB}/users/${data.id}`,
    name: data.name,
    email: data.email,
    time_zone: "America/New_York",
    color: "green",
    role: "user",
    avatar_url: "https://pd-static-assets.pagerduty.com/users/blank-avatar.png",
    description: "",
    invitation_sent: false,
    created_via_sso: false,
    job_title: "Engineer",
    contact_methods: [
      {
        id: `PCM${data.id.slice(-4)}`,
        type: "email_contact_method_reference",
        summary: "Default",
        self: `${API}/users/${data.id}/contact_methods/PCM${data.id.slice(-4)}`,
      },
    ],
    notification_rules: [],
    teams: data.teams,
  };
}

export const PAGERDUTY_USERS: Array<Record<string, unknown>> = [
  pagerDutyUser({
    id: ALICE_ID,
    name: "Alice Wong",
    email: "Alice@Example.com",
    teams: [teamReference(PLATFORM_TEAM_ID, "Platform")],
  }),
  pagerDutyUser({
    id: BOB_ID,
    name: "Bob Marley",
    email: "bob@example.com",
    teams: [
      teamReference(PLATFORM_TEAM_ID, "Platform"),
      teamReference(PAYMENTS_TEAM_ID, "Payments"),
    ],
  }),
  pagerDutyUser({
    id: CAROL_ID,
    name: "Carol Jones",
    email: "carol@example.com",
    teams: [],
  }),
];

export const PAGERDUTY_TEAMS: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_TEAM_ID,
    type: "team",
    summary: "Platform",
    self: `${API}/teams/${PLATFORM_TEAM_ID}`,
    html_url: `${WEB}/teams/${PLATFORM_TEAM_ID}`,
    name: "Platform",
    description: "Keeps the lights on",
    default_role: "manager",
  },
  {
    id: PAYMENTS_TEAM_ID,
    type: "team",
    summary: "Payments",
    self: `${API}/teams/${PAYMENTS_TEAM_ID}`,
    html_url: `${WEB}/teams/${PAYMENTS_TEAM_ID}`,
    name: "Payments",
    description: null,
    default_role: "none",
  },
];

export function layer(data: {
  id: string;
  name: string;
  start: string;
  end?: string | null;
  virtualStart: string;
  turnSeconds: number;
  users: Array<Record<string, unknown>>;
  restrictions?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    id: data.id,
    name: data.name,
    start: data.start,
    end: data.end ?? null,
    rotation_virtual_start: data.virtualStart,
    rotation_turn_length_seconds: data.turnSeconds,
    users: data.users.map((user: Record<string, unknown>) => {
      return { user: user };
    }),
    restrictions: data.restrictions || [],
    rendered_schedule_entries: [],
    rendered_coverage_percentage: null,
  };
}

function scheduleRecord(data: {
  id: string;
  name: string;
  description: string;
  timeZone: string;
  teams: Array<Record<string, unknown>>;
  layers?: Array<Record<string, unknown>> | undefined;
}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    id: data.id,
    type: "schedule",
    summary: data.name,
    self: `${API}/schedules/${data.id}`,
    html_url: `${WEB}/schedules/${data.id}`,
    name: data.name,
    time_zone: data.timeZone,
    description: data.description,
    escalation_policies: [],
    users: [],
    teams: data.teams,
  };

  if (data.layers) {
    record["schedule_layers"] = data.layers;
  }

  return record;
}

// Primary: a weekend layer over a daily one, over a layer that ended.
export const PRIMARY_LAYERS: Array<Record<string, unknown>> = [
  layer({
    id: "PLWKND1",
    name: "Weekend cover",
    start: "2026-01-03T00:00:00-05:00",
    virtualStart: "2026-01-03T00:00:00-05:00",
    turnSeconds: 604800,
    users: [userReference(CAROL_ID, "Carol Jones")],
    restrictions: [
      {
        type: "weekly_restriction",
        start_time_of_day: "00:00:00",
        duration_seconds: 172800,
        start_day_of_week: 6,
      },
    ],
  }),
  layer({
    id: "PLDAY01",
    name: "Layer 1",
    start: "2026-01-05T09:00:00-05:00",
    virtualStart: "2026-01-05T09:00:00-05:00",
    turnSeconds: 86400,
    users: [
      userReference(ALICE_ID, "Alice Wong"),
      userReference(BOB_ID, "Bob Marley"),
    ],
  }),
  layer({
    id: "PLOLD01",
    name: "Old layer",
    start: "2025-01-01T00:00:00Z",
    end: "2025-12-01T00:00:00Z",
    virtualStart: "2025-01-01T00:00:00Z",
    turnSeconds: 604800,
    users: [userReference(BOB_ID, "Bob Marley")],
  }),
];

// Business hours: a layer that ends next year and one that takes over in November.
export const BUSINESS_LAYERS: Array<Record<string, unknown>> = [
  layer({
    id: "PLNOV01",
    name: "Next quarter",
    start: "2026-11-02T09:00:00Z",
    virtualStart: "2026-11-01T09:00:00Z",
    turnSeconds: 86400,
    users: [
      userReference(ALICE_ID, "Alice Wong"),
      userReference(BOB_ID, "Bob Marley"),
    ],
  }),
  layer({
    id: "PLBIZ01",
    name: "Nine to six",
    start: "2026-02-02T09:00:00Z",
    end: "2027-01-01T00:00:00Z",
    virtualStart: "2026-02-02T09:00:00Z",
    turnSeconds: 1209600,
    users: [userReference(BOB_ID, "Bob Marley")],
    restrictions: [
      {
        type: "daily_restriction",
        start_time_of_day: "09:00:00",
        duration_seconds: 32400,
      },
    ],
  }),
];

export const BACKUP_LAYERS: Array<Record<string, unknown>> = [
  layer({
    id: "PLHALF1",
    name: "Half days",
    start: "2026-03-01T08:00:00Z",
    virtualStart: "2026-03-01T08:00:00Z",
    turnSeconds: 43200,
    users: [
      userReference(BOB_ID, "Bob Marley"),
      userReference(ALICE_ID, "Alice Wong"),
    ],
  }),
];

export const PAGERDUTY_SCHEDULES: Array<Record<string, unknown>> = [
  scheduleRecord({
    id: PRIMARY_SCHEDULE_ID,
    name: "Primary",
    description: "Who gets paged first",
    timeZone: "America/New_York",
    teams: [teamReference(PLATFORM_TEAM_ID, "Platform")],
    layers: PRIMARY_LAYERS,
  }),
  scheduleRecord({
    id: BUSINESS_SCHEDULE_ID,
    name: "Business hours",
    description: "",
    timeZone: "Europe/London",
    teams: [teamReference(PAYMENTS_TEAM_ID, "Payments")],
    layers: BUSINESS_LAYERS,
  }),
  // The list gives this one without its layers.
  scheduleRecord({
    id: BACKUP_SCHEDULE_ID,
    name: "Backup",
    description: "",
    timeZone: "UTC",
    teams: [],
  }),
];

export const BACKUP_SCHEDULE_DETAIL: Record<string, unknown> = scheduleRecord({
  id: BACKUP_SCHEDULE_ID,
  name: "Backup",
  description: "",
  timeZone: "UTC",
  teams: [],
  layers: BACKUP_LAYERS,
});

export const PAGERDUTY_POLICIES: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_POLICY_ID,
    type: "escalation_policy",
    summary: "Platform EP",
    self: `${API}/escalation_policies/${PLATFORM_POLICY_ID}`,
    html_url: `${WEB}/escalation_policies/${PLATFORM_POLICY_ID}`,
    name: "Platform EP",
    description: "Pages the platform on-call, then Bob",
    num_loops: 2,
    on_call_handoff_notifications: "if_has_services",
    escalation_rules: [
      {
        id: "PRULE01",
        escalation_delay_in_minutes: 15,
        targets: [
          reference(
            "schedule_reference",
            PRIMARY_SCHEDULE_ID,
            "Primary",
            "schedules",
          ),
        ],
        escalation_rule_assignment_strategy: "assign_to_everyone",
      },
      {
        id: "PRULE02",
        escalation_delay_in_minutes: 30,
        targets: [
          userReference(BOB_ID, "Bob Marley"),
          userReference(GONE_USER_ID, "Someone who left"),
        ],
        escalation_rule_assignment_strategy: { type: "round_robin" },
      },
    ],
    services: [
      reference(
        "service_reference",
        CHECKOUT_SERVICE_ID,
        "Checkout API",
        "services",
      ),
    ],
    teams: [teamReference(PLATFORM_TEAM_ID, "Platform")],
  },
  {
    id: SHIFT_BASED_POLICY_ID,
    type: "escalation_policy",
    summary: "Follow the sun EP",
    self: `${API}/escalation_policies/${SHIFT_BASED_POLICY_ID}`,
    html_url: `${WEB}/escalation_policies/${SHIFT_BASED_POLICY_ID}`,
    name: "Follow the sun EP",
    description: null,
    num_loops: 0,
    on_call_handoff_notifications: "always",
    escalation_rules: [
      {
        id: "PRULE03",
        escalation_delay_in_minutes: 10,
        targets: [
          {
            id: SHIFT_BASED_SCHEDULE_ID,
            type: "schedule_v3_reference",
            summary: "Follow the sun",
            self: `${API}/v3/schedules/${SHIFT_BASED_SCHEDULE_ID}`,
            html_url: `${WEB}/schedules/${SHIFT_BASED_SCHEDULE_ID}`,
          },
        ],
        escalation_rule_assignment_strategy: "assign_to_everyone",
      },
    ],
    services: [],
    teams: [],
  },
];

function serviceRecord(data: {
  id: string;
  name: string;
  status: string;
  teams: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    id: data.id,
    type: "service",
    summary: data.name,
    self: `${API}/services/${data.id}`,
    html_url: `${WEB}/service-directory/${data.id}`,
    name: data.name,
    description: `${data.name} in production`,
    auto_resolve_timeout: 14400,
    acknowledgement_timeout: 600,
    created_at: "2025-06-01T10:00:00Z",
    status: data.status,
    last_incident_timestamp: null,
    escalation_policy: reference(
      "escalation_policy_reference",
      PLATFORM_POLICY_ID,
      "Platform EP",
      "escalation_policies",
    ),
    response_play: null,
    teams: data.teams,
    integrations: [],
    incident_urgency_rule: { type: "constant", urgency: "high" },
  };
}

export const PAGERDUTY_SERVICES: Array<Record<string, unknown>> = [
  serviceRecord({
    id: CHECKOUT_SERVICE_ID,
    name: "Checkout API",
    status: "active",
    teams: [teamReference(PAYMENTS_TEAM_ID, "Payments")],
  }),
  serviceRecord({
    id: LEGACY_SERVICE_ID,
    name: "Legacy batch",
    status: "disabled",
    teams: [],
  }),
];

// One page of an offset-paged list, as PagerDuty answers it.
export function page(
  field: string,
  records: Array<unknown>,
  data: { offset?: number; limit?: number; more?: boolean } = {},
): unknown {
  return {
    [field]: records,
    limit: data.limit ?? 100,
    offset: data.offset ?? 0,
    more: data.more ?? false,
    total: null,
  };
}

// PagerDuty's error, as it answers a refused request.
export function pagerDutyError(message: string, code: number = 2006): unknown {
  return {
    error: {
      message: message,
      code: code,
      errors: [],
    },
  };
}

/*
 * The routes of the whole account. A test changes one route with
 * FixtureApi.add, which wins over these.
 */
export function pagerDutyRoutes(): Array<FixtureRoute> {
  return [
    {
      path: "/users",
      answers: [json(page("users", PAGERDUTY_USERS))],
    },
    {
      path: "/teams",
      answers: [json(page("teams", PAGERDUTY_TEAMS))],
    },
    {
      path: "/schedules",
      query: { "include[]": "schedule_layers" },
      answers: [json(page("schedules", PAGERDUTY_SCHEDULES))],
    },
    {
      path: `/schedules/${BACKUP_SCHEDULE_ID}`,
      answers: [json({ schedule: BACKUP_SCHEDULE_DETAIL })],
    },
    {
      path: "/v3/schedules",
      answers: [
        json({
          schedules: [
            {
              id: SHIFT_BASED_SCHEDULE_ID,
              type: "schedule_v3_reference",
              summary: "Follow the sun",
              self: `${API}/v3/schedules/${SHIFT_BASED_SCHEDULE_ID}`,
              html_url: `${WEB}/schedules/${SHIFT_BASED_SCHEDULE_ID}`,
            },
          ],
          limit: 1,
          offset: 0,
          more: false,
        }),
      ],
    },
    {
      path: "/escalation_policies",
      answers: [json(page("escalation_policies", PAGERDUTY_POLICIES))],
    },
    {
      path: "/services",
      answers: [json(page("services", PAGERDUTY_SERVICES))],
    },
  ];
}

export function pagerDutyApi(): FixtureApi {
  return new FixtureApi(pagerDutyRoutes());
}
