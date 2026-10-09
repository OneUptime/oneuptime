import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * A Splunk On-Call (VictorOps) organisation as its public API answers, in
 * the shapes its API documentation (portal.victorops.com/public/api-docs,
 * victorops-api-v1.yaml) gives: people named by username; the team list a
 * bare array of teams with their slugs; a team's members and rotation ids
 * under it; a team's rotations with their shifts - members, start,
 * `duration` in days, the days and hours each is on call (`mask`, `mask2`,
 * `mast3`), its time zone and who is on call in it now; escalation
 * policies listed with their team, each read on its own for its steps.
 *
 * The organisation:
 *  - four people: alice, bob, carol, and dave without an email address;
 *  - two teams: Platform (alice, bob) and Payments (bob, carol);
 *  - Platform's rotation Primary: business hours on weekdays and after
 *    hours (weekday nights and the weekend), which never overlap; and its
 *    rotation Follow the sun: an Americas shift and a Sydney shift;
 *  - Payments' rotation Payments 24/7: a two-weekly shift, and a shadow
 *    shift on call at the same time;
 *  - two policies: Platform's (the rotation, then people and an email
 *    address, a webhook in the same step, then another policy and whoever
 *    is next) and Payments' (waits five minutes before its first step).
 */

export const SPLUNK_API_ID: string = "8f2a6c1e";
export const SPLUNK_KEY: string = "c4b8e1d2-7a3f-4e5b-9c6d-0f1a2b3c4d5e";

export const PLATFORM_TEAM_SLUG: string = "team-Plat4m0000000000";
export const PAYMENTS_TEAM_SLUG: string = "team-Paym3nts0000000";

export const PRIMARY_ROTATION_SLUG: string = "rtg-Pr1mary000000000";
export const SUN_ROTATION_SLUG: string = "rtg-Sun000000000000F";
export const PAYMENTS_ROTATION_SLUG: string = "rtg-Paym3nts0000000R";

export const PLATFORM_POLICY_SLUG: string = "pol-Plat4mP0licy0000";
export const PAYMENTS_POLICY_SLUG: string = "pol-Paym3ntsP0licy00";

function user(data: {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}): Record<string, unknown> {
  return {
    firstName: data.firstName,
    lastName: data.lastName,
    username: data.username,
    email: data.email,
    createdAt: "2024-03-01T10:15:00Z",
    passwordLastUpdated: "2024-03-01T10:20:00Z",
    verified: false,
    _selfUrl: `/api-public/v1/user/${data.username}`,
  };
}

export const SPLUNK_USERS: Array<Record<string, unknown>> = [
  user({
    username: "alice",
    firstName: "Alice",
    lastName: "Wong",
    email: "alice@example.com",
  }),
  user({
    username: "bob",
    firstName: "Bob",
    lastName: "Marley",
    email: "Bob@Example.com",
  }),
  user({
    username: "carol",
    firstName: "Carol",
    lastName: "Jones",
    email: "carol@example.com",
  }),
  user({ username: "dave", firstName: "", lastName: "", email: "" }),
];

function team(slug: string, name: string, count: number): unknown {
  return {
    _selfUrl: `/api-public/v1/team/${slug}`,
    _membersUrl: `/api-public/v1/team/${slug}/members`,
    _policiesUrl: `/api-public/v1/team/${slug}/policies`,
    _adminsUrl: `/api-public/v1/team/${slug}/admins`,
    name: name,
    slug: slug,
    memberCount: count,
    version: 3,
    isDefaultTeam: false,
    description: `${name} engineers`,
  };
}

function member(username: string): Record<string, unknown> {
  return {
    username: username,
    firstName: username,
    lastName: "",
    version: 1,
    verified: "true",
  };
}

export const SPLUNK_TEAMS: Array<unknown> = [
  team(PLATFORM_TEAM_SLUG, "Platform", 2),
  team(PAYMENTS_TEAM_SLUG, "Payments", 2),
];

const WEEKDAYS: Record<string, boolean> = {
  su: false,
  m: true,
  t: true,
  w: true,
  th: true,
  f: true,
  sa: false,
};

const EVERY_DAY: Record<string, boolean> = {
  su: true,
  m: true,
  t: true,
  w: true,
  th: true,
  f: true,
  sa: true,
};

function time(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): Record<string, unknown> {
  return {
    start: { hour: startHour, minute: startMinute },
    end: { hour: endHour, minute: endMinute },
  };
}

