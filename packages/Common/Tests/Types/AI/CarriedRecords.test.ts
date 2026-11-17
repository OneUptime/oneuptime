import {
  AIChatCitation,
  AIChatCitationTargetType,
  AIChatWidget,
  AIChatWidgetType,
} from "../../../Types/AI/AIChatTypes";
import CarriedRecords, {
  CarriedRecordIds,
  CarriedRecordKeys,
  MIN_QUOTED_TITLE_LENGTH,
} from "../../../Types/AI/CarriedRecords";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
import { JSONObject } from "../../../Types/JSON";
import {
  CODE_TASK_RECORD_CONTEXT_TYPES,
  CodeTaskContextType,
} from "../../../Types/AI/CodeTask";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * THE INCIDENTS AND ALERTS A PIECE OF CODE WORK CARRIES (#9186): what a
 * turn's request names, what a row lists, and the lists the server writes -
 * every id a UUID in lower case, each once.
 */

const INCIDENT: string = "7b1d2e3f-4051-4a62-8b73-8c94da5eb607";
const OTHER_INCIDENT: string = "7b1d2e3f-4051-4a62-8b73-8c94da5eb608";
const ALERT: string = "7b1d2e3f-4051-4a62-8b73-8c94da5eb609";

function contextOf(items: Array<unknown>): CodeFixTaskContext {
  return {
    request: { message: "Fix it", context: items },
  } as unknown as CodeFixTaskContext;
}

describe("what a turn's request carries", () => {
  test("every incident and alert its context names, by the id it was added with", () => {
    expect(
      CarriedRecords.ofTaskContext(
        contextOf([
          {
            type: CodeTaskContextType.Incident,
            label: "INC-1",
            recordId: INCIDENT,
          },
          { type: CodeTaskContextType.Alert, label: "ALT-1", recordId: ALERT },
          {
            type: CodeTaskContextType.Incident,
            label: "INC-2",
            recordId: OTHER_INCIDENT,
          },
        ]),
      ),
    ).toEqual({ incidentIds: [INCIDENT, OTHER_INCIDENT], alertIds: [ALERT] });
  });

  test("no record of any other kind: exceptions, monitors, notes, links, files, traces, logs and profiles", () => {
    const others: Array<unknown> = Object.values(CodeTaskContextType)
      .filter((type: CodeTaskContextType): boolean => {
        return (
          type !== CodeTaskContextType.Incident &&
          type !== CodeTaskContextType.Alert
        );
      })
      .map((type: CodeTaskContextType): unknown => {
        return { type, label: type, recordId: INCIDENT };
      });

    expect(others.length).toBe(Object.values(CodeTaskContextType).length - 2);
    expect(CarriedRecords.ofTaskContext(contextOf(others))).toEqual(
      CarriedRecords.none(),
    );
  });

  test("the record kinds a request can name: the incident and the alert are the ones carried", () => {
    // A new kind of record a request can name is weighed here.
    expect([...CODE_TASK_RECORD_CONTEXT_TYPES].sort()).toEqual(
      [
        CodeTaskContextType.Alert,
        CodeTaskContextType.Exception,
        CodeTaskContextType.Incident,
        CodeTaskContextType.Monitor,
      ].sort(),
    );
  });

  test("each record once, in lower case, whatever its case or spacing", () => {
    expect(
      CarriedRecords.ofTaskContext(
        contextOf([
          { type: "Incident", label: "a", recordId: INCIDENT.toUpperCase() },
          { type: "Incident", label: "b", recordId: ` ${INCIDENT} ` },
        ]),
      ),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [] });
  });

  test.each([
    ["no task context", undefined],
    ["no request", {}],
    ["a request with no context", { request: { message: "Fix it" } }],
    [
      "a context that is no list",
      { request: { message: "Fix it", context: { type: "Incident" } } },
    ],
  ])("%s carries nothing", (_what: string, taskContext: unknown) => {
    expect(
      CarriedRecords.ofTaskContext(taskContext as CodeFixTaskContext),
    ).toEqual(CarriedRecords.none());
  });

  test("an item that is not one, or names no id, carries nothing", () => {
    expect(
      CarriedRecords.ofTaskContext(
        contextOf([
          null,
          "Incident",
          { type: "Incident", label: "no id" },
          { type: "Incident", label: "bad id", recordId: "42" },
          { type: "Alert", label: "an object", recordId: { id: ALERT } },
        ]),
      ),
    ).toEqual(CarriedRecords.none());
  });

  test("a request that could not be asked again, with empty words, still says what it carried", () => {
    expect(
      CarriedRecords.ofTaskContext({
        request: {
          message: "",
          context: [
            {
              type: CodeTaskContextType.Incident,
              label: "x",
              recordId: INCIDENT,
            },
          ],
        },
      } as CodeFixTaskContext),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [] });
  });
});

