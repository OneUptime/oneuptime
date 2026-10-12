/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorCriteriaObservationBuilder from "../../../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import NtpMonitorResponse from "../../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * What a new NTP monitor does with the criteria it starts with, decided by
 * the real evaluator: the step is seeded the way the dashboard seeds it and
 * every probe result goes through MonitorCriteriaEvaluator.processMonitorStep,
 * which acts on the first criteria that matches. "Up" means serving good
 * time, so a server that answers with the wrong time, or with no time at all,
 * opens the same incident as one that does not answer.
 */

type Outcome = "offline" | "online" | "no criteria";

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();

function defaultStep(): MonitorStep {
  return MonitorStep.getDefaultMonitorStep({
    monitorName: "GPS clock",
    monitorType: MonitorType.NTP,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
  });
}

function criteriaOf(monitorStep: MonitorStep): Array<MonitorCriteriaInstance> {
  return (
    monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray || []
  );
}

// A healthy stratum 2 server, 3.5 ms ahead of the probe.
function answered(
  overrides: Partial<NtpMonitorResponse> = {},
): NtpMonitorResponse {
  return {
    isOnline: true,
    isSynchronized: true,
    responseTimeInMs: 18,
    failureCause: "",
    serverAddress: "192.0.2.10",
    port: 123,
    version: 4,
    leapIndicator: 0,
    stratum: 2,
    referenceId: "192.0.2.1",
    rootDelayInMs: 12.5,
    rootDispersionInMs: 3.25,
    clockOffsetInMs: 3.5,
    roundTripDelayInMs: 17.2,
    serverTime: "2026-07-14T09:55:00.000Z",
    ...overrides,
  };
}

const NO_REPLY: string =
  "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.";

function silent(): NtpMonitorResponse {
  return {
    isOnline: false,
    isSynchronized: false,
    responseTimeInMs: 0,
    failureCause: NO_REPLY,
    isTimeout: true,
    serverAddress: "192.0.2.10",
    port: 123,
  };
}

function probeResponse(ntpResponse: NtpMonitorResponse): ProbeMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: ntpResponse.isOnline,
    isTimeout: ntpResponse.isTimeout,
    responseTimeInMs: ntpResponse.isOnline
      ? ntpResponse.responseTimeInMs
      : undefined,
    failureCause: ntpResponse.failureCause,
    ntpResponse: ntpResponse,
    monitoredAt: new Date(),
  };
}

interface Evaluation {
  outcome: Outcome;
  matched: MonitorCriteriaInstance | undefined;
  response: ProbeApiIngestResponse;
}

async function evaluate(ntpResponse: NtpMonitorResponse): Promise<Evaluation> {
  const monitorStep: MonitorStep = defaultStep();
  const dataToProcess: ProbeMonitorResponse = probeResponse(ntpResponse);

  const monitor: Monitor = new Monitor();
  monitor.id = dataToProcess.monitorId;
  monitor.projectId = dataToProcess.projectId;
  monitor.monitorType = MonitorType.NTP;

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: dataToProcess.monitorId,
        rootCause: null,
      },
      evaluationSummary: {
        evaluatedAt: new Date(),
        criteriaResults: [],
        events: [],
      } as MonitorEvaluationSummary,
    });

  const matched: MonitorCriteriaInstance | undefined = criteriaOf(
    monitorStep,
  ).find((instance: MonitorCriteriaInstance) => {
    return instance.data?.id === response.criteriaMetId;
  });

  let outcome: Outcome = "no criteria";

  if (
    matched?.data?.monitorStatusId?.toString() === OFFLINE_STATUS_ID.toString()
  ) {
    outcome = "offline";
  } else if (
    matched?.data?.monitorStatusId?.toString() === ONLINE_STATUS_ID.toString()
  ) {
    outcome = "online";
  }

  return { outcome, matched, response };
}