export function shift(data: {
  shiftId: number;
  label: string;
  duration: number;
  start: string;
  timezone: string;
  shifttype?: string;
  members: Array<string>;
  current?: { start: string; end: string; username: string } | undefined;
  mask?: Record<string, unknown> | undefined;
  mask2?: Record<string, unknown> | undefined;
  mast3?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    shiftId: data.shiftId,
    label: data.label,
    duration: data.duration,
    shifttype: data.shifttype || "std",
    start: data.start,
    timezone: data.timezone,
    shiftMembers: data.members.map((username: string, index: number) => {
      return { slug: `rtm-${username}${index}`, username: username };
    }),
    periods: [],
  };

  if (data.current) {
    record["current"] = data.current;
  }

  for (const field of ["mask", "mask2", "mast3"] as const) {
    if (data[field]) {
      record[field] = data[field];
    }
  }

  return record;
}

export const PLATFORM_ROTATIONS: Array<Record<string, unknown>> = [
  {
    groupId: 101,
    label: "Primary",
    totalMembersInRotation: 3,
    shifts: [
      shift({
        shiftId: 1,
        label: "Business hours",
        duration: 7,
        shifttype: "pho",
        start: "2026-01-05T09:00:00-07:00",
        timezone: "America/Denver",
        members: ["alice", "bob"],
        // Splunk On-Call has alice on call this week (someone set her current).
        current: {
          start: "2026-10-05T09:00:00-06:00",
          end: "2026-10-09T17:00:00-06:00",
          username: "alice",
        },
        mask: { day: WEEKDAYS, time: [time(9, 0, 17, 0)] },
      }),
      shift({
        shiftId: 2,
        label: "After hours",
        duration: 7,
        shifttype: "cstm",
        start: "2026-01-05T17:00:00-07:00",
        timezone: "America/Denver",
        members: ["carol", "alice"],
        mask: { day: WEEKDAYS, time: [time(17, 0, 9, 0)] },
        mask2: {
          day: {
            su: true,
            m: false,
            t: false,
            w: false,
            th: false,
            f: false,
            sa: true,
          },
          time: [time(0, 0, 0, 0)],
        },
      }),
    ],
  },
  {
    groupId: 103,
    label: "Follow the sun",
    totalMembersInRotation: 2,
    shifts: [
      shift({
        shiftId: 31,
        label: "Americas",
        duration: 1,
        shifttype: "fts",
        start: "2026-01-05T08:00:00-05:00",
        timezone: "America/New_York",
        members: ["alice"],
        mask: { day: EVERY_DAY, time: [time(8, 0, 20, 0)] },
      }),
      shift({
        shiftId: 32,
        label: "Sydney",
        duration: 1,
        shifttype: "fts",
        start: "2026-01-05T08:00:00+11:00",
        timezone: "Australia/Sydney",
        members: ["bob"],
        mask: { day: EVERY_DAY, time: [time(8, 0, 20, 0)] },
      }),
    ],
  },
];

export const PAYMENTS_ROTATIONS: Array<Record<string, unknown>> = [
  {
    groupId: 202,
    label: "Payments 24/7",
    totalMembersInRotation: 3,
    shifts: [
      shift({
        shiftId: 21,
        label: "Everyone",
        duration: 14,
        start: "2026-03-02T10:00:00Z",
        timezone: "Europe/London",
        members: ["bob", "carol"],
        mask: { day: EVERY_DAY, time: [time(0, 0, 0, 0)] },
      }),
      shift({
        shiftId: 22,
        label: "Shadow",
        duration: 7,
        start: "2026-03-02T10:00:00Z",
        timezone: "Europe/London",
        members: ["alice"],
      }),
    ],
  },
];

export const ROTATION_SLUGS: Record<string, Array<Record<string, unknown>>> = {
  [PLATFORM_TEAM_SLUG]: [
    {
      teamSlug: PLATFORM_TEAM_SLUG,
      slug: PRIMARY_ROTATION_SLUG,
      label: "Primary",
      groupId: "101",
    },
    {
      teamSlug: PLATFORM_TEAM_SLUG,
      slug: SUN_ROTATION_SLUG,
      label: "Follow the sun",
      groupId: "103",
    },
  ],
  [PAYMENTS_TEAM_SLUG]: [
    {
      teamSlug: PAYMENTS_TEAM_SLUG,
      slug: PAYMENTS_ROTATION_SLUG,
      label: "Payments 24/7",
      groupId: "202",
    },
  ],
};

function policySummary(
  slug: string,
  name: string,
  teamSlug: string,
  teamName: string,
): Record<string, unknown> {
  return {
    policy: {
      name: name,
      slug: slug,
      _selfUrl: `/api-public/v1/policies/${slug}`,
    },
    team: { name: teamName, slug: teamSlug },
  };
}

