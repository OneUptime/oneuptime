import BadDataException from "../../../Types/Exception/BadDataException";
import {
  GUIDED_SETUP_KEYS,
  GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS,
  GUIDED_SETUP_RUN_LIMITS,
  GUIDED_SETUP_RUN_ROUTE,
  GuidedSetupKey,
  GuidedSetupResourceStatus,
  GuidedSetupRunAnswer,
  GuidedSetupRunChange,
  GuidedSetupRunResources,
  GuidedSetupRunValues,
  applyGuidedSetupRunChange,
  getGuidedSetupRunForgetRoute,
  getGuidedSetupRunRoute,
  isEmptyGuidedSetupRunChange,
  isGuidedSetupKey,
  parseGuidedSetupRunAnswer,
  parseGuidedSetupRunChange,
  readGuidedSetupRunResources,
  readGuidedSetupRunValues,
  toGuidedSetupRunAnswerJSON,
} from "../../../Types/GuidedSetup/GuidedSetupRun";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A guided setup's run, kept on the server (#7253): the contract the
 * Dashboard's store and the server's routes both read - which setups keep
 * one, what a change may hold, how it is merged, and what an answer is.
 */

const MONITOR_ID: string = "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e";
const POLICY_ID: string = "6a9c0d1e-f2b3-4c4d-9e5f-7a8b9c0d1e2f";
const NOW: Date = new Date("2026-11-20T10:00:00.000Z");
const LATER: Date = new Date("2026-11-20T10:05:00.000Z");

const change: (
  values?: GuidedSetupRunChange["values"],
  resources?: GuidedSetupRunChange["resources"],
) => GuidedSetupRunChange = (
  values: GuidedSetupRunChange["values"] = {},
  resources: GuidedSetupRunChange["resources"] = {},
): GuidedSetupRunChange => {
  return { values: values, resources: resources };
};

describe("the setups that keep a run", () => {
  test("are the four guided setups, by the keys their events send", () => {
    expect(GUIDED_SETUP_KEYS).toEqual([
      "website_down",
      "on_call",
      "status_page",
      "telemetry",
    ]);

    for (const key of GUIDED_SETUP_KEYS) {
      expect(isGuidedSetupKey(key)).toBe(true);
    }
  });

  test("anything else is no setup", () => {
    for (const value of [
      "example_setup",
      "",
      "WEBSITE_DOWN",
      null,
      undefined,
      7,
      {},
    ]) {
      expect(isGuidedSetupKey(value)).toBe(false);
    }
  });

  test("each has its route, and its route to start afresh", () => {
    expect(GUIDED_SETUP_RUN_ROUTE).toBe("/guided-setup-run");
    expect(getGuidedSetupRunRoute(GuidedSetupKey.WebsiteDown)).toBe(
      "/guided-setup-run/website_down",
    );
    expect(getGuidedSetupRunForgetRoute(GuidedSetupKey.OnCall)).toBe(
      "/guided-setup-run/on_call/forget",
    );
  });

  test("a run nobody changed for 30 days is abandoned", () => {
    expect(GUIDED_SETUP_RUN_ABANDONED_AFTER_DAYS).toBe(30);
  });
});

describe("a run's values, as kept", () => {
  test("keeps names with text or true, and nothing else", () => {
    expect(
      readGuidedSetupRunValues({
        monitorId: MONITOR_ID,
        testSkipped: true,
        reviewed: false,
        empty: "",
        count: 3,
        nested: { a: 1 },
        list: ["a"],
        nothing: null,
      }),
    ).toEqual({ monitorId: MONITOR_ID, testSkipped: true });
  });

  test("leaves out a name the code would never choose", () => {
    expect(
      readGuidedSetupRunValues({
        "has space": "x",
        "1leading": "x",
        "dash-ed": "x",
        [`a${"b".repeat(GUIDED_SETUP_RUN_LIMITS.maxNameLength)}`]: "x",
        snake_case_ok: "x",
      }),
    ).toEqual({ snake_case_ok: "x" });
  });

  test("leaves out a value longer than a run keeps", () => {
    expect(
      readGuidedSetupRunValues({
        long: "x".repeat(GUIDED_SETUP_RUN_LIMITS.maxValueLength + 1),
        fits: "x".repeat(GUIDED_SETUP_RUN_LIMITS.maxValueLength),
      }),
    ).toEqual({ fits: "x".repeat(GUIDED_SETUP_RUN_LIMITS.maxValueLength) });
  });

  test("anything that is not an object is no values", () => {
    for (const value of [null, undefined, "monitorId", 3, ["monitorId"]]) {
      expect(readGuidedSetupRunValues(value)).toEqual({});
    }
  });
});

