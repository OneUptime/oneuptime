import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaRuleService from "../../../Server/Services/IncidentSlaRuleService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ProjectReferencesService from "../../../Server/Services/ProjectReferencesService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ColumnsOnlyOneUptimeWrites from "../../../Server/Utils/Database/ColumnsOnlyOneUptimeWrites";
import ServerSetColumns from "../../../Server/Utils/Database/ServerSetColumns";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSla from "../../../Models/DatabaseModels/IncidentSla";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ServerOwned from "../../../Types/Database/ServerOwned";
import IncidentSlaStatus from "../../../Types/Incident/IncidentSlaStatus";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import IncidentSlaStartUtil, {
  AT_RISK_SHARE,
} from "../../../Utils/Incident/IncidentSlaStart";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * AN SLA A PERSON ADDS TO AN INCIDENT (#10053).
 *
 * Incidents > SLA > Add SLA rule, the API and Terraform name the incident
 * and the rule. The page used to work the rest out in the browser and send
 * it - columns only OneUptime writes, which a create through the API no
 * longer takes - and since #10020 the rule was one of them too, so
 * oneuptime_incident_sla could create nothing. Now the rule is the
 * creator's, and IncidentSlaService works the rest out from the incident
 * and the rule (IncidentSlaStartUtil, the page's own rules): when the SLA
 * started, its deadlines, whether the incident was responded to and
 * resolved, and where it stands.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10053000-0000-4000-8000-000000000003",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "10053000-0000-4000-8000-0000000000d3",
);
const RULE_ID: ObjectID = new ObjectID("10053000-0000-4000-8000-0000000000e3");
const CREATED_STATE: string = "10053000-0000-4000-8000-0000000000f1";
const ACKNOWLEDGED_STATE: string = "10053000-0000-4000-8000-0000000000f2";
const RESOLVED_STATE: string = "10053000-0000-4000-8000-0000000000f3";

const DECLARED_AT: Date = new Date("2026-11-19T08:00:00.000Z");
const ACKNOWLEDGED_AT: Date = new Date("2026-11-19T08:10:00.000Z");
const RESOLVED_AT: Date = new Date("2026-11-19T09:00:00.000Z");

const OWNER: DatabaseCommonInteractionProps = {
  ...customDomainCaller({
    permissions: [Permission.ProjectOwner],
    projectId: PROJECT_ID,
  }),
  ...ON_HIGHEST_PLAN,
};

function states(): Array<IncidentState> {
  return [
    [CREATED_STATE, 1, false],
    [ACKNOWLEDGED_STATE, 2, false],
    [RESOLVED_STATE, 3, true],
  ].map(([id, order, isResolved]: Array<unknown>): IncidentState => {
    const state: IncidentState = new IncidentState();
    state._id = id as string;
    state.order = order as number;
    state.isResolvedState = isResolved as boolean;
    return state;
  });
}

function timelineRow(
  stateId: string,
  startsAt: Date,
  isCreatedState: boolean,
): IncidentStateTimeline {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row.incidentStateId = new ObjectID(stateId);
  row.startsAt = startsAt;
  const state: IncidentState = new IncidentState();
  state._id = stateId;
  state.isCreatedState = isCreatedState;
  row.incidentState = state;
  return row;
}

function stubIncident(timeline: Array<IncidentStateTimeline>): void {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.declaredAt = DECLARED_AT;

  const rule: IncidentSlaRule = new IncidentSlaRule();
  rule._id = RULE_ID.toString();
  rule.responseTimeInMinutes = 30;
  rule.resolutionTimeInMinutes = 240;

  jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(incident as never);
  jest
    .spyOn(IncidentSlaRuleService, "findOneBy")
    .mockResolvedValue(rule as never);
  jest
    .spyOn(IncidentStateTimelineService, "findBy")
    .mockResolvedValue(timeline as never);
  jest
    .spyOn(IncidentStateService, "findBy")
    .mockResolvedValue(states() as never);
}

// The SLA as the Dashboard's Add SLA rule sends it now: the incident and the rule.
function addedSla(): IncidentSla {
  const sla: IncidentSla = new IncidentSla();
  sla.projectId = PROJECT_ID;
  sla.incidentId = INCIDENT_ID;
  sla.incidentSlaRuleId = RULE_ID;
  return sla;
}

async function beforeCreate(sla: IncidentSla): Promise<IncidentSla> {
  const onCreate: OnCreate<IncidentSla> = await (
    IncidentSlaService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<IncidentSla>,
      ) => Promise<OnCreate<IncidentSla>>;
    }
  ).onBeforeCreate({ data: sla, props: OWNER });
  return onCreate.createBy.data;
}

