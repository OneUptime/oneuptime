import IncidentSlaRuleService from "../../../Server/Services/IncidentSlaRuleService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentSla from "../../../Models/DatabaseModels/IncidentSla";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import OneUptimeDate from "../../../Types/Date";
import IncidentSlaStatus from "../../../Types/Incident/IncidentSlaStatus";
import ObjectID from "../../../Types/ObjectID";
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
 * An incident declared already acknowledged (StartingStage) was responded
 * to the moment it was declared. Its SLA starts that way - respondedAt set
 * to when it was declared - so its response deadline is never reported
 * missed to its owners for it, and resolving it later is judged on the
 * resolution deadline alone. An incident declared in the created state
 * starts its SLA with no response, as always. (One declared resolved starts
 * no SLA at all: CreatedClosedNoAutomations.)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-5a7e-4abc-8def-0000000000d1",
);
const RULE_ID: ObjectID = new ObjectID("0193c0de-5a7e-4abc-8def-0000000000c1");

const DECLARED_AT: Date = new Date("2026-10-06T08:00:00.000Z");

let created: Array<IncidentSla> = [];

function rule(): IncidentSlaRule {
  const slaRule: IncidentSlaRule = new IncidentSlaRule();
  slaRule._id = RULE_ID.toString();
  slaRule.name = "Critical incidents";
  slaRule.responseTimeInMinutes = 15;
  slaRule.resolutionTimeInMinutes = 120;
  return slaRule;
}

beforeEach(() => {
  created = [];

  jest
    .spyOn(IncidentSlaRuleService, "findMatchingRule")
    .mockResolvedValue(rule() as never);

  jest
    .spyOn(IncidentSlaService, "create")
    .mockImplementation((async (createBy: {
      data: IncidentSla;
    }): Promise<IncidentSla> => {
      created.push(createBy.data);
      createBy.data._id = "0193c0de-5a7e-4abc-8def-0000000000e1";
      return createBy.data;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentSlaService.createSlaForIncident - where its SLA starts", () => {
  test("declared in the created state: the SLA starts with no response, on track", async () => {
    await IncidentSlaService.createSlaForIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      declaredAt: DECLARED_AT,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.respondedAt).toBeUndefined();
    expect(created[0]!.status).toBe(IncidentSlaStatus.OnTrack);
    expect(created[0]!.slaStartedAt).toEqual(DECLARED_AT);
    expect(created[0]!.responseDeadline).toEqual(
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 15),
    );
    expect(created[0]!.resolutionDeadline).toEqual(
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 120),
    );
  });

  test("declared already acknowledged: the SLA starts responded to, when it was declared", async () => {
    await IncidentSlaService.createSlaForIncident({
      incidentId: INCIDENT_ID,
      projectId: PROJECT_ID,
      declaredAt: DECLARED_AT,
      respondedAt: DECLARED_AT,
    });

    expect(created).toHaveLength(1);
    expect(created[0]!.respondedAt).toEqual(DECLARED_AT);
    // Its deadlines are the rule's, as for any incident.
    expect(created[0]!.responseDeadline).toEqual(
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 15),
    );
    expect(created[0]!.status).toBe(IncidentSlaStatus.OnTrack);
    expect(String(created[0]!.incidentId)).toBe(INCIDENT_ID.toString());
    expect(String(created[0]!.incidentSlaRuleId)).toBe(RULE_ID.toString());
  });

  test("with no matching rule there is no SLA to start, responded or not", async () => {
    jest
      .spyOn(IncidentSlaRuleService, "findMatchingRule")
      .mockResolvedValue(null as never);

    expect(
      await IncidentSlaService.createSlaForIncident({
        incidentId: INCIDENT_ID,
        projectId: PROJECT_ID,
        declaredAt: DECLARED_AT,
        respondedAt: DECLARED_AT,
      }),
    ).toBeNull();
    expect(created).toEqual([]);
  });
});

describe("an SLA that started responded to is judged on its resolution alone", () => {
  // The status markResolved writes back for the SLA it reads.
  async function resolveWith(
    sla: IncidentSla,
    resolvedAt: Date,
  ): Promise<IncidentSlaStatus | undefined> {
    jest.spyOn(IncidentSlaService, "findBy").mockResolvedValue([sla] as never);

    const written: Array<IncidentSlaStatus | undefined> = [];

    jest
      .spyOn(IncidentSlaService, "updateOneById")
      .mockImplementation((async (updateBy: {
        data: { status?: IncidentSlaStatus };
      }): Promise<void> => {
        written.push(updateBy.data.status);
      }) as never);

    await IncidentSlaService.markResolved({
      incidentId: INCIDENT_ID,
      resolvedAt: resolvedAt,
    });

    expect(written).toHaveLength(1);
    return written[0];
  }

  function slaStarted(respondedAt: Date | undefined): IncidentSla {
    const sla: IncidentSla = new IncidentSla();
    sla._id = "0193c0de-5a7e-4abc-8def-0000000000e1";
    sla.status = IncidentSlaStatus.OnTrack;
    sla.responseDeadline = OneUptimeDate.addRemoveMinutes(DECLARED_AT, 15);
    sla.resolutionDeadline = OneUptimeDate.addRemoveMinutes(DECLARED_AT, 120);
    if (respondedAt) {
      sla.respondedAt = respondedAt;
    }
    return sla;
  }

  test("resolved within its resolution deadline, hours after the response deadline: met", async () => {
    const status: IncidentSlaStatus | undefined = await resolveWith(
      slaStarted(DECLARED_AT),
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 90),
    );

    expect(status).toBe(IncidentSlaStatus.Met);
  });

  test("the same incident with no response recorded would have been reported as a missed response", async () => {
    const status: IncidentSlaStatus | undefined = await resolveWith(
      slaStarted(undefined),
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 90),
    );

    expect(status).toBe(IncidentSlaStatus.ResponseBreached);
  });

  test("resolved after its resolution deadline: the resolution is still judged", async () => {
    const status: IncidentSlaStatus | undefined = await resolveWith(
      slaStarted(DECLARED_AT),
      OneUptimeDate.addRemoveMinutes(DECLARED_AT, 180),
    );

    expect(status).toBe(IncidentSlaStatus.ResolutionBreached);
  });
});
