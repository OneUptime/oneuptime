/*
 * Common/UI/Config computes every URL constant at import time from
 * `window?.process?.env`, and a node test environment has no `window` BINDING
 * at all — so the optional chain does not save it, it throws a ReferenceError
 * and the whole suite fails to load. Every UI module on the page's import
 * graph reaches Config eventually.
 *
 * Sibling suites stub Config down to the one or two constants they need
 * (ReferenceDataCache.test.ts, NetworkSummaryApi.test.ts). That is not enough
 * here: this file imports a page, not a util, so the graph is wide and any
 * export left out of the stub becomes `undefined` in a module-level `new
 * URL(...)` somewhere. Declaring the binding and then loading the real module
 * keeps every constant real and leaves nothing to keep in step.
 */
jest.mock("Common/UI/Config", (): unknown => {
  (globalThis as unknown as { window: unknown }).window = {
    process: { env: {} },
  };

  return jest.requireActual("Common/UI/Config");
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  describeBurnRateOutputs,
  validateBurnRateOutputs,
  validateBurnRateThreshold,
  validateBurnRateWindows,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules";
import ServiceLevelObjectiveBurnRateRule from "Common/Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";

/*
 * A burn rate rule now chooses its outputs: raise an Alert, declare an
 * Incident, or both — and it must do at least one. BurnRateRules.tsx exports
 * two small pure functions for that choice, plus the two older validators for
 * the threshold and the window pair, and nothing exercised any of them.
 *
 * They are pure and side-effect free, so this suite imports the page module
 * directly rather than reading it as text. Nothing here renders: the page's
 * React component is never called, and its imports (ModelTable, ModelAPI,
 * Navigation) only have to LOAD under the App project's node environment, not
 * run. If one of them ever grows a module-level `window` access this file is
 * where it shows up first, and the fix is a jest.mock of that module — not a
 * copy of the validators moved somewhere easier to import.
 */

const NO_OUTPUT_ERROR: string =
  "This rule would do nothing. Turn on Create Alert, Declare Incident, or both.";

const WINDOW_ORDER_ERROR: string =
  "The short window must be shorter than the long window.";

const THRESHOLD_ERROR: string =
  "The burn rate threshold must be greater than 0.";

type OutputFlags = {
  shouldCreateAlert?: boolean | undefined;
  shouldCreateIncident?: boolean | undefined;
};

function validateOutputs(flags: OutputFlags): string | null {
  return validateBurnRateOutputs(
    flags as FormValues<ServiceLevelObjectiveBurnRateRule>,
  );
}

/* Every value a toggle can arrive with: never touched, on, off. */
const EVERY_FLAG_VALUE: Array<boolean | undefined> = [undefined, true, false];

type OutputCase = [string, OutputFlags, string | null];

/*
 * Every combination of the two toggles, including "never touched". ModelForm
 * leaves a field the user never went near undefined, so the absent cases are
 * the common ones rather than the exotic ones: the create form opens with both
 * flags unset and has to pass.
 */
const OUTPUT_CASES: Array<OutputCase> = [
  ["a brand-new form, with neither toggle touched", {}, null],
  [
    "alert off, incident on — the incident-only rule",
    { shouldCreateAlert: false, shouldCreateIncident: true },
    null,
  ],
  [
    "alert on, incident off — every rule that predates incidents",
    { shouldCreateAlert: true, shouldCreateIncident: false },
    null,
  ],
  ["both on", { shouldCreateAlert: true, shouldCreateIncident: true }, null],
  [
    "incident explicitly off, alert never touched",
    { shouldCreateIncident: false },
    null,
  ],
  ["incident on, alert never touched", { shouldCreateIncident: true }, null],
  [
    "alert off, incident never touched — the toggle that loses the rule",
    { shouldCreateAlert: false },
    NO_OUTPUT_ERROR,
  ],
  [
    "both off",
    { shouldCreateAlert: false, shouldCreateIncident: false },
    NO_OUTPUT_ERROR,
  ],
];

describe("validateBurnRateOutputs", () => {
  test.each(OUTPUT_CASES)(
    "%s",
    (_label: string, flags: OutputFlags, expected: string | null): void => {
      expect(validateOutputs(flags)).toBe(expected);
    },
  );

  test("rejects with the copy that names both toggles by their form labels", () => {
    /*
     * Pinned verbatim because it is the only place the user is told what to do
     * about it. The server's own message ("A burn rate rule must create an
     * alert, declare an incident, or both.") is written for an API caller and
     * names neither control on screen.
     */
    expect(validateOutputs({ shouldCreateAlert: false })).toBe(
      "This rule would do nothing. Turn on Create Alert, Declare Incident, or both.",
    );
  });
});

/*
 * This validator is a convenience, not the enforcement.
 * ServiceLevelObjectiveBurnRateRuleService rejects an output-less rule in
 * onBeforeCreate and onBeforeUpdate with NO_OUTPUT_ERROR_MESSAGE, and that is
 * what actually protects the data — a rule created through the API, a seeded
 * rule, or a rule updated by anything that is not this form all go through the
 * service and never through this function. Deleting the client validator would
 * cost a round-trip and a raw exception rendered at the user; deleting the
 * server one would let the rule exist.
 *
 * What matters here is that the two agree about WHICH rules are output-less.
 * A client stricter than the server blocks a save the API would have taken; a
 * client laxer than the server sends the user into the round-trip this
 * function exists to avoid. Both halves read the same two defaults, so the
 * defaults are pinned against the model's own columns rather than against a
 * second copy of the literals.
 */
describe("validateBurnRateOutputs mirrors the server rule it stands in for", () => {
  const SERVER_SERVICE_SOURCE: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Common",
      "Server",
      "Services",
      "ServiceLevelObjectiveBurnRateRuleService.ts",
    ),
    "utf8",
  );

  function squash(text: string): string {
    return text.replace(/\s+/g, " ");
  }

  const SERVER_CODE: string = squash(SERVER_SERVICE_SOURCE);

  test("the server still enforces it, on both write paths", () => {
    expect(SERVER_CODE).toContain(
      squash(
        'export const NO_OUTPUT_ERROR_MESSAGE: string = "A burn rate rule must create an alert, declare an incident, or both.";',
      ),
    );

    /*
     * Matched on the throw rather than on the whole `if (!a && !b)` body.
     * Pinning the body made a rename of two locals — or hoisting the shared
     * condition into a helper, the obvious cleanup — fail here while changing
     * nothing at all.
     */
    expect(
      SERVER_CODE.match(
        /throw new BadDataException\(NO_OUTPUT_ERROR_MESSAGE\)/g,
      ) || [],
    ).not.toHaveLength(0);

    /*
     * And the UPDATE path specifically: a toggle in this form goes through
     * onBeforeUpdate, not onBeforeCreate, so a suite that only pinned the
     * create branch would stay green while the case it exists for went
     * unenforced.
     */
    expect(SERVER_CODE).toContain(
      squash("await this.validateOutputsOnUpdate(updateBy);"),
    );
    expect(SERVER_CODE).toContain(
      squash("private async validateOutputsOnUpdate("),
    );
  });

  const ALERT_COLUMN: TableColumnMetadata =
    new ServiceLevelObjectiveBurnRateRule().getTableColumnMetadata(
      "shouldCreateAlert",
    );
  const INCIDENT_COLUMN: TableColumnMetadata =
    new ServiceLevelObjectiveBurnRateRule().getTableColumnMetadata(
      "shouldCreateIncident",
    );

  test("reads an untouched form the way the columns are defaulted", () => {
    /*
     * `shouldCreateAlert !== false` and `shouldCreateIncident === true` are the
     * client's way of spelling these two defaults. Flip a column default in the
     * model without flipping the comparison here and a form the server would
     * accept starts being rejected in the browser, or the reverse.
     */
    expect(ALERT_COLUMN.defaultValue).toBe(true);
    expect(INCIDENT_COLUMN.defaultValue).toBe(false);
  });

  function serverWouldReject(flags: OutputFlags): boolean {
    /*
     * The server's onBeforeCreate, minus the string coercion it also does for
     * API callers: an absent flag becomes the column default, then the rule is
     * output-less when both land on false. This form only ever submits real
     * booleans or nothing at all, so those are the inputs compared.
     */
    const createsAlert: boolean =
      flags.shouldCreateAlert === undefined
        ? (ALERT_COLUMN.defaultValue as boolean)
        : flags.shouldCreateAlert;

    const createsIncident: boolean =
      flags.shouldCreateIncident === undefined
        ? (INCIDENT_COLUMN.defaultValue as boolean)
        : flags.shouldCreateIncident;

    return !createsAlert && !createsIncident;
  }

  test("agrees with it on all nine combinations of the two toggles", () => {
    for (const shouldCreateAlert of EVERY_FLAG_VALUE) {
      for (const shouldCreateIncident of EVERY_FLAG_VALUE) {
        const flags: OutputFlags = { shouldCreateAlert, shouldCreateIncident };

        expect({
          flags,
          blocked: validateOutputs(flags) !== null,
        }).toEqual({
          flags,
          blocked: serverWouldReject(flags),
        });
      }
    }
  });
});