beforeEach(() => {
  // The project's references are asked of their own (ProjectReferencesService).
  jest
    .spyOn(
      ProjectReferencesService.prototype as unknown as {
        onBeforeCreate: (
          createBy: CreateBy<IncidentSla>,
        ) => Promise<OnCreate<IncidentSla>>;
      },
      "onBeforeCreate",
    )
    .mockImplementation(
      async (
        createBy: CreateBy<IncidentSla>,
      ): Promise<OnCreate<IncidentSla>> => {
        return { createBy, carryForward: null };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SLA a person adds to an incident", () => {
  test("picks its rule: the rule is the creator's, given at the create", () => {
    const column: { serverOwned?: ServerOwned | undefined } | undefined =
      new IncidentSla().getTableColumnMetadata("incidentSlaRuleId");
    expect(column?.serverOwned).toBeUndefined();

    const sla: IncidentSla = addedSla();
    ColumnsOnlyOneUptimeWrites.takeOut({
      model: new IncidentSla(),
      record: sla,
      props: OWNER,
    });
    expect(sla.incidentSlaRuleId?.toString()).toBe(RULE_ID.toString());
  });

  test("of an open incident starts when it was declared, with the rule's deadlines, on track", async () => {
    stubIncident([timelineRow(CREATED_STATE, DECLARED_AT, true)]);

    const sla: IncidentSla = await beforeCreate(addedSla());

    expect(sla.slaStartedAt?.toISOString()).toBe(DECLARED_AT.toISOString());
    expect(new Date(sla.responseDeadline!).toISOString()).toBe(
      "2026-11-19T08:30:00.000Z",
    );
    expect(new Date(sla.resolutionDeadline!).toISOString()).toBe(
      "2026-11-19T12:00:00.000Z",
    );
    expect(sla.respondedAt).toBeUndefined();
    expect(sla.resolvedAt).toBeUndefined();
    // OneUptime's values, for the person it writes as.
    for (const column of [
      "slaStartedAt",
      "status",
      "responseDeadline",
      "resolutionDeadline",
    ]) {
      expect([column, ServerSetColumns.isMarked(sla, column)]).toEqual([
        column,
        true,
      ]);
    }
  });

  test("of an incident already resolved within its deadlines is met", async () => {
    stubIncident([
      timelineRow(CREATED_STATE, DECLARED_AT, true),
      timelineRow(ACKNOWLEDGED_STATE, ACKNOWLEDGED_AT, false),
      timelineRow(RESOLVED_STATE, RESOLVED_AT, false),
    ]);

    const sla: IncidentSla = await beforeCreate(addedSla());

    expect(sla.status).toBe(IncidentSlaStatus.Met);
    expect(new Date(sla.respondedAt!).toISOString()).toBe(
      ACKNOWLEDGED_AT.toISOString(),
    );
    expect(new Date(sla.resolvedAt!).toISOString()).toBe(
      RESOLVED_AT.toISOString(),
    );
  });

  test("leaves the SLA OneUptime starts for a matching rule as it came", async () => {
    stubIncident([]);
    const sla: IncidentSla = addedSla();
    sla.slaStartedAt = DECLARED_AT;
    sla.status = IncidentSlaStatus.OnTrack;

    await beforeCreate(sla);

    expect(IncidentSlaRuleService.findOneBy).not.toHaveBeenCalled();
    expect(sla.responseDeadline).toBeUndefined();
  });

  /*
   * A reference has two names - its ID column and the relation - and a
   * write may send either (ReferenceNamesReadTogether): the SLA is worked
   * out from the incident and the rule whichever names it is sent under.
   */
  test("names its incident and its rule by their relations: worked out all the same", async () => {
    stubIncident([timelineRow(CREATED_STATE, DECLARED_AT, true)]);

    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    const rule: IncidentSlaRule = new IncidentSlaRule();
    rule._id = RULE_ID.toString();

    const sla: IncidentSla = new IncidentSla();
    sla.projectId = PROJECT_ID;
    sla.incident = incident;
    sla.incidentSlaRule = rule;

    await beforeCreate(sla);

    expect(sla.slaStartedAt?.toISOString()).toBe(DECLARED_AT.toISOString());
    expect(new Date(sla.responseDeadline!).toISOString()).toBe(
      "2026-11-19T08:30:00.000Z",
    );
    expect(
      (
        (IncidentService.findOneBy as jest.Mock).mock.calls[0]![0] as {
          query: { _id: ObjectID };
        }
      ).query._id.toString(),
    ).toBe(INCIDENT_ID.toString());
    expect(
      (
        (IncidentSlaRuleService.findOneBy as jest.Mock).mock.calls[0]![0] as {
          query: { _id: ObjectID };
        }
      ).query._id.toString(),
    ).toBe(RULE_ID.toString());
  });

  test("names its incident two ways that disagree: refused, and nothing is worked out", async () => {
    stubIncident([timelineRow(CREATED_STATE, DECLARED_AT, true)]);

    const other: Incident = new Incident();
    other._id = "10053000-0000-4000-8000-0000000000d9";

    const sla: IncidentSla = addedSla();
    sla.incident = other;

    await expect(beforeCreate(sla)).rejects.toThrow(
      /incidentId and incident are names for the same field/,
    );
    expect(IncidentService.findOneBy).not.toHaveBeenCalled();
    expect(sla.slaStartedAt).toBeUndefined();
  });

  test("names an incident or a rule the project does not have: left for the create's checks to refuse", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null as never);
    jest
      .spyOn(IncidentSlaRuleService, "findOneBy")
      .mockResolvedValue(null as never);

    const sla: IncidentSla = await beforeCreate(addedSla());

    expect(sla.slaStartedAt).toBeUndefined();
    expect(sla.status).toBeUndefined();
  });
});

