import { describe, expect, test } from "@jest/globals";
import {
  OCSF_PROCESS_ACTIVITY_CLASS_UID,
  OCSF_PROCESS_ACTIVITY_NAMES,
  OcsfProcessActivityId,
  ProcessActivityKind,
  getProcessActivityKind,
  ocsfProcessActivityName,
  readProcessActivityId,
} from "../../../Types/SecurityEvent/OcsfProcessActivity";
import { ocsfEventClassByUid } from "../../../Types/SecurityEvent/OcsfEventClass";

/*
 * What a Process Activity did to its process, read by one rule wherever it
 * is read: ingest reads the process fields by it (in a launch the process
 * that acted is the parent), and the Google SecOps forwarder sends the
 * event as that activity.
 */
describe("OCSF Process Activity", () => {
  test("is class 1007, as OCSF and the class list number it", () => {
    expect(OCSF_PROCESS_ACTIVITY_CLASS_UID).toBe(1007);
    expect(ocsfEventClassByUid(OCSF_PROCESS_ACTIVITY_CLASS_UID)?.name).toBe(
      "Process Activity",
    );
  });

  // https://schema.ocsf.io/classes/process_activity
  test("names each activity id as OCSF captions it", () => {
    expect(OCSF_PROCESS_ACTIVITY_NAMES).toEqual({
      0: "Unknown",
      1: "Launch",
      2: "Terminate",
      3: "Open",
      4: "Inject",
      5: "Set User ID",
      99: "Other",
    });
  });

  test.each<[number, string]>([
    [0, "Unknown"],
    [1, "Launch"],
    [2, "Terminate"],
    [3, "Open"],
    [4, "Inject"],
    [5, "Set User ID"],
    [99, "Other"],
  ])("activity id %i is named %j", (activityId: number, name: string) => {
    expect(ocsfProcessActivityName(activityId)).toBe(name);
  });

  test.each<[number | null | undefined]>([
    [6],
    [98],
    [100],
    [-1],
    [1.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [null],
    [undefined],
  ])(
    "an id OCSF does not define (%p) has no name",
    (activityId: number | null | undefined) => {
      expect(ocsfProcessActivityName(activityId)).toBe("");
    },
  );

  test("an id that is not a number has no name", () => {
    expect(
      ocsfProcessActivityName("1" as unknown as OcsfProcessActivityId),
    ).toBe("");
  });
});

describe("getProcessActivityKind", () => {
  test.each<[number, ProcessActivityKind]>([
    [OcsfProcessActivityId.Launch, ProcessActivityKind.Launch],
    [OcsfProcessActivityId.Terminate, ProcessActivityKind.Terminate],
    [OcsfProcessActivityId.Open, ProcessActivityKind.Open],
    [OcsfProcessActivityId.Inject, ProcessActivityKind.Inject],
    [OcsfProcessActivityId.SetUserId, ProcessActivityKind.Other],
    [OcsfProcessActivityId.Unknown, ProcessActivityKind.Other],
    [OcsfProcessActivityId.Other, ProcessActivityKind.Other],
  ])(
    "activity id %i is %s",
    (activityId: number, kind: ProcessActivityKind) => {
      expect(getProcessActivityKind({ activityId })).toBe(kind);
    },
  );

  test.each<[string, ProcessActivityKind]>([
    ["Launch", ProcessActivityKind.Launch],
    ["Terminate", ProcessActivityKind.Terminate],
    ["Open", ProcessActivityKind.Open],
    ["Inject", ProcessActivityKind.Inject],
    ["Privilege Escalation", ProcessActivityKind.PrivilegeEscalation],
    ["Set User ID", ProcessActivityKind.Other],
    ["Other", ProcessActivityKind.Other],
    ["Unknown", ProcessActivityKind.Other],
    [" launch ", ProcessActivityKind.Launch],
    ["OPEN", ProcessActivityKind.Open],
    ["inject", ProcessActivityKind.Inject],
    ["privilege escalation", ProcessActivityKind.PrivilegeEscalation],
    ["Injection", ProcessActivityKind.Other],
    ["Started", ProcessActivityKind.Other],
  ])(
    "an activity named %j is %s",
    (activityName: string, kind: ProcessActivityKind) => {
      expect(getProcessActivityKind({ activityName })).toBe(kind);
    },
  );

  /*
   * The name is the source's own text: names every object answers to are
   * no activity, never what the object inherits under them.
   */
  test.each<[string]>([
    ["constructor"],
    ["toString"],
    ["__proto__"],
    ["hasOwnProperty"],
    ["valueOf"],
  ])("an activity named %j is some other activity", (activityName: string) => {
    expect(getProcessActivityKind({ activityName })).toBe(
      ProcessActivityKind.Other,
    );
  });

  test("an event that names no activity at all is a launch", () => {
    expect(getProcessActivityKind({})).toBe(ProcessActivityKind.Launch);
    expect(getProcessActivityKind({ activityName: "" })).toBe(
      ProcessActivityKind.Launch,
    );
    expect(getProcessActivityKind({ activityName: "   " })).toBe(
      ProcessActivityKind.Launch,
    );
    expect(
      getProcessActivityKind({ activityId: null, activityName: null }),
    ).toBe(ProcessActivityKind.Launch);
  });

  test("the id wins over the name, as OCSF has it", () => {
    expect(
      getProcessActivityKind({ activityId: 3, activityName: "Launch" }),
    ).toBe(ProcessActivityKind.Open);
    expect(
      getProcessActivityKind({ activityId: 1, activityName: "Inject" }),
    ).toBe(ProcessActivityKind.Launch);
  });

  test("an id OCSF does not define is some other activity, never a launch", () => {
    for (const activityId of [6, 7, 42, 100, -1, 1.5]) {
      expect(getProcessActivityKind({ activityId, activityName: "" })).toBe(
        ProcessActivityKind.Other,
      );
    }
  });

  test("an id and the name OCSF gives it are read as the same activity", () => {
    for (const id of Object.keys(OCSF_PROCESS_ACTIVITY_NAMES).map(Number)) {
      expect(
        getProcessActivityKind({ activityName: ocsfProcessActivityName(id) }),
      ).toBe(getProcessActivityKind({ activityId: id }));
    }
  });
});

describe("readProcessActivityId", () => {
  test.each<[unknown, number | null]>([
    [3, 3],
    [0, 0],
    ["4", 4],
    [" 99 ", 99],
    ["1.5", 1.5],
    [1.5, 1.5],
    ["", null],
    ["   ", null],
    ["three", null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [undefined, null],
    [null, null],
    [true, null],
    [{ id: 3 }, null],
    [[3], null],
  ])("%p is read as %p", (value: unknown, expected: number | null) => {
    expect(readProcessActivityId(value)).toBe(expected);
  });

  test("reads an id as ingest read the payload's: a stored 1.5 is no launch either way", () => {
    expect(
      getProcessActivityKind({ activityId: readProcessActivityId("1.5") }),
    ).toBe(ProcessActivityKind.Other);
    expect(
      getProcessActivityKind({ activityId: readProcessActivityId("1") }),
    ).toBe(ProcessActivityKind.Launch);
  });
});