describe("a run's resources, as kept", () => {
  test("keeps each resource's status, record, name, error and time", () => {
    expect(
      readGuidedSetupRunResources({
        monitor: {
          status: "created",
          recordId: MONITOR_ID,
          name: "acme.example",
          at: NOW.toISOString(),
        },
        on_call_policy: {
          status: "failed",
          error: "The on-call policy was not saved.",
          at: NOW.toISOString(),
        },
      }),
    ).toEqual({
      monitor: {
        status: GuidedSetupResourceStatus.Created,
        recordId: MONITOR_ID,
        name: "acme.example",
        at: NOW.toISOString(),
      },
      on_call_policy: {
        status: GuidedSetupResourceStatus.Failed,
        error: "The on-call policy was not saved.",
        at: NOW.toISOString(),
      },
    });
  });

  test("never keeps waiting, which is what no progress means", () => {
    expect(
      readGuidedSetupRunResources({
        monitor: { status: "waiting", at: NOW.toISOString() },
      }),
    ).toEqual({});
  });

  test("leaves out an entry with no status a resource is kept in, or no time", () => {
    expect(
      readGuidedSetupRunResources({
        a: { status: "done", at: NOW.toISOString() },
        b: { status: "created" },
        c: "created",
        d: null,
      }),
    ).toEqual({});
  });

  test("cuts a long error and name to what a run keeps, and drops blank ones", () => {
    const resources: GuidedSetupRunResources = readGuidedSetupRunResources({
      monitor: {
        status: "failed",
        error: "e".repeat(GUIDED_SETUP_RUN_LIMITS.maxErrorLength + 50),
        name: "  ",
        recordId: "",
        at: NOW.toISOString(),
      },
    });

    expect(resources["monitor"]!.error).toHaveLength(
      GUIDED_SETUP_RUN_LIMITS.maxErrorLength,
    );
    expect(resources["monitor"]).not.toHaveProperty("name");
    expect(resources["monitor"]).not.toHaveProperty("recordId");
  });
});

