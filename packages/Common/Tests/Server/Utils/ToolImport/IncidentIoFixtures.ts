import { FixtureApi, FixtureRoute, json } from "./ToolImportFixtureTransport";

/*
 * An incident.io organisation as its public API answers, in the shapes of
 * incident.io's OpenAPI definition (https://api.incident.io/v1/openapiV3.json):
 * lists wrap their records in a named field (`users`, `schedules`,
 * `escalation_paths`) beside `pagination_meta` { after, page_size }, and a
 * page with no `after` is the last. Ids are incident.io's ULIDs.
 *
 * The organisation: three people (one deactivated), one team, two schedules
 * (Primary, a rotation of two concurrent layers with a later version
 * scheduled; Support, business hours only), three escalation paths (one
 * built from a template), the default severities, statuses and roles, and
 * custom fields of every type.
 */

export const INCIDENT_IO_KEY: string =
  "inc_live_7Hq2Vb9Xs4Lm1Pz8Rt6Yw3Nd5Kc0Ja";

export const LISA_ID: string = "01FCNDV6P870EA6S7TK1DSYDG0";
export const MARTHA_ID: string = "01HPFH8T92MPGSQS5C1SPAF4V0";
export const RORY_ID: string = "01HPFH8T92MPGSQS5C1SPAF4V1";
export const DAN_ID: string = "01HPFH8T92MPGSQS5C1SPAF4V2";

export const PLATFORM_TEAM_ID: string = "01JPQA75EPNEES4479P16P4XAB";

export const PRIMARY_SCHEDULE_ID: string = "01G0J1EXE7AXZ2C93K61WBPYEH";
export const SUPPORT_SCHEDULE_ID: string = "01G0J1EXE7AXZ2C93K61WBPYEJ";
export const PRIMARY_ROTATION_ID: string = "01G0J1EXE7AXZ2C93K61WBPYR1";
export const SUPPORT_ROTATION_ID: string = "01G0J1EXE7AXZ2C93K61WBPYR2";

export const URGENT_PATH_ID: string = "01FCNDV6P870EA6S7TK1DSYDP1";
export const TEMPLATED_PATH_ID: string = "01FCNDV6P870EA6S7TK1DSYDP2";
export const CHANNEL_ONLY_PATH_ID: string = "01FCNDV6P870EA6S7TK1DSYDP3";

export const SERVICE_TYPE_ID: string = "01FCNDV6P870EA6S7TK1DSYCT1";
export const TEAM_TYPE_ID: string = "01FCNDV6P870EA6S7TK1DSYCT2";

export const AFFECTED_AREA_FIELD_ID: string = "01H2FW182TAH0NHEVBY34SCAK1";
export const CUSTOMERS_FIELD_ID: string = "01H2FW182TAH0NHEVBY34SCAK2";
export const TICKET_FIELD_ID: string = "01H2FW182TAH0NHEVBY34SCAK3";
export const IMPACT_FIELD_ID: string = "01H2FW182TAH0NHEVBY34SCAK4";
export const TEAM_FIELD_ID: string = "01H2FW182TAH0NHEVBY34SCAK5";

export function incidentIoUser(data: {
  id: string;
  name: string;
  email?: string;
  isActive?: boolean;
}): Record<string, unknown> {
  return {
    id: data.id,
    name: data.name,
    ...(data.email ? { email: data.email } : {}),
    is_active: data.isActive ?? true,
    role: "responder",
    base_role: {
      id: "01FCNDV6P870EA6S7TK1DSYDG9",
      name: "Responder",
      slug: "responder",
      description: "Can respond to incidents",
    },
    custom_roles: [],
    seats: { on_call: "full_access", response: "full_access" },
    slack_user_id: "U02AYNF2XJM",
  };
}