type DescribeCase = [string, OutputFlags, string];

const DESCRIBE_CASES: Array<DescribeCase> = [
  [
    "Alert + Incident",
    { shouldCreateAlert: true, shouldCreateIncident: true },
    "Alert + Incident",
  ],
  [
    "Incident",
    { shouldCreateAlert: false, shouldCreateIncident: true },
    "Incident",
  ],
  ["Alert", { shouldCreateAlert: true, shouldCreateIncident: false }, "Alert"],
  [
    "Nothing",
    { shouldCreateAlert: false, shouldCreateIncident: false },
    "Nothing",
  ],
];

function makeRule(flags: OutputFlags): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();

  /*
   * Assigned only when the flag is present. `exactOptionalPropertyTypes` makes
   * `x = undefined` a type error on an optional column, and the distinction is
   * the point of half these cases: a row fetched without the column selected
   * has the property ABSENT, which is what must read as the column default.
   */
  if (flags.shouldCreateAlert !== undefined) {
    rule.shouldCreateAlert = flags.shouldCreateAlert;
  }

  if (flags.shouldCreateIncident !== undefined) {
    rule.shouldCreateIncident = flags.shouldCreateIncident;
  }

  return rule;
}

describe("describeBurnRateOutputs", () => {
  test.each(DESCRIBE_CASES)(
    "renders %s",
    (_label: string, flags: OutputFlags, expected: string): void => {
      expect(describeBurnRateOutputs(makeRule(flags))).toBe(expected);
    },
  );

  /*
   * The case the label is most likely to get wrong, and the one that matters
   * most when it does. A row arrives from ModelTable with only the columns the
   * table asked for, so a select that forgets these two hands this function an
   * object where both are undefined. Reading that as "Nothing" would tell the
   * on-call engineer a rule is inert while it is in fact paging them — the
   * defaults have to win over the absence.
   */
  test("a row fetched without the two columns still reads as Alert", () => {
    expect(
      describeBurnRateOutputs({} as ServiceLevelObjectiveBurnRateRule),
    ).toBe("Alert");
    expect(
      describeBurnRateOutputs(new ServiceLevelObjectiveBurnRateRule()),
    ).toBe("Alert");
  });

  test("an unselected alert column does not hide an incident that is on", () => {
    expect(
      describeBurnRateOutputs(makeRule({ shouldCreateIncident: true })),
    ).toBe("Alert + Incident");
  });

  test("only an explicit false turns the alert half off", () => {
    /*
     * Not falsiness: null and 0 reach the row when a column is missing from a
     * partially hydrated payload, and treating them as "off" would downgrade
     * the label for a rule nobody changed.
     */
    expect(
      describeBurnRateOutputs({
        shouldCreateAlert: null,
      } as unknown as ServiceLevelObjectiveBurnRateRule),
    ).toBe("Alert");
  });

  test("never disagrees with the validator about what counts as nothing", () => {
    /*
     * "Nothing" is the label for a state validateBurnRateOutputs refuses to
     * save and the server refuses to store. It should therefore be unreachable
     * through the form, and it is only ever printed for a rule that predates
     * the check or was written around it. If the two ever disagree, one of them
     * is wrong about the defaults.
     */
    for (const shouldCreateAlert of EVERY_FLAG_VALUE) {
      for (const shouldCreateIncident of EVERY_FLAG_VALUE) {
        const flags: OutputFlags = { shouldCreateAlert, shouldCreateIncident };

        expect({
          flags,
          nothing: describeBurnRateOutputs(makeRule(flags)) === "Nothing",
        }).toEqual({
          flags,
          nothing: validateOutputs(flags) !== null,
        });
      }
    }
  });
});