describe("what an SLA starts with (IncidentSlaStartUtil)", () => {
  const now: Date = new Date("2026-11-19T10:00:00.000Z");

  test("is responded to at the first move out of the created state", () => {
    expect(
      IncidentSlaStartUtil.getRespondedAt([
        {
          incidentStateId: ACKNOWLEDGED_STATE,
          startsAt: ACKNOWLEDGED_AT,
          isCreatedState: false,
        },
        {
          incidentStateId: CREATED_STATE,
          startsAt: DECLARED_AT,
          isCreatedState: true,
        },
      ])?.toISOString(),
    ).toBe(ACKNOWLEDGED_AT.toISOString());
    expect(
      IncidentSlaStartUtil.getRespondedAt([
        {
          incidentStateId: CREATED_STATE,
          startsAt: DECLARED_AT,
          isCreatedState: true,
        },
      ]),
    ).toBeUndefined();
  });

  test("is breached on the deadline it missed", () => {
    const late: Date = new Date("2026-11-19T13:00:00.000Z");

    expect(
      IncidentSlaStartUtil.compute({
        declaredAt: DECLARED_AT,
        responseTimeInMinutes: 30,
        resolutionTimeInMinutes: 240,
        respondedAt: ACKNOWLEDGED_AT,
        resolvedAt: late,
        now,
      }).status,
    ).toBe(IncidentSlaStatus.ResolutionBreached);
    expect(
      IncidentSlaStartUtil.compute({
        declaredAt: DECLARED_AT,
        responseTimeInMinutes: 5,
        resolutionTimeInMinutes: 240,
        respondedAt: ACKNOWLEDGED_AT,
        resolvedAt: RESOLVED_AT,
        now,
      }).status,
    ).toBe(IncidentSlaStatus.ResponseBreached);
  });

  test("is at risk once most of its resolution time has gone, and on track before", () => {
    const start: (minutesIn: number) => IncidentSlaStatus = (
      minutesIn: number,
    ): IncidentSlaStatus => {
      return IncidentSlaStartUtil.compute({
        declaredAt: DECLARED_AT,
        resolutionTimeInMinutes: 100,
        respondedAt: ACKNOWLEDGED_AT,
        now: new Date(DECLARED_AT.getTime() + minutesIn * 60_000),
      }).status;
    };

    expect(start(100 * AT_RISK_SHARE)).toBe(IncidentSlaStatus.AtRisk);
    expect(start(10)).toBe(IncidentSlaStatus.OnTrack);
    expect(start(101)).toBe(IncidentSlaStatus.ResolutionBreached);
  });
});