export const INCIDENT_IO_USERS: Array<Record<string, unknown>> = [
  incidentIoUser({
    id: LISA_ID,
    name: "Lisa Karlin Curtis",
    email: "lisa@incident.io",
  }),
  incidentIoUser({
    id: MARTHA_ID,
    name: "Martha Lambert",
    email: "MARTHA@incident.io",
  }),
  incidentIoUser({ id: RORY_ID, name: "Rory Bain", email: "rory@incident.io" }),
  incidentIoUser({
    id: DAN_ID,
    name: "Dan Gone",
    email: "dan@incident.io",
    isActive: false,
  }),
];

function rotaUser(id: string, name: string, email: string): unknown {
  return { id: id, name: name, email: email, role: "responder" };
}

export const INCIDENT_IO_SCHEDULES: Array<Record<string, unknown>> = [
  {
    id: PRIMARY_SCHEDULE_ID,
    name: "Primary On-call",
    timezone: "Europe/London",
    team_ids: [PLATFORM_TEAM_ID],
    annotations: {},
    created_at: "2024-08-17T13:28:57.801578Z",
    updated_at: "2024-08-17T13:28:57.801578Z",
    permalink: "https://app.incident.io/acme/on-call/schedules/01G0J1EXE7AXZ2C93K61WBPYEH",
    config: {
      rotations: [
        {
          id: PRIMARY_ROTATION_ID,
          name: "Primary rota",
          handover_start_at: "2024-05-06T09:00:00Z",
          handovers: [{ interval: 1, interval_type: "weekly" }],
          layers: [
            { id: "primary", name: "Primary" },
            { id: "secondary", name: "Secondary" },
          ],
          users: [
            rotaUser(LISA_ID, "Lisa Karlin Curtis", "lisa@incident.io"),
            rotaUser(MARTHA_ID, "Martha Lambert", "martha@incident.io"),
            rotaUser(RORY_ID, "Rory Bain", "rory@incident.io"),
          ],
          working_intervals: [],
        },
        {
          id: PRIMARY_ROTATION_ID,
          name: "Primary rota",
          effective_from: "2099-01-01T09:00:00Z",
          handover_start_at: "2024-05-06T09:00:00Z",
          handovers: [{ interval: 2, interval_type: "weekly" }],
          layers: [{ id: "primary", name: "Primary" }],
          users: [rotaUser(LISA_ID, "Lisa Karlin Curtis", "lisa@incident.io")],
          working_intervals: [],
        },
      ],
    },
    current_shifts: [],
    next_shifts: [],
  },
  {
    id: SUPPORT_SCHEDULE_ID,
    name: "Support",
    timezone: "America/New_York",
    team_ids: [],
    annotations: {},
    created_at: "2024-08-17T13:28:57.801578Z",
    updated_at: "2024-08-17T13:28:57.801578Z",
    permalink: "https://app.incident.io/acme/on-call/schedules/01G0J1EXE7AXZ2C93K61WBPYEJ",
    config: {
      rotations: [
        {
          id: SUPPORT_ROTATION_ID,
          name: "Business hours",
          handover_start_at: "2024-05-06T14:00:00Z",
          handovers: [
            { interval: 1, interval_type: "daily" },
            { interval: 3, interval_type: "daily" },
          ],
          layers: [{ id: "only", name: "Layer 1" }],
          users: [
            rotaUser(MARTHA_ID, "Martha Lambert", "martha@incident.io"),
            rotaUser(DAN_ID, "Dan Gone", "dan@incident.io"),
          ],
          working_intervals: [
            { weekday: "monday", start_time: "09:00", end_time: "17:00" },
            { weekday: "tuesday", start_time: "09:00", end_time: "17:00" },
            { weekday: "wednesday", start_time: "09:00", end_time: "17:00" },
            { weekday: "thursday", start_time: "09:00", end_time: "17:00" },
            { weekday: "friday", start_time: "09:00", end_time: "17:00" },
          ],
        },
      ],
    },
    current_shifts: [],
    next_shifts: [],
  },
];