describe("a new NTP monitor's criteria", () => {
  test("start with the offline criteria, then the online one", () => {
    const [offline, online] = criteriaOf(defaultStep());

    expect(criteriaOf(defaultStep())).toHaveLength(2);

    expect(offline!.data!.name).toBe(
      "Check if GPS clock is not serving good time",
    );
    expect(offline!.data!.filterCondition).toBe(FilterCondition.Any);
    expect(offline!.data!.monitorStatusId?.toString()).toBe(
      OFFLINE_STATUS_ID.toString(),
    );
    expect(offline!.data!.createIncidents).toBe(true);
    expect(offline!.data!.changeMonitorStatus).toBe(true);
    expect(offline!.data!.incidents[0]!.title).toBe(
      "GPS clock is not serving good time",
    );
    expect(offline!.data!.incidents[0]!.description).toBe(
      "GPS clock did not answer, is not synchronized, or its clock is 1000 ms or more away from the probe's.",
    );
    expect(offline!.data!.incidents[0]!.autoResolveIncident).toBe(true);
    expect(offline!.data!.incidents[0]!.incidentSeverityId?.toString()).toBe(
      INCIDENT_SEVERITY_ID.toString(),
    );
    expect(offline!.data!.alerts[0]!.title).toBe(
      "GPS clock is not serving good time",
    );
    expect(offline!.data!.createAlerts).toBe(false);

    expect(online!.data!.name).toBe("Check if GPS clock serves good time");
    expect(online!.data!.filterCondition).toBe(FilterCondition.All);
    expect(online!.data!.monitorStatusId?.toString()).toBe(
      ONLINE_STATUS_ID.toString(),
    );
    expect(online!.data!.createIncidents).toBe(false);
    expect(online!.data!.createAlerts).toBe(false);
  });

  test("the offline criteria is the exact complement of the online one", () => {
    const [offline, online] = criteriaOf(defaultStep());

    const summarize: (filters: Array<CriteriaFilter>) => Array<string> = (
      filters: Array<CriteriaFilter>,
    ): Array<string> => {
      return filters.map((filter: CriteriaFilter) => {
        return `${filter.checkOn} ${filter.filterType} ${filter.value ?? ""}`.trim();
      });
    };

    expect(summarize(online!.data!.filters)).toEqual([
      "NTP Is Online True",
      "NTP Is Synchronized True",
      "NTP Clock Offset (in ms) Less Than 1000",
    ]);
    expect(summarize(offline!.data!.filters)).toEqual([
      "NTP Is Online False",
      "NTP Is Synchronized False",
      "NTP Clock Offset (in ms) Greater Than Or Equal To 1000",
    ]);
  });

  test("no filter evaluates over time by default", () => {
    for (const instance of criteriaOf(defaultStep())) {
      for (const filter of instance.data!.filters) {
        expect(filter.evaluateOverTime).toBeFalsy();
      }
    }
  });
});

describe("what a new NTP monitor does with a check", () => {
  test("a healthy server is online and raises nothing", async () => {
    const evaluation: Evaluation = await evaluate(answered());

    expect(evaluation.outcome).toBe("online");
    expect(evaluation.matched?.data?.createIncidents).toBe(false);
  });

  test("a server 999.9 ms behind is still online", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({ clockOffsetInMs: -999.9 }),
    );

    expect(evaluation.outcome).toBe("online");
  });

  test("a server exactly 1000 ms ahead is offline", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({ clockOffsetInMs: 1000 }),
    );

    expect(evaluation.outcome).toBe("offline");
  });

  test("a server 1.5 seconds behind is offline, and the root cause says how far", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({ clockOffsetInMs: -1500 }),
    );

    expect(evaluation.outcome).toBe("offline");
    expect(evaluation.response.rootCause).toContain(
      "1,500 ms behind the probe",
    );
  });

  test("a silent server is offline, and the root cause says why", async () => {
    const evaluation: Evaluation = await evaluate(silent());

    expect(evaluation.outcome).toBe("offline");
    expect(evaluation.matched?.data?.createIncidents).toBe(true);
    expect(evaluation.response.rootCause).toContain(NO_REPLY);
  });

  test("a kiss-o'-death is offline, and the root cause names the code", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({
        isSynchronized: false,
        stratum: 0,
        kissCode: "RATE",
        leapIndicator: 3,
        referenceId: "RATE",
        clockOffsetInMs: undefined,
        roundTripDelayInMs: undefined,
        serverTime: undefined,
        failureCause:
          "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
      }),
    );

    expect(evaluation.outcome).toBe("offline");
    expect(evaluation.response.rootCause).toContain("0 (kiss-o'-death RATE)");
    expect(evaluation.response.rootCause).toContain("rate-limiting");
  });

  test("an answering server at stratum 16 is offline", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({
        isSynchronized: false,
        stratum: 16,
        failureCause:
          "The server reports stratum 16: it is not synchronized to a time source.",
      }),
    );

    expect(evaluation.outcome).toBe("offline");
    expect(evaluation.response.rootCause).toContain("16 (not synchronized)");
  });

  test("an answering server with the leap alarm is offline", async () => {
    const evaluation: Evaluation = await evaluate(
      answered({
        isSynchronized: false,
        leapIndicator: 3,
        failureCause:
          "The server reports its clock as not synchronized (leap indicator 3, alarm).",
      }),
    );

    expect(evaluation.outcome).toBe("offline");
    expect(evaluation.response.rootCause).toContain("Leap Indicator: 3");
  });
});

describe("MonitorCriteriaEvaluator.getNtpResponseDetails", () => {
  test("lists what the server said, in the order an engineer reads it", () => {
    expect(
      MonitorCriteriaEvaluator.getNtpResponseDetails(answered()).map(String),
    ).toEqual([
      "- Synchronized: Yes",
      "- Stratum: 2 (secondary server)",
      "- Clock Offset: 3.5 ms ahead of the probe",
      "- Leap Indicator: 0 (No leap second pending)",
      "- Reference: 192.0.2.1",
      "- Root Dispersion: 3.25 ms",
      "- Server Address: 192.0.2.10",
    ]);
  });

  test("leaves out what a kiss-o'-death does not carry", () => {
    const lines: Array<string> = MonitorCriteriaEvaluator.getNtpResponseDetails(
      {
        isOnline: true,
        isSynchronized: false,
        responseTimeInMs: 20,
        failureCause: "",
        stratum: 0,
        kissCode: "DENY",
      },
    ).map(String);

    expect(lines).toEqual([
      "- Synchronized: No",
      "- Stratum: 0 (kiss-o'-death DENY)",
    ]);
  });
});

