import CarriedRecords, {
  CarriedRecordIds,
  CarriedRecordKeys,
} from "../../../Types/AI/CarriedRecords";
import CodeFixTaskContext from "../../../Types/AI/CodeFixTaskContext";
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