export const SPLUNK_POLICY_SUMMARIES: Array<Record<string, unknown>> = [
  policySummary(
    PLATFORM_POLICY_SLUG,
    "Platform escalation",
    PLATFORM_TEAM_SLUG,
    "Platform",
  ),
  policySummary(
    PAYMENTS_POLICY_SLUG,
    "Payments escalation",
    PAYMENTS_TEAM_SLUG,
    "Payments",
  ),
];

export const SPLUNK_POLICIES: Record<string, Record<string, unknown>> = {
  [PLATFORM_POLICY_SLUG]: {
    name: "Platform escalation",
    slug: PLATFORM_POLICY_SLUG,
    ignoreCustomPagingPolicies: false,
    steps: [
      {
        timeout: 0,
        entries: [
          {
            executionType: "rotation_group",
            rotationGroup: { slug: PRIMARY_ROTATION_SLUG, label: "Primary" },
          },
        ],
      },
      {
        timeout: 15,
        entries: [
          {
            executionType: "user",
            user: { username: "bob", firstName: "Bob", lastName: "Marley" },
          },
          { executionType: "email", email: { address: "Alice@Example.com" } },
          {
            executionType: "email",
            email: { address: "noc-pager@acme.example" },
          },
        ],
      },
      {
        timeout: 0,
        entries: [
          {
            executionType: "webhook",
            webhook: { slug: "wh-Ab12Cd34Ef56Gh78", label: "Status bot" },
          },
        ],
      },
      {
        timeout: 10,
        entries: [
          {
            executionType: "policy_routing",
            targetPolicy: { policySlug: PAYMENTS_POLICY_SLUG },
          },
          {
            executionType: "rotation_group_next",
            rotationGroup: { slug: PRIMARY_ROTATION_SLUG, label: "Primary" },
          },
        ],
      },
    ],
  },
  [PAYMENTS_POLICY_SLUG]: {
    name: "Payments escalation",
    slug: PAYMENTS_POLICY_SLUG,
    ignoreCustomPagingPolicies: true,
    steps: [
      {
        timeout: 5,
        entries: [
          {
            executionType: "rotation_group",
            rotationGroup: {
              slug: PAYMENTS_ROTATION_SLUG,
              label: "Payments 24/7",
            },
          },
        ],
      },
    ],
  },
};

/*
 * The routes of the whole organisation. A test changes one route with
 * FixtureApi.add, which wins over these.
 */
export function splunkOnCallRoutes(): Array<FixtureRoute> {
  const routes: Array<FixtureRoute> = [
    {
      path: "/api-public/v2/user",
      answers: [json({ users: SPLUNK_USERS, _selfUrl: "/api-public/v2/user" })],
    },
    { path: "/api-public/v1/team", answers: [json(SPLUNK_TEAMS)] },
    {
      path: `/api-public/v1/team/${PLATFORM_TEAM_SLUG}/members`,
      answers: [
        json({
          _selfUrl: `/api-public/v1/team/${PLATFORM_TEAM_SLUG}/members`,
          _teamUrl: `/api-public/v1/team/${PLATFORM_TEAM_SLUG}`,
          members: [member("alice"), member("bob")],
        }),
      ],
    },
    {
      path: `/api-public/v1/team/${PAYMENTS_TEAM_SLUG}/members`,
      answers: [
        json({
          _selfUrl: `/api-public/v1/team/${PAYMENTS_TEAM_SLUG}/members`,
          _teamUrl: `/api-public/v1/team/${PAYMENTS_TEAM_SLUG}`,
          members: [member("bob"), member("carol")],
        }),
      ],
    },
    {
      path: "/api-public/v1/policies",
      answers: [json({ policies: SPLUNK_POLICY_SUMMARIES })],
    },
  ];

  for (const [teamSlug, groups] of Object.entries(ROTATION_SLUGS)) {
    routes.push({
      path: `/api-public/v1/teams/${teamSlug}/rotations`,
      answers: [json({ rotationGroups: groups })],
    });
  }

  routes.push({
    path: `/api-public/v2/team/${PLATFORM_TEAM_SLUG}/rotations`,
    answers: [json({ rotations: PLATFORM_ROTATIONS })],
  });
  routes.push({
    path: `/api-public/v2/team/${PAYMENTS_TEAM_SLUG}/rotations`,
    answers: [json({ rotations: PAYMENTS_ROTATIONS })],
  });

  for (const [slug, policy] of Object.entries(SPLUNK_POLICIES)) {
    routes.push({
      path: `/api-public/v1/policies/${slug}`,
      answers: [json(policy)],
    });
  }

  return routes;
}

export function splunkOnCallApi(): FixtureApi {
  return new FixtureApi(splunkOnCallRoutes());
}
