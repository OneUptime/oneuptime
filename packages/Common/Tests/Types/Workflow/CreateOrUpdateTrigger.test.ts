/*
 * The pure part of On Create or Update (Types/Workflow/CreateOrUpdateTrigger):
 * what its id is, which models have it, and how What Happened - "created" or
 * "updated" - is read from what started a run, or refused.
 */

import {
  CREATE_OR_UPDATE_TRIGGER_SUFFIX,
  CreateOrUpdateTriggerMessages,
  WHAT_HAPPENED_ID,
  WHAT_HAPPENED_NAME,
  WHAT_HAPPENED_VALUES,
  WhatHappened,
  WhatHappenedForRun,
  getCreateOrUpdateTriggerId,
  getWhatHappenedForRun,
  hasCreateOrUpdateTrigger,
  isCreateOrUpdateTrigger,
  isWhatHappenedReference,
  readWhatHappened,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  DatabaseOperation,
  getDatabaseOperation,
} from "../../../Types/Workflow/DatabaseOperation";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

describe("its id", () => {
  test("is the model's table name in dashes, then on-create-or-update", () => {
    expect(getCreateOrUpdateTriggerId("Incident")).toBe(
      "incident-on-create-or-update",
    );
    expect(getCreateOrUpdateTriggerId("ScheduledMaintenance")).toBe(
      "scheduled-maintenance-on-create-or-update",
    );
    expect(getCreateOrUpdateTriggerId("OnCallDutyPolicyExecutionLog")).toBe(
      "on-call-duty-policy-execution-log-on-create-or-update",
    );
  });

  test("ends in the operation the picker and the help read it by", () => {
    expect(CREATE_OR_UPDATE_TRIGGER_SUFFIX).toBe(
      DatabaseOperation.OnCreateOrUpdate,
    );
    expect(
      getDatabaseOperation({
        componentId: getCreateOrUpdateTriggerId("Incident"),
        tableName: "Incident",
      }),
    ).toBe(DatabaseOperation.OnCreateOrUpdate);
  });

  /*
   * Anything that tells the record triggers apart by how their id ends must
   * never take this one for On Create or On Update.
   */
  test("ends neither in -on-create nor in -on-update", () => {
    const id: string = getCreateOrUpdateTriggerId("Incident");

    expect(id.endsWith("-on-create")).toBe(false);
    expect(id.endsWith("-on-update")).toBe(false);
    expect(id.endsWith("-on-delete")).toBe(false);
    expect(
      getDatabaseOperation({ componentId: id, tableName: "Incident" }),
    ).not.toBe(DatabaseOperation.OnCreate);
  });
});

describe("which steps are it", () => {
  test("a model's On Create or Update, by its id and table", () => {
    expect(
      isCreateOrUpdateTrigger({
        id: "incident-on-create-or-update",
        tableName: "Incident",
      }),
    ).toBe(true);
  });

  test.each([
    ["On Create", { id: "incident-on-create", tableName: "Incident" }],
    ["On Update", { id: "incident-on-update", tableName: "Incident" }],
    ["On Delete", { id: "incident-on-delete", tableName: "Incident" }],
    ["a Find step", { id: "incident-find-one", tableName: "Incident" }],
    [
      "another model's id under this table",
      { id: "alert-on-create-or-update", tableName: "Incident" },
    ],
    ["a step with no table", { id: "incident-on-create-or-update" }],
    ["a hand-written step", { id: "webhook" }],
  ] as Array<[string, { id: string; tableName?: string }]>)(
    "not %s",
    (_label: string, metadata: { id: string; tableName?: string }) => {
      expect(isCreateOrUpdateTrigger(metadata)).toBe(false);
    },
  );

  test("nothing is not it", () => {
    expect(isCreateOrUpdateTrigger(null)).toBe(false);
    expect(isCreateOrUpdateTrigger(undefined)).toBe(false);
  });
});

describe("which models have it", () => {
  test("exactly those with both On Create and On Update", () => {
    expect(hasCreateOrUpdateTrigger({ create: true, update: true })).toBe(true);
    expect(hasCreateOrUpdateTrigger({ create: true })).toBe(false);
    expect(hasCreateOrUpdateTrigger({ update: true })).toBe(false);
    expect(hasCreateOrUpdateTrigger({ create: true, update: false })).toBe(
      false,
    );
    expect(hasCreateOrUpdateTrigger({})).toBe(false);
    expect(hasCreateOrUpdateTrigger(null)).toBe(false);
    expect(hasCreateOrUpdateTrigger(undefined)).toBe(false);
  });
});

describe("What Happened", () => {
  test("is named and kept the way the step and Run Workflow show it", () => {
    expect(WHAT_HAPPENED_ID).toBe("what-happened");
    expect(WHAT_HAPPENED_NAME).toBe("What Happened");
    expect(WHAT_HAPPENED_VALUES).toEqual(["created", "updated"]);
  });

  test("reads the two answers in any case, with space around them", () => {
    expect(readWhatHappened("created")).toBe(WhatHappened.Created);
    expect(readWhatHappened("updated")).toBe(WhatHappened.Updated);
    expect(readWhatHappened(" Created ")).toBe(WhatHappened.Created);
    expect(readWhatHappened("UPDATED")).toBe(WhatHappened.Updated);
  });

  test.each([
    ["another word", "deleted"],
    ["a word that holds one", "created!"],
    ["an empty text", ""],
    ["a number", 1],
    ["a switch", true],
    ["a list", ["created"]],
    ["an object", { value: "created" }],
    ["nothing", null],
  ] as Array<[string, unknown]>)(
    "reads %s as neither",
    (_label: string, value: unknown) => {
      expect(readWhatHappened(value)).toBeNull();
    },
  );
});