describe("what a row lists", () => {
  test("reads both lists, leaving out what is no id", () => {
    const row: CarriedRecordKeys = {
      carriedIncidentIds: [INCIDENT, "nope", OTHER_INCIDENT],
      carriedAlertIds: [ALERT],
    };

    expect(CarriedRecords.ofRow(row)).toEqual({
      incidentIds: [INCIDENT, OTHER_INCIDENT],
      alertIds: [ALERT],
    });
  });

  test("a row with no lists, or lists that are not lists, carries nothing", () => {
    expect(CarriedRecords.ofRow({})).toEqual(CarriedRecords.none());
    expect(CarriedRecords.ofRow(null)).toEqual(CarriedRecords.none());
    expect(
      CarriedRecords.ofRow({
        carriedIncidentIds: INCIDENT as unknown as Array<string>,
      }),
    ).toEqual(CarriedRecords.none());
  });
});

describe("the lists", () => {
  test("named by ids or ObjectIDs, each once", () => {
    expect(
      CarriedRecords.of({
        incidentIds: [new ObjectID(INCIDENT), INCIDENT, null, undefined],
        alertIds: [ALERT],
      }),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [ALERT] });
  });

  test("merged: every record any of them carries, each once, in the order first named", () => {
    expect(
      CarriedRecords.merge(
        { incidentIds: [OTHER_INCIDENT], alertIds: [] },
        null,
        { incidentIds: [INCIDENT, OTHER_INCIDENT], alertIds: [ALERT] },
      ),
    ).toEqual({ incidentIds: [OTHER_INCIDENT, INCIDENT], alertIds: [ALERT] });
  });

  test("without what another already carries", () => {
    expect(
      CarriedRecords.without(
        { incidentIds: [INCIDENT, OTHER_INCIDENT], alertIds: [ALERT] },
        { incidentIds: [INCIDENT], alertIds: [ALERT] },
      ),
    ).toEqual({ incidentIds: [OTHER_INCIDENT], alertIds: [] });
  });

  test("none, and whether there are none", () => {
    expect(CarriedRecords.isNone(CarriedRecords.none())).toBe(true);
    expect(CarriedRecords.isNone({ incidentIds: [], alertIds: [ALERT] })).toBe(
      false,
    );
  });

  test("written onto a row: a list carrying none is left out, so the row holds null there", () => {
    const row: CarriedRecordKeys = {
      carriedIncidentIds: [OTHER_INCIDENT],
      carriedAlertIds: [ALERT],
    };
    const records: CarriedRecordIds = { incidentIds: [INCIDENT], alertIds: [] };

    CarriedRecords.writeTo(row, records);

    expect(row).toEqual({
      carriedIncidentIds: [INCIDENT],
      carriedAlertIds: undefined,
    });

    // A copy: changing what was written does not change the row.
    records.incidentIds.push(OTHER_INCIDENT);
    expect(row.carriedIncidentIds).toEqual([INCIDENT]);
  });

  test.each([
    [INCIDENT, INCIDENT],
    [INCIDENT.toUpperCase(), INCIDENT],
    [new ObjectID(INCIDENT), INCIDENT],
    ["", null],
    ["not-a-uuid", null],
    [42, null],
    [null, null],
  ])("reads %p as %p", (value: unknown, id: string | null) => {
    expect(CarriedRecords.readId(value)).toBe(id);
  });
});

/*
 * #9242: what a pull request a chat opens carries of what the chat read -
 * each incident and alert it opened one by one, and those of its lists the
 * pull request quotes - never every row a list returned.
 */