describe("a change, as a POST sends it", () => {
  test("sets values, removes them with null (false and blank too), and sets resources", () => {
    expect(
      parseGuidedSetupRunChange({
        values: {
          monitorId: MONITOR_ID,
          testSkipped: true,
          policyId: null,
          reviewed: false,
          address: "",
        },
        resources: {
          monitor: { status: "creating", name: "acme.example" },
          test_page: null,
        },
      }),
    ).toEqual({
      values: {
        monitorId: MONITOR_ID,
        testSkipped: true,
        policyId: null,
        reviewed: null,
        address: null,
      },
      resources: {
        monitor: {
          status: GuidedSetupResourceStatus.Creating,
          name: "acme.example",
        },
        test_page: null,
      },
    });
  });

  test("a change with no values or no resources changes nothing there", () => {
    expect(parseGuidedSetupRunChange({})).toEqual(change());
    expect(parseGuidedSetupRunChange({ values: null })).toEqual(change());
    expect(isEmptyGuidedSetupRunChange(parseGuidedSetupRunChange({}))).toBe(
      true,
    );
    expect(isEmptyGuidedSetupRunChange(change({ testSkipped: true }, {}))).toBe(
      false,
    );
  });

  test("the time a resource changed is the server's, never the sender's", () => {
    expect(
      parseGuidedSetupRunChange({
        resources: {
          monitor: { status: "created", at: "1999-01-01T00:00:00.000Z" },
        },
      }).resources["monitor"],
    ).toEqual({ status: GuidedSetupResourceStatus.Created });
  });

  test("is refused, as a whole, when it is not what a run keeps", () => {
    const refused: Array<unknown> = [
      null,
      "values",
      [],
      { values: [] },
      { values: "monitorId" },
      { resources: [] },
      { values: { "has space": "x" } },
      { values: { monitorId: 3 } },
      { values: { monitorId: { id: MONITOR_ID } } },
      {
        values: {
          address: "x".repeat(GUIDED_SETUP_RUN_LIMITS.maxValueLength + 1),
        },
      },
      { resources: { "bad-name": { status: "created" } } },
      { resources: { monitor: { status: "waiting" } } },
      { resources: { monitor: { status: "made" } } },
      { resources: { monitor: "created" } },
    ];

    for (const body of refused) {
      expect(() => {
        return parseGuidedSetupRunChange(body);
      }).toThrow(BadDataException);
    }
  });

  test("every refusal is a sentence", () => {
    for (const body of [
      null,
      { values: [] },
      { resources: [] },
      { values: { "has space": "x" } },
      { values: { monitorId: 3 } },
      { resources: { monitor: { status: "made" } } },
    ]) {
      try {
        parseGuidedSetupRunChange(body);
      } catch (err) {
        const message: string = (err as Error).message;

        expect(message).toMatch(/^[A-Z]/);
        expect(message).toMatch(/\.$/);
      }
    }
  });
});

describe("merging a change into a run", () => {
  const values: GuidedSetupRunValues = {
    monitorId: MONITOR_ID,
    whoIsToldConfirmed: true,
  };
  const resources: GuidedSetupRunResources = {
    monitor: {
      status: GuidedSetupResourceStatus.Created,
      recordId: MONITOR_ID,
      at: NOW.toISOString(),
    },
  };

  test("sets and removes name by name, leaving the rest as it was", () => {
    expect(
      applyGuidedSetupRunChange({
        values: values,
        resources: resources,
        change: change(
          { policyId: POLICY_ID, whoIsToldConfirmed: null },
          {
            on_call_policy: {
              status: GuidedSetupResourceStatus.Created,
              recordId: POLICY_ID,
            },
          },
        ),
        now: LATER,
      }),
    ).toEqual({
      values: { monitorId: MONITOR_ID, policyId: POLICY_ID },
      resources: {
        monitor: resources["monitor"],
        on_call_policy: {
          status: GuidedSetupResourceStatus.Created,
          recordId: POLICY_ID,
          at: LATER.toISOString(),
        },
      },
    });
  });

  test("two devices that change different steps both keep theirs", () => {
    const fromLaptop: ReturnType<typeof applyGuidedSetupRunChange> =
      applyGuidedSetupRunChange({
        values: {},
        resources: {},
        change: change({ monitorId: MONITOR_ID }),
        now: NOW,
      });
    const fromPhone: ReturnType<typeof applyGuidedSetupRunChange> =
      applyGuidedSetupRunChange({
        ...fromLaptop,
        change: change({ testSkipped: true }),
        now: LATER,
      });

    expect(fromPhone.values).toEqual({
      monitorId: MONITOR_ID,
      testSkipped: true,
    });
  });

  test("the same name saved twice keeps the last", () => {
    expect(
      applyGuidedSetupRunChange({
        values: { policyId: POLICY_ID },
        resources: {},
        change: change({ policyId: MONITOR_ID }),
        now: NOW,
      }).values,
    ).toEqual({ policyId: MONITOR_ID });
  });

  test("a step tried again replaces its failure, never adds a second entry", () => {
    const failed: ReturnType<typeof applyGuidedSetupRunChange> =
      applyGuidedSetupRunChange({
        values: {},
        resources: {},
        change: change(
          {},
          {
            monitor: {
              status: GuidedSetupResourceStatus.Failed,
              error: "OneUptime could not be reached.",
            },
          },
        ),
        now: NOW,
      });
    const retried: ReturnType<typeof applyGuidedSetupRunChange> =
      applyGuidedSetupRunChange({
        ...failed,
        change: change(
          { monitorId: MONITOR_ID },
          {
            monitor: {
              status: GuidedSetupResourceStatus.Created,
              recordId: MONITOR_ID,
            },
          },
        ),
        now: LATER,
      });

    expect(Object.keys(retried.resources)).toEqual(["monitor"]);
    expect(retried.resources["monitor"]).toEqual({
      status: GuidedSetupResourceStatus.Created,
      recordId: MONITOR_ID,
      at: LATER.toISOString(),
    });
  });

  test("leaves what it was handed as it was", () => {
    const before: GuidedSetupRunValues = { ...values };

    applyGuidedSetupRunChange({
      values: values,
      resources: resources,
      change: change({ monitorId: null }),
      now: NOW,
    });

    expect(values).toEqual(before);
  });

  test("refuses a run that would grow past what a run keeps", () => {
    const full: GuidedSetupRunValues = {};

    for (
      let index: number = 0;
      index < GUIDED_SETUP_RUN_LIMITS.maxValues;
      index++
    ) {
      full[`value${index}`] = true;
    }

    expect(() => {
      return applyGuidedSetupRunChange({
        values: full,
        resources: {},
        change: change({ oneMore: true }),
        now: NOW,
      });
    }).toThrow(BadDataException);

    // Replacing one that is there is no growth.
    expect(
      Object.keys(
        applyGuidedSetupRunChange({
          values: full,
          resources: {},
          change: change({ value0: "replaced" }),
          now: NOW,
        }).values,
      ),
    ).toHaveLength(GUIDED_SETUP_RUN_LIMITS.maxValues);
  });
});

