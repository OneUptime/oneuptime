import IncomingRequestIncidentGrouping, {
  GROUPING_NOTE_TITLES,
  IncomingRequestGroupingDecision,
  IncomingRequestGroupingScan,
} from "../../../../Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import IncidentGroupingConfig from "../../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import {
  MonitorEvaluationFilterResult,
  MonitorEvaluationGroupingNote,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

function makeRequest(
  requestBody: JSONObject | string | undefined,
  overrides?: Partial<IncomingMonitorRequest>,
): DataToProcess {
  const request: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    requestBody: requestBody,
    incomingRequestReceivedAt: new Date(0),
    checkedAt: new Date(0),
    ...overrides,
  };

  return request as unknown as DataToProcess;
}

function makeCriteria(
  grouping: IncidentGroupingConfig | undefined,
  id: string = "criteria-1",
): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data!.id = id;
  criteria.data!.name = "Firing";
  criteria.data!.incidentGrouping = grouping;
  return criteria;
}

function decide(input: {
  dataToProcess: DataToProcess;
  criteriaInstance: MonitorCriteriaInstance;
  filterResults?: Array<MonitorEvaluationFilterResult> | undefined;
}): IncomingRequestGroupingDecision {
  return IncomingRequestIncidentGrouping.decideForMatchedCriteria({
    dataToProcess: input.dataToProcess,
    criteriaInstance: input.criteriaInstance,
    filterResults: input.filterResults || [],
  });
}

// The values a criteria that matched this request opens one each for.
function firingMatches(input: {
  dataToProcess: DataToProcess;
  criteriaInstance: MonitorCriteriaInstance;
}): Array<PerSeriesCriteriaMatch> {
  return decide(input).perKeyMatches || [];
}

function scan(
  requestBody: JSONObject | null,
  grouping: IncidentGroupingConfig,
): IncomingRequestGroupingScan {
  return IncomingRequestIncidentGrouping.scanRequestBody({
    requestBody: requestBody,
    grouping: grouping,
  });
}

// Grafana / Alertmanager-shaped payloads.
function firingAlertmanagerPayload(): JSONObject {
  return {
    status: "firing",
    alerts: [
      { status: "firing", labels: { alertname: "High RAM Usage" } },
      { status: "firing", labels: { alertname: "High CPU Usage" } },
      { status: "firing", labels: { alertname: "High Disk Usage" } },
    ],
  };
}

const PER_ALERT: IncidentGroupingConfig = {
  groupByJSONPath: "requestBody.alerts[*].labels.alertname",
  resolvedWhenJSONPath: "requestBody.alerts[*].status",
  resolvedWhenValue: "resolved",
};