describe("what a chat opened one by one", () => {
  function citation(values: Partial<AIChatCitation>): AIChatCitation {
    return {
      id: "C1",
      toolName: "get_incident",
      label: "Incident #12",
      queryArguments: {},
      rowCount: 1,
      ...values,
    };
  }

  test("every incident and alert a citation names on its own, from a result that found it", () => {
    expect(
      CarriedRecords.openedByCitations([
        citation({
          target: {
            type: AIChatCitationTargetType.IncidentView,
            params: { incidentId: INCIDENT.toUpperCase() },
          },
        }),
        citation({
          toolName: "add_alert_note",
          target: {
            type: AIChatCitationTargetType.AlertView,
            params: { alertId: ALERT },
          },
        }),
        // Read twice: carried once.
        citation({
          toolName: "get_incident_timeline",
          target: {
            type: AIChatCitationTargetType.IncidentView,
            params: { incidentId: INCIDENT },
          },
        }),
      ]),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [ALERT] });
  });

  test.each([
    [
      "a list, which names no one record",
      citation({
        toolName: "query_incidents",
        rowCount: 20,
        target: { type: AIChatCitationTargetType.Incidents },
      }),
    ],
    [
      "a result that found nothing",
      citation({
        rowCount: 0,
        target: {
          type: AIChatCitationTargetType.IncidentView,
          params: { incidentId: INCIDENT },
        },
      }),
    ],
    [
      "another record's page",
      citation({
        target: {
          type: AIChatCitationTargetType.MonitorView,
          params: { monitorId: INCIDENT },
        },
      }),
    ],
    [
      "a page with no id",
      citation({ target: { type: AIChatCitationTargetType.IncidentView } }),
    ],
    [
      "an id that is no id",
      citation({
        target: {
          type: AIChatCitationTargetType.AlertView,
          params: { alertId: "not-an-id" },
        },
      }),
    ],
    ["no target", citation({})],
  ])("nothing for %s", (_name: string, read: AIChatCitation) => {
    expect(CarriedRecords.openedByCitations([read])).toEqual({
      incidentIds: [],
      alertIds: [],
    });
  });

  test("nothing for no citations, or what is not a list of them", () => {
    expect(CarriedRecords.openedByCitations(undefined)).toEqual(
      CarriedRecords.none(),
    );
    expect(
      CarriedRecords.openedByCitations([
        null,
        undefined,
        "C1" as unknown as AIChatCitation,
      ]),
    ).toEqual(CarriedRecords.none());
    expect(
      CarriedRecords.openedByCitations(
        "not a list" as unknown as Array<AIChatCitation>,
      ),
    ).toEqual(CarriedRecords.none());
  });
});

describe("what a pull request quotes of a chat's lists", () => {
  function list(type: AIChatWidgetType, items: Array<unknown>): AIChatWidget {
    return {
      id: "W1",
      type,
      title: "A list",
      data: { items: items as Array<JSONObject> },
    };
  }

  const LISTS: Array<AIChatWidget> = [
    list(AIChatWidgetType.IncidentList, [
      {
        id: INCIDENT,
        incidentNumber: 12,
        title: "Checkout fails for EU cards",
      },
      { id: OTHER_INCIDENT, incidentNumber: 13, title: "Outage" },
    ]),
    list(AIChatWidgetType.AlertList, [
      { id: ALERT, alertNumber: 4, title: "Payment queue backs up" },
    ]),
  ];

  test("each row whose title the text quotes, whatever its case and white space", () => {
    expect(
      CarriedRecords.quotedFromLists({
        widgets: LISTS,
        text: "fix: retry\nThe PAYMENT queue\tbacks up when checkout fails for eu cards.",
      }),
    ).toEqual({ incidentIds: [INCIDENT], alertIds: [ALERT] });
  });

  test("no row the text does not quote: a list is not carried whole", () => {
    expect(
      CarriedRecords.quotedFromLists({
        widgets: LISTS,
        text: "fix: retry the charge once",
      }),
    ).toEqual(CarriedRecords.none());
  });

  test("a title too short to be a quote is no quote", () => {
    expect(Array.from("Outage").length).toBeLessThan(MIN_QUOTED_TITLE_LENGTH);
    expect(
      CarriedRecords.quotedFromLists({
        widgets: LISTS,
        text: "Prevents another outage of the checkout.",
      }),
    ).toEqual(CarriedRecords.none());
  });

  test("only incident and alert lists, and only whole rows of them", () => {
    expect(
      CarriedRecords.quotedFromLists({
        widgets: [
          list(AIChatWidgetType.ExceptionList, [
            { id: INCIDENT, title: "Checkout fails for EU cards" },
          ]),
          list(AIChatWidgetType.Table, [
            { id: ALERT, title: "Payment queue backs up" },
          ]),
          list(AIChatWidgetType.IncidentList, [
            null,
            "a row",
            { title: "Checkout fails for EU cards" },
            { id: "not-an-id", title: "Checkout fails for EU cards" },
            { id: OTHER_INCIDENT, title: 42 },
          ]),
          null,
        ],
        text: "Checkout fails for EU cards; payment queue backs up.",
      }),
    ).toEqual(CarriedRecords.none());
  });

  test("nothing for no text", () => {
    expect(
      CarriedRecords.quotedFromLists({ widgets: LISTS, text: "" }),
    ).toEqual(CarriedRecords.none());
    expect(
      CarriedRecords.quotedFromLists({ widgets: LISTS, text: undefined }),
    ).toEqual(CarriedRecords.none());
  });
});