type WindowValues = {
  longWindowInMinutes?: number | string | undefined;
  shortWindowInMinutes?: number | string | undefined;
};

function validateWindows(values: WindowValues): string | null {
  return validateBurnRateWindows(
    values as FormValues<ServiceLevelObjectiveBurnRateRule>,
  );
}

type WindowCase = [string, WindowValues, string | null];

const WINDOW_CASES: Array<WindowCase> = [
  [
    "the shipped Fast burn pair",
    { longWindowInMinutes: 60, shortWindowInMinutes: 5 },
    null,
  ],
  [
    "transposed — the mistake this validator exists for",
    { longWindowInMinutes: 5, shortWindowInMinutes: 60 },
    WINDOW_ORDER_ERROR,
  ],
  [
    "equal windows, where the short window confirms nothing the long one did not",
    { longWindowInMinutes: 60, shortWindowInMinutes: 60 },
    WINDOW_ORDER_ERROR,
  ],
  [
    "one minute apart is still apart",
    { longWindowInMinutes: 60, shortWindowInMinutes: 59 },
    null,
  ],
];

type IncompleteWindowCase = [string, WindowValues];

const INCOMPLETE_WINDOW_CASES: Array<IncompleteWindowCase> = [
  ["both blank, as the form opens", {}],
  ["only the long window filled in", { longWindowInMinutes: 60 }],
  ["only the short window filled in", { shortWindowInMinutes: 5 }],
  [
    "a value that is not a number at all",
    { longWindowInMinutes: "sixty", shortWindowInMinutes: 5 },
  ],
];