describe("IncomingRequestIncidentGrouping", () => {
  describe("the values a matched criteria opens one each for", () => {
    it("returns one firing match per array element (Grafana alerts[*])", () => {
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(firingAlertmanagerPayload()),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.alerts[*].labels.alertname",
        }),
      });

      expect(matches).toHaveLength(3);
      expect(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.labels;
        }),
      ).toEqual([
        { alertname: "High RAM Usage" },
        { alertname: "High CPU Usage" },
        { alertname: "High Disk Usage" },
      ]);
      // Distinct keys produce distinct fingerprints (=> concurrent incidents).
      const fingerprints: Set<string> = new Set<string>(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.fingerprint;
        }),
      );
      expect(fingerprints.size).toBe(3);
      expect(
        matches.every((m: PerSeriesCriteriaMatch) => {
          return m.criteriaMetId === "criteria-1";
        }),
      ).toBe(true);
    });

    it("names the key in each match's root cause, as code", () => {
      const [match] = firingMatches({
        dataToProcess: makeRequest({ commonLabels: { alertname: "a`b" } }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.commonLabels.alertname",
        }),
      });

      // A longer fence around a value holding a backtick: it cannot close the span.
      expect(match!.rootCause).toBe(
        "Incoming request matched grouping key `` a`b ``.",
      );
      expect(match!.metricContext).toBeUndefined();
    });

    it("supports a simple (non-array) group-by path", () => {
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest({
          commonLabels: { alertname: "Disk Full" },
        }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.commonLabels.alertname",
        }),
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Disk Full" });
    });

    it("parses a raw JSON string body", () => {
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(
          JSON.stringify({ commonLabels: { alertname: "Stringified" } }),
        ),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.commonLabels.alertname",
        }),
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Stringified" });
    });

    it("excludes elements classified as resolved (per-element status)", () => {
      const payload: JSONObject = {
        status: "firing",
        alerts: [
          { status: "firing", labels: { alertname: "Still Firing" } },
          { status: "resolved", labels: { alertname: "Recovered" } },
        ],
      };

      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(payload),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Still Firing" });
    });

    it("excludes everything when the whole payload is resolved (payload-level status)", () => {
      const payload: JSONObject = {
        status: "resolved",
        commonLabels: { alertname: "High CPU Usage" },
      };

      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(payload),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.commonLabels.alertname",
          resolvedWhenJSONPath: "requestBody.status",
          resolvedWhenValue: "resolved",
        }),
      });

      expect(matches).toEqual([]);
    });

    it("dedupes the same key appearing twice in one payload", () => {
      const payload: JSONObject = {
        alerts: [
          { labels: { alertname: "Dup" } },
          { labels: { alertname: "Dup" } },
        ],
      };

      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(payload),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.alerts[*].labels.alertname",
        }),
      });

      expect(matches).toHaveLength(1);
    });

    it("caps the number of keys at maxKeysPerPayload", () => {
      const payload: JSONObject = {
        alerts: Array.from({ length: 10 }, (_unused: unknown, i: number) => {
          return { labels: { alertname: `alert-${i}` } };
        }),
      };

      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(payload),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.alerts[*].labels.alertname",
          maxKeysPerPayload: 3,
        }),
      });

      expect(matches).toHaveLength(3);
    });
  });

  describe("decideForMatchedCriteria: how a criteria that matched acts on the request", () => {
    it("a criteria without grouping acts once for the whole monitor, whatever the request holds", () => {
      for (const body of [
        firingAlertmanagerPayload(),
        { test: "test" },
        "not json",
        undefined,
      ]) {
        const decision: IncomingRequestGroupingDecision = decide({
          dataToProcess: makeRequest(body as JSONObject | string | undefined),
          criteriaInstance: makeCriteria(undefined),
        });

        expect(decision).toEqual({ perKeyMatches: undefined });
      }
    });

    it("an empty grouping path is no grouping", () => {
      expect(
        decide({
          dataToProcess: makeRequest(firingAlertmanagerPayload()),
          criteriaInstance: makeCriteria({ groupByJSONPath: "" }),
        }),
      ).toEqual({ perKeyMatches: undefined });
    });

    it("a grouped criteria with values opens one per firing value and says nothing more", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest(firingAlertmanagerPayload()),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(decision.perKeyMatches).toHaveLength(3);
      expect(decision.note).toBeUndefined();
      expect(decision.rootCauseNote).toBeUndefined();
    });

    it("a request whose values all recovered opens nothing new, and says why", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({
          alerts: [
            { status: "resolved", labels: { alertname: "High CPU Usage" } },
            { status: "resolved", labels: { alertname: "High RAM Usage" } },
          ],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(decision.perKeyMatches).toEqual([]);
      expect(decision.note).toEqual({
        title: GROUPING_NOTE_TITLES.nothingNew,
        message:
          'Every value at requestBody.alerts[*].labels.alertname in this request reported recovered, so criteria "Firing" opened nothing new.',
        details: {
          outcome: "values-recovered",
          criteriaName: "Firing",
          path: "requestBody.alerts[*].labels.alertname",
        },
      });
      expect(decision.rootCauseNote).toBeUndefined();
    });

    it("a request with no value acts for the whole monitor, rather than opening nothing", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({ test: "test" }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.groupLabels.alertname",
          resolvedWhenJSONPath: "requestBody.alerts[*].status",
          resolvedWhenValue: "resolved",
        }),
      });

      expect(decision.perKeyMatches).toBeUndefined();
      expect(decision.note).toEqual({
        title: GROUPING_NOTE_TITLES.noValue,
        message:
          'This request has no value at requestBody.groupLabels.alertname, so criteria "Firing" handled it without grouping, once for the whole monitor.',
        details: {
          outcome: "no-value",
          criteriaName: "Firing",
          path: "requestBody.groupLabels.alertname",
        },
      });
      expect(decision.rootCauseNote?.toString()).toBe(
        "**Grouping**: The request had no value at `requestBody.groupLabels.alertname`, so it counts for the whole monitor rather than for one value.",
      );
    });

    it("names the path as the project wrote it, braces and all", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({ test: "test" }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "  {{requestBody.groupLabels.alertname}} ",
        }),
      });

      expect(decision.note?.message).toContain(
        "no value at {{requestBody.groupLabels.alertname}}, so",
      );
      // The Dashboard draws the path as written too.
      expect(decision.note?.details.path).toBe(
        "{{requestBody.groupLabels.alertname}}",
      );
    });

    it("keeps a path that holds Markdown as code in the root cause", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({ test: "test" }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.a`[x](https://evil.example)",
        }),
      });

      expect(decision.perKeyMatches).toBeUndefined();
      // Fenced longer than the backtick inside it, so the link stays text.
      expect(decision.rootCauseNote?.toString()).toBe(
        "**Grouping**: The request had no value at `` requestBody.a`[x](https://evil.example) ``, so it counts for the whole monitor rather than for one value.",
      );
    });

    it("every body without a JSON object to read acts for the whole monitor", () => {
      for (const body of [
        undefined,
        "",
        "plain text",
        JSON.stringify(["an", "array"]),
        JSON.stringify("a string"),
        "{not json",
      ]) {
        const decision: IncomingRequestGroupingDecision = decide({
          dataToProcess: makeRequest(body),
          criteriaInstance: makeCriteria(PER_ALERT),
        });

        expect({ body, perKeyMatches: decision.perKeyMatches }).toEqual({
          body,
          perKeyMatches: undefined,
        });
        expect(decision.note?.title).toBe(GROUPING_NOTE_TITLES.noValue);
      }
    });

    it("a path not rooted at requestBody never finds a value, so it acts for the whole monitor", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest(firingAlertmanagerPayload()),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "alerts[*].labels.alertname",
        }),
      });

      expect(decision.perKeyMatches).toBeUndefined();
      expect(decision.note?.message).toBe(
        'This request has no value at alerts[*].labels.alertname, so criteria "Firing" handled it without grouping, once for the whole monitor.',
      );
    });

    it("a request with no value that reports recovered opens nothing new", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({ status: "resolved" }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.commonLabels.alertname",
          resolvedWhenJSONPath: "requestBody.status",
          resolvedWhenValue: "resolved",
        }),
      });

      expect(decision.perKeyMatches).toEqual([]);
      expect(decision.note).toEqual({
        title: GROUPING_NOTE_TITLES.nothingNew,
        message:
          'This request has no value at requestBody.commonLabels.alertname and reported recovered, so criteria "Firing" opened nothing new.',
        details: {
          outcome: "no-value-recovered",
          criteriaName: "Firing",
          path: "requestBody.commonLabels.alertname",
        },
      });
    });

    it("named values beside items with none: the named ones open, and the rest are counted", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({
          alerts: [
            { status: "firing", labels: { alertname: "High CPU Usage" } },
            { status: "firing", labels: {} },
          ],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(
        decision.perKeyMatches!.map((match: PerSeriesCriteriaMatch) => {
          return match.labels;
        }),
      ).toEqual([{ alertname: "High CPU Usage" }]);
      expect(decision.note).toEqual({
        title: GROUPING_NOTE_TITLES.someItemsWithoutValue,
        message:
          "1 item in this request has no value at requestBody.alerts[*].labels.alertname, so it opened nothing of its own.",
        details: {
          outcome: "some-without-value",
          criteriaName: "Firing",
          path: "requestBody.alerts[*].labels.alertname",
          itemsWithoutValue: 1,
        },
      });
      expect(decision.rootCauseNote).toBeUndefined();
    });

    it("counts several such items in the plural, and leaves out those that recovered", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({
          alerts: [
            { status: "firing", labels: { alertname: "High CPU Usage" } },
            { status: "firing" },
            "a string",
            { status: "resolved" },
            { status: "firing", labels: { alertname: null } },
          ],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(decision.perKeyMatches).toHaveLength(1);
      expect(decision.note?.message).toBe(
        "3 items in this request have no value at requestBody.alerts[*].labels.alertname, so they opened nothing of their own.",
      );
      expect(decision.note?.details.itemsWithoutValue).toBe(3);
    });

    it("recovered values beside a firing item with none: the request names values, so nothing new opens, and the item is counted", () => {
      /*
       * Whether an item without a value pages must not depend on its
       * siblings: a request that names values is grouped, whatever state
       * they are in, and only one that names none at all is handled for
       * the whole monitor.
       */
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({
          alerts: [
            { status: "resolved", labels: { alertname: "High CPU Usage" } },
            { status: "firing", labels: {} },
          ],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(decision.perKeyMatches).toEqual([]);
      expect(decision.rootCauseNote).toBeUndefined();
      expect(decision.note).toEqual({
        title: GROUPING_NOTE_TITLES.nothingNew,
        message:
          'Every value at requestBody.alerts[*].labels.alertname in this request reported recovered, so criteria "Firing" opened nothing new. 1 item in this request has no value at requestBody.alerts[*].labels.alertname, so it opened nothing of its own.',
        details: {
          outcome: "values-recovered",
          criteriaName: "Firing",
          path: "requestBody.alerts[*].labels.alertname",
          itemsWithoutValue: 1,
        },
      });
    });

    it("the same item beside a firing value: that value opens, and the item is counted the same way", () => {
      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({
          alerts: [
            { status: "firing", labels: { alertname: "High CPU Usage" } },
            { status: "firing", labels: {} },
          ],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(decision.perKeyMatches).toHaveLength(1);
      expect(decision.note?.title).toBe(
        GROUPING_NOTE_TITLES.someItemsWithoutValue,
      );
    });

    it("a criteria with no id has nothing to tie a value to, and acts as without grouping", () => {
      const criteria: MonitorCriteriaInstance = makeCriteria(PER_ALERT, "");

      expect(
        decide({
          dataToProcess: makeRequest(firingAlertmanagerPayload()),
          criteriaInstance: criteria,
        }),
      ).toEqual({ perKeyMatches: undefined });
    });

    describe("on the background check, which re-reads the last request", () => {
      const silenceMet: MonitorEvaluationFilterResult = {
        checkOn: CheckOn.IncomingRequest,
        filterType: FilterType.NotRecievedInMinutes,
        value: 10,
        message: "No request in 10 minutes.",
        met: true,
      };

      const background: DataToProcess = makeRequest(
        firingAlertmanagerPayload(),
        { onlyCheckForIncomingRequestReceivedAt: true },
      );

      it("a match because requests stopped arriving acts for the whole monitor", () => {
        const decision: IncomingRequestGroupingDecision = decide({
          dataToProcess: background,
          criteriaInstance: makeCriteria(PER_ALERT),
          filterResults: [silenceMet],
        });

        expect(decision.perKeyMatches).toBeUndefined();
        expect(decision.note).toEqual({
          title: GROUPING_NOTE_TITLES.noRequest,
          message:
            'Criteria "Firing" matched because requests stopped arriving, so it handled this without grouping, once for the whole monitor.',
          details: { outcome: "no-request", criteriaName: "Firing" },
        });
        expect(decision.rootCauseNote?.toString()).toBe(
          "**Grouping**: Requests stopped arriving, so there was no value to group by. It counts for the whole monitor rather than for one value.",
        );
      });

      it("a match by re-reading the request opens nothing new, its values were handled when it arrived", () => {
        for (const filterResults of [
          [],
          [{ ...silenceMet, met: false }],
          [
            {
              ...silenceMet,
              filterType: FilterType.RecievedInMinutes,
            },
          ],
          [
            {
              checkOn: CheckOn.RequestBody,
              filterType: FilterType.Contains,
              value: "firing",
              message: "Request body contains firing.",
              met: true,
            },
          ],
        ]) {
          const decision: IncomingRequestGroupingDecision = decide({
            dataToProcess: background,
            criteriaInstance: makeCriteria(PER_ALERT),
            filterResults: filterResults,
          });

          expect(decision.perKeyMatches).toEqual([]);
          expect(decision.note).toEqual({
            title: GROUPING_NOTE_TITLES.nothingNew,
            message:
              'The background check re-read the last request. Criteria "Firing" opens one per value only when a request arrives.',
            details: { outcome: "re-read", criteriaName: "Firing" },
          });
        }
      });

      it("a criteria without grouping is not grouped there either", () => {
        expect(
          decide({
            dataToProcess: background,
            criteriaInstance: makeCriteria(undefined),
            filterResults: [silenceMet],
          }),
        ).toEqual({ perKeyMatches: undefined });
      });
    });

    it("a criteria without a name leaves it to the Dashboard to name, and the English calls it unnamed", () => {
      const criteria: MonitorCriteriaInstance = makeCriteria({
        groupByJSONPath: "requestBody.groupLabels.alertname",
      });
      criteria.data!.name = "";

      const decision: IncomingRequestGroupingDecision = decide({
        dataToProcess: makeRequest({ test: "test" }),
        criteriaInstance: criteria,
      });

      // The Dashboard names it as its criteria list does: "Criteria 2".
      expect(decision.note?.details).toEqual({
        outcome: "no-value",
        criteriaName: undefined,
        path: "requestBody.groupLabels.alertname",
      });
      expect(decision.note?.message).toBe(
        'This request has no value at requestBody.groupLabels.alertname, so criteria "Unnamed criteria" handled it without grouping, once for the whole monitor.',
      );
    });
  });

  /*
   * The monitor log stores each grouping note twice: what it says
   * (details), which the Dashboard words in the reader's language, and the
   * same note in English (title and message), for anything that reads the
   * log without the Dashboard. One function writes the English from the
   * details, so the two never say different things.
   */
  describe("describeNote: the English of a grouping note, from what it says", () => {
    const PATH: string = "requestBody.alerts[*].labels.alertname";

    it.each([
      {
        details: {
          outcome: "no-value",
          criteriaName: "Firing",
          path: PATH,
        },
        title: "No value to group by",
        message: `This request has no value at ${PATH}, so criteria "Firing" handled it without grouping, once for the whole monitor.`,
      },
      {
        details: { outcome: "no-request", criteriaName: "Silence" },
        title: "No request to group by",
        message:
          'Criteria "Silence" matched because requests stopped arriving, so it handled this without grouping, once for the whole monitor.',
      },
      {
        details: {
          outcome: "values-recovered",
          criteriaName: "Firing",
          path: PATH,
        },
        title: "Nothing new to open",
        message: `Every value at ${PATH} in this request reported recovered, so criteria "Firing" opened nothing new.`,
      },
      {
        details: {
          outcome: "values-recovered",
          criteriaName: "Firing",
          path: PATH,
          itemsWithoutValue: 2,
        },
        title: "Nothing new to open",
        message: `Every value at ${PATH} in this request reported recovered, so criteria "Firing" opened nothing new. 2 items in this request have no value at ${PATH}, so they opened nothing of their own.`,
      },
      {
        details: {
          outcome: "no-value-recovered",
          criteriaName: "Firing",
          path: PATH,
        },
        title: "Nothing new to open",
        message: `This request has no value at ${PATH} and reported recovered, so criteria "Firing" opened nothing new.`,
      },
      {
        details: { outcome: "re-read", criteriaName: "Firing" },
        title: "Nothing new to open",
        message:
          'The background check re-read the last request. Criteria "Firing" opens one per value only when a request arrives.',
      },
      {
        details: {
          outcome: "some-without-value",
          criteriaName: "Firing",
          path: PATH,
          itemsWithoutValue: 1,
        },
        title: "Not every item has a value to group by",
        message: `1 item in this request has no value at ${PATH}, so it opened nothing of its own.`,
      },
      {
        details: {
          outcome: "some-without-value",
          criteriaName: "Firing",
          path: PATH,
          itemsWithoutValue: 4,
        },
        title: "Not every item has a value to group by",
        message: `4 items in this request have no value at ${PATH}, so they opened nothing of their own.`,
      },
    ] as Array<{
      details: MonitorEvaluationGroupingNote;
      title: string;
      message: string;
    }>)(
      "$details.outcome ($details.itemsWithoutValue items without a value)",
      (expected: {
        details: MonitorEvaluationGroupingNote;
        title: string;
        message: string;
      }) => {
        expect(
          IncomingRequestIncidentGrouping.describeNote(expected.details),
        ).toEqual({
          title: expected.title,
          message: expected.message,
          details: expected.details,
        });
      },
    );

    it("every title is one of the monitor log's titles", () => {
      expect(Object.values(GROUPING_NOTE_TITLES).sort()).toEqual(
        [
          "No request to group by",
          "No value to group by",
          "Not every item has a value to group by",
          "Nothing new to open",
        ].sort(),
      );
    });
  });

  describe("scanRequestBody: the values a request holds, and the parts that hold none", () => {
    it("counts the request itself when a simple path finds no value", () => {
      expect(
        scan({ test: "test" }, { groupByJSONPath: "requestBody.a.b" }),
      ).toEqual({ items: [], firingWithoutValue: 1, recoveredWithoutValue: 0 });
    });

    it("...or the request itself when its array is missing, not an array, or empty", () => {
      for (const body of [
        {},
        { alerts: "not a list" },
        { alerts: { not: "a list" } },
        { alerts: [] },
      ]) {
        expect(scan(body as JSONObject, PER_ALERT)).toEqual({
          items: [],
          firingWithoutValue: 1,
          recoveredWithoutValue: 0,
        });
      }
    });

    it("counts a body that is not a JSON object as one part that cannot recover", () => {
      expect(scan(null, PER_ALERT)).toEqual({
        items: [],
        firingWithoutValue: 1,
        recoveredWithoutValue: 0,
      });
    });

    it("counts each element without a value, firing or recovered by its own status", () => {
      const result: IncomingRequestGroupingScan = scan(
        {
          alerts: [
            { status: "firing", labels: { alertname: "A" } },
            { status: "firing", labels: { alertname: "" } },
            { status: "resolved", labels: {} },
            7,
            null,
            [],
          ],
        },
        PER_ALERT,
      );

      expect(
        result.items.map((item: { keyValue: string }) => {
          return item.keyValue;
        }),
      ).toEqual(["A"]);
      // The "" value, 7, null and [] are firing parts: none can say it recovered.
      expect(result.firingWithoutValue).toBe(4);
      expect(result.recoveredWithoutValue).toBe(1);
    });

    it("reads no element past the cap, named or not", () => {
      const result: IncomingRequestGroupingScan = scan(
        {
          alerts: [
            { labels: { alertname: "A" } },
            { labels: {} },
            { labels: { alertname: "B" } },
            { labels: {} },
            { labels: {} },
          ],
        },
        { ...PER_ALERT, maxKeysPerPayload: 2 },
      );

      expect(result.items).toHaveLength(2);
      expect(result.firingWithoutValue).toBe(1);
    });

    it("reads a long list of elements without a value in time in line with its length", () => {
      const alerts: Array<JSONObject> = Array.from(
        { length: 200000 },
        (_unused: unknown, index: number) => {
          return { status: index % 2 ? "firing" : "resolved", labels: {} };
        },
      );
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          const result: IncomingRequestGroupingScan = scan(
            { status: "firing", alerts: alerts },
            {
              groupByJSONPath: "requestBody.alerts[*].labels.alertname",
              resolvedWhenJSONPath: "requestBody.status",
              resolvedWhenValue: "resolved",
            },
          );

          expect(result.firingWithoutValue).toBe(200000);
        },
        limitInMs: 10000,
      });
      expect(timed.inMs).toBeLessThan(10000);
    });
  });

  describe("collectRecoveries: the values a request reports recovered", () => {
    function resolvedFingerprints(input: {
      dataToProcess: DataToProcess;
      criteriaInstances: Array<MonitorCriteriaInstance>;
    }): Array<string> {
      return IncomingRequestIncidentGrouping.collectRecoveries(input)
        .fingerprints;
    }

    it("returns the fingerprints the payload marks resolved", () => {
      const payload: JSONObject = {
        alerts: [
          { status: "firing", labels: { alertname: "Still Firing" } },
          { status: "resolved", labels: { alertname: "Recovered" } },
        ],
      };

      const resolved: Array<string> = resolvedFingerprints({
        dataToProcess: makeRequest(payload),
        criteriaInstances: [makeCriteria(PER_ALERT)],
      });

      expect(resolved).toHaveLength(1);

      /*
       * The resolved fingerprint must equal the firing fingerprint for the
       * same key — otherwise resolution would target the wrong incident.
       */
      const firingForRecovered: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest({
          alerts: [{ status: "firing", labels: { alertname: "Recovered" } }],
        }),
        criteriaInstance: makeCriteria(PER_ALERT),
      });

      expect(resolved[0]).toBe(firingForRecovered[0]!.fingerprint);
    });

    it("returns [] when no resolve classifier is configured", () => {
      expect(
        resolvedFingerprints({
          dataToProcess: makeRequest({ status: "resolved" }),
          criteriaInstances: [
            makeCriteria({
              groupByJSONPath: "requestBody.commonLabels.alertname",
            }),
          ],
        }),
      ).toEqual([]);
    });

    it("reads every grouped criteria of the monitor, whichever the request matched, and skips the ones without grouping", () => {
      expect(
        resolvedFingerprints({
          dataToProcess: makeRequest({
            team: "payments",
            state: "ok",
            alerts: [{ status: "resolved", labels: { alertname: "CPU" } }],
          }),
          criteriaInstances: [
            makeCriteria(undefined, "plain"),
            makeCriteria(PER_ALERT, "per-alert"),
            makeCriteria(
              {
                groupByJSONPath: "requestBody.team",
                resolvedWhenJSONPath: "requestBody.state",
                resolvedWhenValue: "ok",
              },
              "per-team",
            ),
          ],
        }),
      ).toHaveLength(2);
    });

    it("returns [] for a request with no value, and on the background check", () => {
      expect(
        resolvedFingerprints({
          dataToProcess: makeRequest({ status: "resolved" }),
          criteriaInstances: [makeCriteria(PER_ALERT)],
        }),
      ).toEqual([]);

      expect(
        resolvedFingerprints({
          dataToProcess: makeRequest(
            {
              alerts: [{ status: "resolved", labels: { alertname: "CPU" } }],
            },
            { onlyCheckForIncomingRequestReceivedAt: true },
          ),
          criteriaInstances: [makeCriteria(PER_ALERT)],
        }),
      ).toEqual([]);
    });
  });

  describe("collectRecoveries: the matched criteria's incident for the whole monitor", () => {
    const ROOT_RECOVERY: IncidentGroupingConfig = {
      groupByJSONPath: "requestBody.commonLabels.alertname",
      resolvedWhenJSONPath: "requestBody.status",
      resolvedWhenValue: "resolved",
    };

    function wholeMonitor(
      requestBody: JSONObject | string,
      criteriaInstances: Array<MonitorCriteriaInstance>,
      matchedCriteriaId: string | undefined,
      overrides?: Partial<IncomingMonitorRequest>,
    ): Array<string> {
      return IncomingRequestIncidentGrouping.collectRecoveries({
        dataToProcess: makeRequest(requestBody, overrides),
        criteriaInstances: criteriaInstances,
        matchedCriteriaId: matchedCriteriaId,
      }).wholeMonitorCriteriaIds;
    }

    it("names the matched grouped criteria when a request with no value reports recovered", () => {
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria(ROOT_RECOVERY, "root")],
          "root",
        ),
      ).toEqual(["root"]);
    });

    it("does so for items with no value that each report recovered too", () => {
      expect(
        wholeMonitor(
          {
            alerts: [
              { status: "resolved" },
              { status: "resolved", labels: {} },
            ],
          },
          [makeCriteria(PER_ALERT, "per-alert")],
          "per-alert",
        ),
      ).toEqual(["per-alert"]);
    });

    it("and when such items come beside named values, whatever their state", () => {
      /*
       * A source can send an item's recovery with other alerts in the same
       * request. What the items without a value say is what counts.
       */
      expect(
        wholeMonitor(
          {
            alerts: [
              { status: "firing", labels: { alertname: "CPU" } },
              { status: "resolved" },
            ],
          },
          [makeCriteria(PER_ALERT, "per-alert")],
          "per-alert",
        ),
      ).toEqual(["per-alert"]);
    });

    it("not while any item with no value still fires, or when the request has none", () => {
      expect(
        wholeMonitor(
          { alerts: [{ status: "resolved" }, { status: "firing" }] },
          [makeCriteria(PER_ALERT, "per-alert")],
          "per-alert",
        ),
      ).toEqual([]);

      // Every item is named: nothing speaks for the whole monitor.
      expect(
        wholeMonitor(
          {
            alerts: [{ status: "resolved", labels: { alertname: "CPU" } }],
          },
          [makeCriteria(PER_ALERT, "per-alert")],
          "per-alert",
        ),
      ).toEqual([]);
    });

    it("only for the criteria the request matched", () => {
      // A request another criteria matched says nothing of this one's.
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria(ROOT_RECOVERY, "root")],
          "another",
        ),
      ).toEqual([]);
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria(ROOT_RECOVERY, "root")],
          undefined,
        ),
      ).toEqual([]);

      // Two grouped criteria reading the same recovery field: only the matched one.
      expect(
        wholeMonitor(
          { status: "resolved" },
          [
            makeCriteria(ROOT_RECOVERY, "root"),
            makeCriteria(
              {
                groupByJSONPath: "requestBody.incident.id",
                resolvedWhenJSONPath: "requestBody.status",
                resolvedWhenValue: "resolved",
              },
              "incidents",
            ),
          ],
          "incidents",
        ),
      ).toEqual(["incidents"]);
    });

    it("not without a recovery field, for a body that is not a JSON object, or on the background check", () => {
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria({ groupByJSONPath: "requestBody.a" }, "no-recovery")],
          "no-recovery",
        ),
      ).toEqual([]);
      expect(
        wholeMonitor("resolved", [makeCriteria(ROOT_RECOVERY, "root")], "root"),
      ).toEqual([]);
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria(ROOT_RECOVERY, "root")],
          "root",
          { onlyCheckForIncomingRequestReceivedAt: true },
        ),
      ).toEqual([]);
    });

    it("not for a criteria without grouping, even when it is the one matched", () => {
      expect(
        wholeMonitor(
          { status: "resolved" },
          [makeCriteria(undefined, "plain")],
          "plain",
        ),
      ).toEqual([]);
    });
  });

  describe("isGroupingConfigured", () => {
    it("is true only when a group-by path is set", () => {
      expect(
        IncomingRequestIncidentGrouping.isGroupingConfigured(
          makeCriteria({
            groupByJSONPath: "requestBody.commonLabels.alertname",
          }),
        ),
      ).toBe(true);
      expect(
        IncomingRequestIncidentGrouping.isGroupingConfigured(
          makeCriteria(undefined),
        ),
      ).toBe(false);
      expect(
        IncomingRequestIncidentGrouping.isGroupingConfigured(undefined),
      ).toBe(false);
    });
  });

  describe("array-of-scalars fan-out (`prefix[*]`)", () => {
    it("fans out one match per scalar array element", () => {
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest({ tags: ["RAM", "CPU", "Disk"] }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.tags[*]",
        }),
      });

      expect(matches).toHaveLength(3);
      expect(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.labels;
        }),
      ).toEqual([{ tags: "RAM" }, { tags: "CPU" }, { tags: "Disk" }]);
    });
  });

  describe("requestBody-rooted convention (matches incident templates)", () => {
    it("accepts the `{{requestBody. … }}` template wrapper", () => {
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest({
          commonLabels: { alertname: "Disk Full" },
        }),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "{{requestBody.commonLabels.alertname}}",
        }),
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Disk Full" });
    });

    it("finds no value on a bare path that is not rooted at requestBody (not supported)", () => {
      expect(
        IncomingRequestIncidentGrouping.extractItems({
          requestBody: firingAlertmanagerPayload(),
          grouping: { groupByJSONPath: "alerts[*].labels.alertname" },
        }),
      ).toEqual([]);
    });

    it("the plain and `{{ }}`-wrapped forms produce identical fingerprints", () => {
      const plain: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(firingAlertmanagerPayload()),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "requestBody.alerts[*].labels.alertname",
        }),
      });

      const wrapped: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest(firingAlertmanagerPayload()),
        criteriaInstance: makeCriteria({
          groupByJSONPath: "{{requestBody.alerts[*].labels.alertname}}",
        }),
      });

      expect(
        wrapped.map((m: PerSeriesCriteriaMatch) => {
          return m.fingerprint;
        }),
      ).toEqual(
        plain.map((m: PerSeriesCriteriaMatch) => {
          return m.fingerprint;
        }),
      );
    });
  });

  describe("a [*] recovery path when the grouping path names one value per request", () => {
    const grouping: IncidentGroupingConfig = {
      groupByJSONPath: "requestBody.commonLabels.alertname",
      resolvedWhenJSONPath: "requestBody.alerts[*].status",
      resolvedWhenValue: "resolved",
    };

    function isResolved(payload: JSONObject): boolean | undefined {
      return IncomingRequestIncidentGrouping.extractItems({
        requestBody: payload,
        grouping: grouping,
      })[0]?.isResolved;
    }

    it("does not silently mis-scope a [*] resolve path onto a top-level field", () => {
      /*
       * Group-by is non-array but resolve uses [*]. The top-level
       * `status: resolved` must NOT be treated as the alerts' status -
       * there are no alerts here, so this key is still firing.
       */
      const matches: Array<PerSeriesCriteriaMatch> = firingMatches({
        dataToProcess: makeRequest({
          status: "resolved",
          commonLabels: { alertname: "High CPU Usage" },
        }),
        criteriaInstance: makeCriteria(grouping),
      });

      // Treated as firing (not mis-scoped to top-level status) ⇒ stays open.
      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "High CPU Usage" });
    });

    it("is recovered when every element says so", () => {
      expect(
        isResolved({
          commonLabels: { alertname: "High CPU Usage" },
          alerts: [{ status: "resolved" }, { status: "resolved" }],
        }),
      ).toBe(true);
    });

    it("is firing while any element is not recovered", () => {
      for (const alerts of [
        [{ status: "resolved" }, { status: "firing" }],
        [{ status: "resolved" }, {}],
        [{ status: "resolved" }, "resolved"],
        [{ status: "resolved" }, null],
        [{ status: "Resolved" }],
      ]) {
        expect({
          alerts,
          resolved: isResolved({
            commonLabels: { alertname: "High CPU Usage" },
            alerts: alerts as unknown as JSONObject,
          } as JSONObject),
        }).toEqual({ alerts, resolved: false });
      }
    });

    it("is firing when there is no element to say so", () => {
      for (const alerts of [[], "resolved", { status: "resolved" }]) {
        expect(
          isResolved({
            commonLabels: { alertname: "High CPU Usage" },
            alerts: alerts as unknown as JSONObject,
          } as JSONObject),
        ).toBe(false);
      }
    });

    it("reads scalar elements themselves when the path ends at [*]", () => {
      expect(
        IncomingRequestIncidentGrouping.extractItems({
          requestBody: {
            commonLabels: { alertname: "Disk" },
            states: ["ok", "ok"],
          },
          grouping: {
            groupByJSONPath: "requestBody.commonLabels.alertname",
            resolvedWhenJSONPath: "requestBody.states[*]",
            resolvedWhenValue: "ok",
          },
        })[0]?.isResolved,
      ).toBe(true);
    });

    it("applies to each scalar value of a `prefix[*]` grouping too", () => {
      const items: ReturnType<
        typeof IncomingRequestIncidentGrouping.extractItems
      > = IncomingRequestIncidentGrouping.extractItems({
        requestBody: {
          tags: ["RAM", "CPU"],
          alerts: [{ status: "resolved" }],
        },
        grouping: {
          groupByJSONPath: "requestBody.tags[*]",
          resolvedWhenJSONPath: "requestBody.alerts[*].status",
          resolvedWhenValue: "resolved",
        },
      });

      expect(
        items.map((item: { isResolved: boolean }) => {
          return item.isResolved;
        }),
      ).toEqual([true, true]);
    });

    it("leaves a per-element recovery path per element", () => {
      const items: ReturnType<
        typeof IncomingRequestIncidentGrouping.extractItems
      > = IncomingRequestIncidentGrouping.extractItems({
        requestBody: {
          alerts: [
            { status: "resolved", labels: { alertname: "A" } },
            { status: "firing", labels: { alertname: "B" } },
          ],
        },
        grouping: PER_ALERT,
      });

      expect(
        items.map((item: { keyValue: string; isResolved: boolean }) => {
          return `${item.keyValue}:${item.isResolved}`;
        }),
      ).toEqual(["A:true", "B:false"]);
    });
  });
});