describe("an answer", () => {
  const answer: GuidedSetupRunAnswer = {
    setup: GuidedSetupKey.WebsiteDown,
    run: {
      values: { monitorId: MONITOR_ID, testSkipped: true },
      resources: {
        monitor: {
          status: GuidedSetupResourceStatus.Created,
          recordId: MONITOR_ID,
          name: "acme.example",
          at: NOW.toISOString(),
        },
      },
      revision: 4,
      updatedAt: NOW.toISOString(),
    },
  };

  test("reads back as it was sent", () => {
    expect(
      parseGuidedSetupRunAnswer(toGuidedSetupRunAnswerJSON(answer)),
    ).toEqual(answer);
  });

  test("no run reads as none", () => {
    expect(
      parseGuidedSetupRunAnswer(
        toGuidedSetupRunAnswerJSON({ setup: GuidedSetupKey.OnCall, run: null }),
      ),
    ).toEqual({ setup: GuidedSetupKey.OnCall, run: null });
  });

  test("what is not an answer is null, so the page goes on with what it kept", () => {
    for (const value of [
      null,
      "run",
      {},
      { setup: "example_setup", run: null },
      { setup: "on_call", run: "kept" },
    ]) {
      expect(parseGuidedSetupRunAnswer(value)).toBeNull();
    }
  });

  test("a run's values and resources are read as leniently as a stored one", () => {
    const json: JSONObject = {
      setup: "on_call",
      run: {
        values: { policyId: POLICY_ID, junk: 3 },
        resources: { a: { status: "made", at: NOW.toISOString() } },
        revision: "seven",
        updatedAt: 12,
      },
    };

    expect(parseGuidedSetupRunAnswer(json)).toEqual({
      setup: GuidedSetupKey.OnCall,
      run: {
        values: { policyId: POLICY_ID },
        resources: {},
        revision: 0,
        updatedAt: "",
      },
    });
  });
});