function level(
  targets: Array<Record<string, unknown>>,
  timeToAckSeconds: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ack_mode: "all",
    targets: targets,
    time_to_ack_seconds: timeToAckSeconds,
    ...extra,
  };
}

export const INCIDENT_IO_ESCALATION_PATHS: Array<Record<string, unknown>> = [
  {
    id: URGENT_PATH_ID,
    name: "Urgent Support",
    kind: "standalone",
    team_ids: [PLATFORM_TEAM_ID],
    path: [
      {
        id: "node-level-1",
        type: "level",
        level: level(
          [
            {
              id: PRIMARY_SCHEDULE_ID,
              type: "schedule",
              schedule_mode: "currently_on_call",
              urgency: "high",
            },
          ],
          300,
        ),
      },
      {
        id: "node-delay",
        type: "delay",
        delay: { delay_seconds: 120 },
      },
      {
        id: "node-channel",
        type: "notify_channel",
        notify_channel: {
          targets: [{ id: "C0123", type: "slack_channel", urgency: "high" }],
          time_to_ack_seconds: 60,
        },
      },
      {
        id: "node-branch",
        type: "if_else",
        if_else: {
          conditions: [
            {
              operation: { label: "is one of", value: "one_of" },
              param_bindings: [],
              subject: {
                label: "Alert priority",
                reference: "alert.priority",
              },
            },
          ],
          then_path: [
            {
              id: "node-level-2",
              type: "level",
              level: level(
                [
                  { id: RORY_ID, type: "user", urgency: "high" },
                  {
                    id: SUPPORT_SCHEDULE_ID,
                    type: "schedule",
                    schedule_mode: "all_users",
                    urgency: "low",
                  },
                ],
                900,
                {
                  round_robin_config: { enabled: true, rotate_after_seconds: 60 },
                },
              ),
            },
          ],
          else_path: [
            {
              id: "node-level-else",
              type: "level",
              level: level(
                [{ id: MARTHA_ID, type: "user", urgency: "low" }],
                900,
              ),
            },
          ],
        },
      },
      {
        id: "node-repeat",
        type: "repeat",
        repeat: { repeat_times: 3, to_node: "node-level-1" },
      },
    ],
    repeat_config: { repeat_after_seconds: 1800, delay_repeat_on_activity: false },
    working_hours: [],
  },
  {
    id: TEMPLATED_PATH_ID,
    name: "From a template",
    kind: "templated",
    team_ids: [],
    template_id: "01FCNDV6P870EA6S7TK1DSYTPL",
    param_bindings: {},
    path: [],
  },
  {
    id: CHANNEL_ONLY_PATH_ID,
    name: "Tell the channel",
    kind: "standalone",
    team_ids: [],
    path: [
      {
        id: "only-channel",
        type: "notify_channel",
        notify_channel: {
          targets: [{ id: "C0999", type: "slack_channel", urgency: "low" }],
        },
      },
    ],
  },
];