/*
 * Where a setting holds What Happened alone - an If / Else or Switch /
 * Case comparing it - the field to compare it with names its two words.
 */
describe("a setting that holds What Happened", () => {
  test("is the trigger's What Happened, of whichever step it is", () => {
    expect(
      isWhatHappenedReference(
        "{{local.components.incident-on-create-or-update-1.returnValues.what-happened}}",
      ),
    ).toBe(true);
    // A renamed step, and space around the whole value.
    expect(
      isWhatHappenedReference(
        "  {{local.components.sync-trigger.returnValues.what-happened}} ",
      ),
    ).toBe(true);
  });

  test.each([
    [
      "another value of the trigger",
      "{{local.components.incident-on-create-or-update-1.returnValues.model}}",
    ],
    [
      "a field of the record",
      "{{local.components.incident-on-create-or-update-1.returnValues.model.title}}",
    ],
    [
      "a path past What Happened",
      "{{local.components.incident-on-create-or-update-1.returnValues.what-happened.length}}",
    ],
    [
      "a field of the record named like it",
      "{{local.components.x.returnValues.model.returnValues.what-happened}}",
    ],
    [
      "a path that names What Happened twice",
      "{{local.components.x.returnValues.what-happened.returnValues.what-happened}}",
    ],
    [
      "spaces inside the braces, which the run does not read",
      "{{ local.components.incident-on-create-or-update-1.returnValues.what-happened }}",
    ],
    [
      "a space after the opening braces alone",
      "{{ local.components.incident-on-create-or-update-1.returnValues.what-happened}}",
    ],
    [
      "text around it",
      "Incident {{local.components.incident-on-create-or-update-1.returnValues.what-happened}}",
    ],
    [
      "two references",
      "{{local.components.a.returnValues.what-happened}}{{local.components.b.returnValues.what-happened}}",
    ],
    ["a variable named like it", "{{local.variables.what-happened}}"],
    ["the word itself", "what-happened"],
    ["an answer", "created"],
    ["an empty text", ""],
    ["nothing", undefined],
    ["a number", 1],
  ] as Array<[string, unknown]>)(
    "is not %s",
    (_label: string, value: unknown) => {
      expect(isWhatHappenedReference(value)).toBe(false);
    },
  );

  test("reads a huge value in about the time of a short one", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (let attempt: number = 0; attempt < 20; attempt++) {
          isWhatHappenedReference(
            "{{" + "local.".repeat(70000) + "returnValues.what-happened}}",
          );
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("what a run started by hand is for", () => {
  test.each([
    ["nothing asked", undefined],
    ["an empty value", null],
    ["an empty text", ""],
    ["only spaces", "   "],
  ] as Array<[string, unknown]>)(
    "%s is a create, as an empty choice is its first",
    (_label: string, value: unknown) => {
      expect(getWhatHappenedForRun(value)).toEqual({
        whatHappened: WhatHappened.Created,
        error: null,
      });
    },
  );

  test("either answer is what it says", () => {
    expect(getWhatHappenedForRun("updated")).toEqual({
      whatHappened: WhatHappened.Updated,
      error: null,
    });
    expect(getWhatHappenedForRun(" Created")).toEqual({
      whatHappened: WhatHappened.Created,
      error: null,
    });
  });

  test("anything else is refused, saying what it may be and what it was", () => {
    const outcome: WhatHappenedForRun = getWhatHappenedForRun("deleted");

    expect(outcome.whatHappened).toBeNull();
    expect(outcome.error).toBe(
      'What Happened must be "created" or "updated", not "deleted".',
    );
  });

  test("a value that is not text is quoted as JSON", () => {
    expect(getWhatHappenedForRun(7).error).toBe(
      'What Happened must be "created" or "updated", not "7".',
    );
    expect(getWhatHappenedForRun({ kind: "created" }).error).toBe(
      'What Happened must be "created" or "updated", not "{"kind":"created"}".',
    );
  });

  test("a long or many-lined value is quoted on one line, cut short", () => {
    const message: string = CreateOrUpdateTriggerMessages.notWhatHappened(
      `first line\nsecond line ${"x".repeat(5000)}`,
    );

    expect(message).not.toContain("\n");
    expect(
      message.startsWith(
        'What Happened must be "created" or "updated", not "first line second line x',
      ),
    ).toBe(true);
    expect(message.endsWith('…".')).toBe(true);
    expect(message.length).toBeLessThan(120);
  });

  test("an emoji at the cut is never split in half", () => {
    const message: string = CreateOrUpdateTriggerMessages.notWhatHappened(
      "🚀".repeat(60),
    );

    expect(message).toContain("🚀".repeat(39) + "…");

    // No lone surrogate: a character of one code unit is never half of one.
    const loneHalves: Array<string> = Array.from(message).filter(
      (character: string): boolean => {
        const code: number = character.charCodeAt(0);

        return character.length === 1 && code >= 0xd800 && code <= 0xdfff;
      },
    );

    expect(loneHalves).toEqual([]);
  });

  test("the refusal reads a huge value in about the time of a short one", () => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        for (let attempt: number = 0; attempt < 20; attempt++) {
          CreateOrUpdateTriggerMessages.notWhatHappened(
            " ".repeat(400000) + "x",
          );
        }
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
