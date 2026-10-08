import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * An Opsgenie account as its REST API answers, in the shapes Opsgenie's
 * OpenAPI definition (github.com/opsgenie/opsgenie-oas) and API docs
 * document: every response wraps its payload in `data`, with `took` and
 * `requestId` beside it; lists of users and services page with
 * limit/offset and carry `totalCount` and `paging`. The ids are Opsgenie's
 * own UUID-shaped ids.
 *
 * The account: three people (one blocked), two teams (the list leaves the
 * members out, as Opsgenie's does in practice - each team is read on its
 * own), two schedules (Platform with a business-hours and an after-hours
 * rotation that never overlap, and Weekend with two rotations that do), two
 * escalations and one service.
 */

export const OPSGENIE_KEY: string = "8b1e5a1c-3f4d-4f4b-9a5e-2d6c7b8a9f01";

export const ALICE_ID: string = "b5b92115-bfe7-43eb-8c2a-e467f2e5ddc4";
export const BOB_ID: string = "e07c63f0-dd8c-4ad4-983e-4ee7dc600463";
export const CAROL_ID: string = "4ccbb1a8-6c43-4bd1-a9a1-f8ad7f1e2f3c";

export const PLATFORM_TEAM_ID: string = "90098alp9-f0e3-41d3-a060-0ea895027630";
export const PAYMENTS_TEAM_ID: string = "8c3dbd25-3a1b-4f45-90b0-8f6e9b3b9b11";

export const PLATFORM_SCHEDULE_ID: string =
  "d875alp4-9b4e-4219-alp3-0c26936d18de";
export const WEEKEND_SCHEDULE_ID: string =
  "2fd0b8d4-6a73-4d2e-b2e4-3a7b5ad8a1c2";

export const PLATFORM_ESCALATION_ID: string =
  "9a441a8d-0e72-4b8f-a3a5-5b3e2b4c8d10";
export const NOBODY_ESCALATION_ID: string =
  "c11b2a3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

export const CHECKOUT_SERVICE_ID: string =
  "0f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function envelope(data: unknown, extra: Record<string, unknown> = {}): unknown {
  return {
    data: data,
    took: 0.21,
    requestId: "d2c50d0c-1c44-4fa5-99d4-20d1e7ca9938",
    ...extra,
  };
}

export function opsGenieUser(data: {
  id: string;
  username: string;
  fullName: string;
  blocked?: boolean;
}): Record<string, unknown> {
  return {
    blocked: data.blocked || false,
    verified: true,
    id: data.id,
    username: data.username,
    fullName: data.fullName,
    role: { id: "User", name: "User" },
    timeZone: "Europe/London",
    locale: "en_US",
    userAddress: {
      country: "",
      state: "",
      city: "",
      line: "",
      zipCode: "",
    },
    createdAt: "2024-05-12T08:34:17.364Z",
  };
}

export const OPSGENIE_USERS: Array<Record<string, unknown>> = [
  opsGenieUser({
    id: ALICE_ID,
    username: "Alice@Example.com",
    fullName: "Alice Wong",
  }),
  opsGenieUser({
    id: BOB_ID,
    username: "bob@example.com",
    fullName: "Bob Marley",
  }),
  opsGenieUser({
    id: CAROL_ID,
    username: "carol@example.com",
    fullName: "Carol Jones",
    blocked: true,
  }),
];

export const OPSGENIE_TEAMS: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_TEAM_ID,
    name: "Platform",
    description: "Keeps the lights on",
  },
  {
    id: PAYMENTS_TEAM_ID,
    name: "Payments",
    description: "",
  },
];

export const OPSGENIE_TEAM_DETAILS: Record<string, Record<string, unknown>> = {
  [PLATFORM_TEAM_ID]: {
    id: PLATFORM_TEAM_ID,
    name: "Platform",
    description: "Keeps the lights on",
    members: [
      { user: { id: ALICE_ID, username: "alice@example.com" }, role: "admin" },
      { user: { id: BOB_ID, username: "bob@example.com" }, role: "user" },
    ],
  },
  [PAYMENTS_TEAM_ID]: {
    id: PAYMENTS_TEAM_ID,
    name: "Payments",
    description: "",
    members: [
      { user: { id: BOB_ID, username: "bob@example.com" }, role: "user" },
    ],
  },
};