describe("MonitorCriteriaObservationBuilder.describeNtpObservation", () => {
  function observe(
    criteriaFilter: CriteriaFilter,
    ntpResponse: NtpMonitorResponse,
  ): string | null {
    return MonitorCriteriaObservationBuilder.describeNtpObservation({
      criteriaFilter: criteriaFilter,
      dataToProcess: probeResponse(ntpResponse),
    });
  }

  function filter(checkOn: CheckOn): CriteriaFilter {
    return { checkOn, filterType: FilterType.True, value: undefined };
  }

  test("NTP Is Online", () => {
    expect(observe(filter(CheckOn.NtpIsOnline), answered())).toBe(
      "The NTP server answered",
    );
    expect(observe(filter(CheckOn.NtpIsOnline), silent())).toBe(
      "The NTP server did not answer: No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times",
    );
  });

  test("NTP Is Synchronized", () => {
    expect(observe(filter(CheckOn.NtpIsSynchronized), answered())).toBe(
      "The NTP server is synchronized, at stratum 2",
    );
    expect(
      observe(
        filter(CheckOn.NtpIsSynchronized),
        answered({
          isSynchronized: false,
          stratum: 16,
          failureCause:
            "The server reports stratum 16: it is not synchronized to a time source.",
        }),
      ),
    ).toBe(
      "The NTP server is not synchronized: The server reports stratum 16: it is not synchronized to a time source",
    );
    expect(observe(filter(CheckOn.NtpIsSynchronized), silent())).toContain(
      "so its synchronization was not checked",
    );
  });

  test("NTP Stratum", () => {
    expect(observe(filter(CheckOn.NtpStratum), answered({ stratum: 1 }))).toBe(
      "NTP Stratum was 1 (primary server)",
    );
    expect(observe(filter(CheckOn.NtpStratum), silent())).toContain(
      "so it reported no stratum",
    );
  });

  test("NTP Clock Offset", () => {
    expect(
      observe(
        filter(CheckOn.NtpClockOffset),
        answered({ clockOffsetInMs: -12.34 }),
      ),
    ).toBe(
      "NTP Clock Offset (in ms) was 12.3 ms: the server's clock is 12.3 ms behind the probe",
    );
    expect(
      observe(
        filter(CheckOn.NtpClockOffset),
        answered({ clockOffsetInMs: undefined }),
      ),
    ).toBe(
      "The NTP reply carried no usable time, so no clock offset was measured",
    );
    expect(observe(filter(CheckOn.NtpClockOffset), silent())).toContain(
      "so no clock offset was measured",
    );
  });

  test("NTP Root Dispersion", () => {
    expect(
      observe(
        filter(CheckOn.NtpRootDispersion),
        answered({ rootDispersionInMs: 8180.6 }),
      ),
    ).toBe("NTP Root Dispersion (in ms) was 8,181 ms");
    expect(
      observe(
        filter(CheckOn.NtpRootDispersion),
        answered({ rootDispersionInMs: undefined }),
      ),
    ).toBe("The NTP reply carried no root dispersion");
  });

  test("NTP Response Time", () => {
    expect(observe(filter(CheckOn.NtpResponseTime), answered())).toBe(
      "NTP Response Time (in ms) was 18 ms",
    );
    expect(observe(filter(CheckOn.NtpResponseTime), silent())).toContain(
      "so there is no response time",
    );
  });

  test("names the window of an over-time filter", () => {
    const observation: string | null = observe(
      {
        checkOn: CheckOn.NtpStratum,
        filterType: FilterType.GreaterThan,
        value: "2",
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 10,
          evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
        },
      },
      answered({ stratum: 3 }),
    );

    expect(observation).toContain("NTP Stratum was 3 (secondary server)");
    expect(observation).toContain("10");
  });

  test("a CheckOn of another type is not described here", () => {
    expect(observe(filter(CheckOn.IsOnline), answered())).toBeNull();
  });

  test("describeFilterObservation routes every NTP CheckOn here", () => {
    const monitorStep: MonitorStep = defaultStep();
    const monitor: Monitor = new Monitor();
    monitor.monitorType = MonitorType.NTP;

    for (const checkOn of [
      CheckOn.NtpIsOnline,
      CheckOn.NtpIsSynchronized,
      CheckOn.NtpStratum,
      CheckOn.NtpClockOffset,
      CheckOn.NtpResponseTime,
      CheckOn.NtpRootDispersion,
    ]) {
      const observation: string | null =
        MonitorCriteriaObservationBuilder.describeFilterObservation({
          monitor: monitor,
          monitorStep: monitorStep,
          criteriaFilter: filter(checkOn),
          dataToProcess: probeResponse(answered()),
        });

      expect({ checkOn, observation }).toEqual({
        checkOn,
        observation: expect.stringContaining("NTP"),
      });
    }
  });
});