export const INCIDENT_IO_SEVERITIES: Array<Record<string, unknown>> = [
  {
    id: "01FCNDV6P870EA6S7TK1DSYSE1",
    name: "Minor",
    description: "Issues with **low impact**.",
    rank: 1,
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
  {
    id: "01FCNDV6P870EA6S7TK1DSYSE3",
    name: "Critical",
    description: "Issues causing **very high impact**.",
    rank: 3,
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
  {
    id: "01FCNDV6P870EA6S7TK1DSYSE2",
    name: "Major",
    description: "Issues with **significant impact**.",
    rank: 2,
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
];

function status(
  id: string,
  name: string,
  category: string,
  rank: number,
): Record<string, unknown> {
  return {
    id: id,
    name: name,
    category: category,
    rank: rank,
    description: `${name} incidents`,
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  };
}

export const INCIDENT_IO_STATUSES: Array<Record<string, unknown>> = [
  status("01FCNDV6P870EA6S7TK1DSYS05", "Closed", "closed", 5),
  status("01FCNDV6P870EA6S7TK1DSYS01", "Triage", "triage", 1),
  status("01FCNDV6P870EA6S7TK1DSYS02", "Investigating", "live", 2),
  status("01FCNDV6P870EA6S7TK1DSYS03", "Fixing", "live", 3),
  status("01FCNDV6P870EA6S7TK1DSYS04", "Post-incident", "learning", 4),
  status("01FCNDV6P870EA6S7TK1DSYS06", "Declined", "declined", 6),
];

export const INCIDENT_IO_ROLES: Array<Record<string, unknown>> = [
  {
    id: "01FCNDV6P870EA6S7TK1DSYRL1",
    name: "Incident Lead",
    description: "The person currently coordinating the incident",
    instructions: "Take point on the incident",
    role_type: "lead",
    shortform: "lead",
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
  {
    id: "01FCNDV6P870EA6S7TK1DSYRL2",
    name: "Reporter",
    description: "The person who reported the incident",
    instructions: "",
    role_type: "reporter",
    shortform: "",
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
  {
    id: "01FCNDV6P870EA6S7TK1DSYRL3",
    name: "Communications Lead",
    description: "",
    instructions: "Keep customers informed",
    role_type: "custom",
    shortform: "comms",
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  },
];

function customField(
  id: string,
  name: string,
  fieldType: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: id,
    name: name,
    description: `${name} of the incident`,
    field_type: fieldType,
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
    ...extra,
  };
}

export const INCIDENT_IO_CUSTOM_FIELDS: Array<Record<string, unknown>> = [
  customField(AFFECTED_AREA_FIELD_ID, "Affected Area", "single_select"),
  customField(CUSTOMERS_FIELD_ID, "Customers Affected", "multi_select"),
  customField(TICKET_FIELD_ID, "Ticket", "link"),
  customField(IMPACT_FIELD_ID, "Users Impacted", "numeric"),
  customField(TEAM_FIELD_ID, "Affected Team", "single_select", {
    catalog_type_id: TEAM_TYPE_ID,
  }),
];

function option(
  id: string,
  fieldId: string,
  value: string,
  sortKey: number,
): Record<string, unknown> {
  return {
    id: id,
    custom_field_id: fieldId,
    value: value,
    sort_key: sortKey,
  };
}

function catalogType(
  id: string,
  name: string,
  categories: Array<string>,
): Record<string, unknown> {
  return {
    id: id,
    name: name,
    description: `${name} we run`,
    categories: categories,
    color: "yellow",
    icon: "box",
    is_editable: true,
    ranked: false,
    schema: { attributes: [], version: 1 },
    type_name: `Custom["${name.replace(/\s/g, "")}"]`,
    engine_resource_type: `CatalogEntry["${name.replace(/\s/g, "")}"]`,
    annotations: {},
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
    use_name_as_identifier: true,
  };
}

function catalogEntry(
  id: string,
  typeId: string,
  name: string,
  archivedAt?: string,
): Record<string, unknown> {
  return {
    id: id,
    catalog_type_id: typeId,
    name: name,
    aliases: [],
    attribute_values: {},
    rank: 0,
    ...(archivedAt ? { archived_at: archivedAt } : {}),
    created_at: "2021-08-17T13:28:57.801578Z",
    updated_at: "2021-08-17T13:28:57.801578Z",
  };
}

export function page(
  field: string,
  records: Array<unknown>,
  after?: string,
): unknown {
  return {
    [field]: records,
    pagination_meta: {
      page_size: 25,
      ...(after ? { after: after } : {}),
    },
  };
}

export function incidentIoRoutes(): Array<FixtureRoute> {
  return [
    {
      path: "/v1/identity",
      answers: [
        json({
          identity: {
            name: "OneUptime import",
            dashboard_url: "https://app.incident.io/acme",
            roles: ["viewer", "schedules_reader", "on_call_viewer", "catalog_viewer"],
          },
        }),
      ],
    },
    {
      path: "/v2/users",
      answers: [json(page("users", INCIDENT_IO_USERS))],
    },
    {
      path: "/v3/teams",
      answers: [
        json(
          page("teams", [
            {
              id: PLATFORM_TEAM_ID,
              name: "Platform",
              catalog_entry: {
                id: "01FCNDV6P870EA6S7TK1DSYCE9",
                name: "Platform",
              },
              members: [
                { id: LISA_ID, name: "Lisa Karlin Curtis", email: "lisa@incident.io" },
                { id: RORY_ID, name: "Rory Bain", email: "rory@incident.io" },
                { id: "01UNKNOWNUSER000000000000", name: "Someone", email: "x@y.z" },
              ],
            },
          ]),
        ),
      ],
    },
    {
      path: "/v2/schedules",
      answers: [json(page("schedules", INCIDENT_IO_SCHEDULES))],
    },
    {
      path: "/v2/escalation_paths",
      answers: [json(page("escalation_paths", INCIDENT_IO_ESCALATION_PATHS))],
    },
    {
      path: "/v1/severities",
      answers: [json({ severities: INCIDENT_IO_SEVERITIES })],
    },
    {
      path: "/v1/incident_statuses",
      answers: [json({ incident_statuses: INCIDENT_IO_STATUSES })],
    },
    {
      path: "/v2/incident_roles",
      answers: [json({ incident_roles: INCIDENT_IO_ROLES })],
    },
    {
      path: "/v2/custom_fields",
      answers: [json({ custom_fields: INCIDENT_IO_CUSTOM_FIELDS })],
    },
    {
      path: "/v1/custom_field_options",
      query: { custom_field_id: AFFECTED_AREA_FIELD_ID },
      answers: [
        json(
          page("custom_field_options", [
            option("01OPT00000000000000000000B", AFFECTED_AREA_FIELD_ID, "Billing", 20),
            option("01OPT00000000000000000000A", AFFECTED_AREA_FIELD_ID, "Product", 10),
          ]),
        ),
      ],
    },
    {
      path: "/v1/custom_field_options",
      query: { custom_field_id: CUSTOMERS_FIELD_ID },
      answers: [
        json(
          page("custom_field_options", [
            option("01OPT00000000000000000000C", CUSTOMERS_FIELD_ID, "Acme", 1),
          ]),
        ),
      ],
    },
    {
      path: "/v3/catalog_types",
      answers: [
        json({
          catalog_types: [
            catalogType(SERVICE_TYPE_ID, "Service", ["service"]),
            catalogType(TEAM_TYPE_ID, "Team", ["team"]),
          ],
        }),
      ],
    },
    {
      path: "/v3/catalog_entries",
      query: { catalog_type_id: SERVICE_TYPE_ID },
      answers: [
        json({
          ...(page("catalog_entries", [
            catalogEntry("01FCNDV6P870EA6S7TK1DSYCE1", SERVICE_TYPE_ID, "API"),
            catalogEntry("01FCNDV6P870EA6S7TK1DSYCE2", SERVICE_TYPE_ID, "Web app"),
            catalogEntry(
              "01FCNDV6P870EA6S7TK1DSYCE3",
              SERVICE_TYPE_ID,
              "Legacy",
              "2023-01-01T00:00:00Z",
            ),
          ]) as Record<string, unknown>),
          catalog_type: catalogType(SERVICE_TYPE_ID, "Service", ["service"]),
        }),
      ],
    },
  ];
}

export function incidentIoApi(): FixtureApi {
  return new FixtureApi(incidentIoRoutes());
}

// incident.io's error envelope.
export function incidentIoError(status: number, message: string): unknown {
  return {
    type: status === 401 ? "authentication_error" : "invalid_request_error",
    status: status,
    request_id: "2T1p0e3j",
    errors: [{ code: "invalid", message: message }],
  };
}