export const OPSGENIE_SCHEDULES: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_SCHEDULE_ID,
    name: "Platform_schedule",
    description: "Who gets paged for the platform",
    timezone: "Europe/Istanbul",
    enabled: true,
    ownerTeam: { id: PLATFORM_TEAM_ID, name: "Platform" },
    rotations: [
      {
        id: "f6a2b9d1-0c3e-4f5a-8b7c-1d2e3f4a5b6c",
        name: "Business hours",
        startDate: "2024-02-05T06:00:00Z",
        type: "weekly",
        length: 1,
        participants: [
          { type: "user", id: ALICE_ID, username: "alice@example.com" },
          { type: "user", id: BOB_ID, username: "bob@example.com" },
        ],
        timeRestriction: {
          type: "weekday-and-time-of-day",
          restrictions: [
            {
              startDay: "monday",
              startHour: 9,
              startMin: 0,
              endDay: "friday",
              endHour: 17,
              endMin: 0,
            },
          ],
        },
      },
      {
        id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        name: "After hours",
        startDate: "2024-02-05T06:00:00Z",
        type: "daily",
        length: 2,
        participants: [
          { type: "user", id: BOB_ID, username: "bob@example.com" },
          { type: "none" },
          { type: "team", id: PAYMENTS_TEAM_ID, name: "Payments" },
        ],
        timeRestriction: {
          type: "weekday-and-time-of-day",
          restrictions: [
            {
              startDay: "friday",
              startHour: 17,
              startMin: 0,
              endDay: "monday",
              endHour: 9,
              endMin: 0,
            },
          ],
        },
      },
      {
        id: "0d9c8b7a-6f5e-4d3c-2b1a-0f9e8d7c6b5a",
        name: "Old rotation",
        startDate: "2023-01-02T06:00:00Z",
        endDate: "2023-06-01T06:00:00Z",
        type: "weekly",
        length: 1,
        participants: [
          { type: "user", id: ALICE_ID, username: "alice@example.com" },
        ],
      },
    ],
  },
  {
    id: WEEKEND_SCHEDULE_ID,
    name: "Weekend",
    description: "",
    timezone: "Mars/Olympus_Mons",
    enabled: false,
    rotations: [
      {
        id: "11111111-2222-4333-8444-555555555555",
        name: "Primary",
        startDate: "2024-03-01T09:00:00Z",
        type: "hourly",
        length: 12,
        participants: [
          { type: "user", id: ALICE_ID, username: "alice@example.com" },
        ],
        timeRestriction: {
          type: "time-of-day",
          restriction: { startHour: 22, startMin: 0, endHour: 6, endMin: 30 },
        },
      },
      {
        id: "66666666-7777-4888-9999-000000000000",
        name: "Shadow",
        startDate: "2024-03-01T09:00:00Z",
        type: "daily",
        length: 1,
        participants: [
          { type: "user", id: BOB_ID, username: "bob@example.com" },
        ],
      },
    ],
  },
];

export const OPSGENIE_ESCALATIONS: Array<Record<string, unknown>> = [
  {
    id: PLATFORM_ESCALATION_ID,
    name: "Platform_escalation",
    description: "Page the platform on-call, then Bob, then the team",
    ownerTeam: { id: PLATFORM_TEAM_ID, name: "Platform" },
    rules: [
      {
        condition: "if-not-acked",
        notifyType: "default",
        delay: { timeAmount: 0, timeUnit: "minutes" },
        recipient: {
          type: "schedule",
          id: PLATFORM_SCHEDULE_ID,
          name: "Platform_schedule",
        },
      },
      {
        condition: "if-not-acked",
        notifyType: "default",
        delay: { timeAmount: 5, timeUnit: "minutes" },
        recipient: { type: "user", id: BOB_ID, username: "bob@example.com" },
      },
      {
        condition: "if-not-closed",
        notifyType: "admins",
        delay: { timeAmount: 1, timeUnit: "hours" },
        recipient: { type: "team", id: PLATFORM_TEAM_ID, name: "Platform" },
      },
      {
        condition: "if-not-acked",
        notifyType: "next",
        delay: { timeAmount: 1, timeUnit: "hours" },
        recipient: {
          type: "schedule",
          id: WEEKEND_SCHEDULE_ID,
          name: "Weekend",
        },
      },
    ],
    repeat: {
      waitInterval: 10,
      count: 2,
      resetRecipientStates: false,
      closeAlertAfterAll: false,
    },
  },
  {
    id: NOBODY_ESCALATION_ID,
    name: "Nobody",
    description: "",
    rules: [],
  },
];

export const OPSGENIE_SERVICES: Array<Record<string, unknown>> = [
  {
    id: CHECKOUT_SERVICE_ID,
    name: "Checkout",
    description: "Takes the money",
    teamId: PAYMENTS_TEAM_ID,
    tags: ["prod"],
    visibility: "TEAM_MEMBERS",
  },
];

/*
 * The routes of the whole account. A test changes one route with
 * FixtureApi.add, which wins over these.
 */
export function opsGenieRoutes(): Array<FixtureRoute> {
  const routes: Array<FixtureRoute> = [
    {
      path: "/v2/account",
      answers: [
        json(
          envelope({
            name: "acme",
            userCount: 3,
            plan: { maxUserCount: 50, name: "Enterprise", isYearly: true },
          }),
        ),
      ],
    },
    {
      path: "/v2/users",
      answers: [
        json(
          envelope(OPSGENIE_USERS, {
            totalCount: OPSGENIE_USERS.length,
            paging: {
              first:
                "https://api.opsgenie.com/v2/users?limit=100&sort=username&offset=0&order=asc",
              last: "https://api.opsgenie.com/v2/users?limit=100&sort=username&offset=0&order=asc",
            },
          }),
        ),
      ],
    },
    { path: "/v2/teams", answers: [json(envelope(OPSGENIE_TEAMS))] },
    {
      path: "/v2/schedules",
      query: { expand: "rotation" },
      answers: [
        json(envelope(OPSGENIE_SCHEDULES, { expandable: ["rotation"] })),
      ],
    },
    { path: "/v2/escalations", answers: [json(envelope(OPSGENIE_ESCALATIONS))] },
    {
      path: "/v1/services",
      answers: [
        json(
          envelope(OPSGENIE_SERVICES, {
            totalCount: OPSGENIE_SERVICES.length,
            paging: {},
          }),
        ),
      ],
    },
  ];

  for (const [teamId, team] of Object.entries(OPSGENIE_TEAM_DETAILS)) {
    routes.push({
      path: `/v2/teams/${teamId}`,
      query: { identifierType: "id" },
      answers: [json(envelope(team))],
    });
  }

  return routes;
}

export function opsGenieApi(): FixtureApi {
  return new FixtureApi(opsGenieRoutes());
}

// Opsgenie's error envelope, as it answers a refused request.
export function opsGenieError(status: number, message: string): unknown {
  return {
    message: message,
    took: 0.003,
    requestId: "7f8e9d0c-1b2a-4c3d-8e9f-0a1b2c3d4e5f",
  };
}