describe("validateBurnRateWindows", () => {
  test.each(WINDOW_CASES)(
    "%s",
    (_label: string, values: WindowValues, expected: string | null): void => {
      expect(validateWindows(values)).toBe(expected);
    },
  );

  test("compares the windows as numbers, not as the strings the inputs hand over", () => {
    /*
     * HTML number inputs give Formik strings, and "60" >= "1440" is true as a
     * lexicographic comparison — so a rule with a 1440-minute long window and a
     * 60-minute short one would be rejected as transposed. The same hazard is
     * called out on the server's own coercion helper.
     */
    expect(
      validateWindows({
        longWindowInMinutes: "1440",
        shortWindowInMinutes: "60",
      }),
    ).toBeNull();
    expect(
      validateWindows({
        longWindowInMinutes: "60",
        shortWindowInMinutes: "1440",
      }),
    ).toBe(WINDOW_ORDER_ERROR);
  });

  test.each(INCOMPLETE_WINDOW_CASES)(
    "stays quiet for %s — the field's own required/number rules own that",
    (_label: string, values: WindowValues): void => {
      /*
       * Two validators complaining about the same empty field would stack a
       * "short window must be shorter" error onto a field the user has not
       * reached yet. This one only speaks once both windows are real numbers.
       */
      expect(validateWindows(values)).toBeNull();
    },
  );
});

type ThresholdValues = {
  burnRateThreshold?: number | string | undefined;
};

function validateThreshold(values: ThresholdValues): string | null {
  return validateBurnRateThreshold(
    values as FormValues<ServiceLevelObjectiveBurnRateRule>,
  );
}

type ThresholdCase = [string, ThresholdValues, string | null];

const THRESHOLD_CASES: Array<ThresholdCase> = [
  ["the shipped Fast burn threshold", { burnRateThreshold: 14.4 }, null],
  [
    "a burn rate of exactly 1 — spending the budget on schedule",
    { burnRateThreshold: 1 },
    null,
  ],
  [
    "a fraction, for an SLO that must not burn at all",
    { burnRateThreshold: 0.5 },
    null,
  ],
  [
    "zero, which would fire the moment any budget is spent",
    { burnRateThreshold: 0 },
    THRESHOLD_ERROR,
  ],
  [
    "negative, which would fire permanently",
    { burnRateThreshold: -1 },
    THRESHOLD_ERROR,
  ],
];

describe("validateBurnRateThreshold", () => {
  test.each(THRESHOLD_CASES)(
    "%s",
    (
      _label: string,
      values: ThresholdValues,
      expected: string | null,
    ): void => {
      expect(validateThreshold(values)).toBe(expected);
    },
  );

  test("reads the string a number input hands over", () => {
    expect(validateThreshold({ burnRateThreshold: "14.4" })).toBeNull();
    expect(validateThreshold({ burnRateThreshold: "0" })).toBe(THRESHOLD_ERROR);
  });

  test("unlike the window validator, it does complain about a missing value", () => {
    /*
     * Deliberate asymmetry, pinned so it is not "fixed" into silence. The
     * window rule is about a PAIR and has nothing to say until both halves
     * exist; the threshold is one required field, and a rule with no threshold
     * can never fire, so there is no second validator to defer to.
     */
    expect(validateThreshold({})).toBe(THRESHOLD_ERROR);
    expect(validateThreshold({ burnRateThreshold: "not a number" })).toBe(
      THRESHOLD_ERROR,
    );
  });
});
