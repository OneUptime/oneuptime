import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";

/*
 * Client-side validators for the "Create New Network Device Discovery Scan"
 * wizard (Discovery.tsx).
 *
 * WHY THEY EXIST
 *
 * The wizard has three steps — Scan Target, SNMP Credentials, Schedule — and
 * BasicForm validates only the fields belonging to the step being submitted
 * (the currentFormStepId guard in Common/UI/Components/Forms/Validation.ts).
 * A field-level validator is therefore exactly what turns "Next" into a gate:
 * the message renders inline under its own input, on its own step, and the
 * step refuses to advance until it clears.
 *
 * Until these existed, the only check on a scan target was `required`, which
 * any non-empty string satisfies. A phone-number-shaped value walked through
 * all three steps and failed on the final submit — as one combined banner
 * rendered above the SCHEDULE step, quoting a value typed two steps earlier
 * (NetworkDeviceDiscoveryScanService.onBeforeCreate). OneUptime issue #3377.
 *
 * WHY THEY LIVE HERE AND NOT IN Discovery.tsx
 *
 * App/tsconfig.json excludes FeatureSet/Dashboard — Dashboard is a separate
 * package with its own react, so anything App's tsc reaches inside a Dashboard
 * .tsx fails on "Cannot find module 'react'". A test that imports one pulls it
 * and its whole component tree back in. Keeping the validators in a plain .ts
 * module means App/Tests can exercise them directly, the same reason
 * SloFormFields.ts and DevicePollingFormFields.ts sit outside their pages.
 *
 * The field DEFINITIONS deliberately stay inline in Discovery.tsx: the wizard
 * invariants in App/Tests/Dashboard/NetworkFormStepsInvariants.test.ts match a
 * page's `formSteps={[...]}` ids against the `stepId: "..."` literals on that
 * same page, and moving the fields out would move the literals with them.
 */

/*
 * Form values are JSONValues, so a field's contents are not guaranteed to be a
 * string even when the control that wrote them is a text box — a Number field
 * hands back a number, and a field the operator has not reached yet is simply
 * absent. Normalizing here keeps every validator from having to care.
 *
 * NOT trimmed. Whether a box is empty and whether its contents are blank are
 * two different questions here, and only the first belongs to `required`:
 * Validation.validateRequired tests the RAW string length, so a lone space
 * satisfies it. Trimming before the emptiness check is what let "   " clear
 * every rule on the field and fail on the server two steps later — the very
 * shape of issue #3377. Each validator below trims only after deciding the box
 * is not empty.
 */
type ReadRawStringFunction = (value: unknown) => string;

const readRawString: ReadRawStringFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
};

/*
 * The floor RequeueRecurringScans is sized against: a sweep at the
 * ScanTargetUtil.MAX_SCAN_HOSTS ceiling can take the better part of an hour,
 * so re-queueing one more often than this stacks scans on the same probe.
 */
export const MINIMUM_RESCAN_INTERVAL_IN_MINUTES: number = 15;

export type ScanTargetValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
) => string | null;

/*
 * Delegates to the very function the server validates with
 * (NetworkDeviceDiscoveryScanService.validateScanTarget), so the two messages
 * are identical by construction and cannot drift. That buys three checks the
 * form never had: notation (CIDR or octet range), the 32,768-address sweep
 * ceiling, and the 64-character target cap — every one of which was previously
 * a final-submit-only server error.
 *
 * An EMPTY target is deliberately NOT this validator's business. `required:
 * true` on the field already owns it, and customValidation runs LAST in
 * Validation.validate — so returning ScanTargetUtil's own "A scan target is
 * required." here would replace the form's "Scan Target is required." with a
 * longer sentence repeating the syntax hint the field's description already
 * carries. Same defensive shape as validateBurnRateWindows in
 * Slo/View/BurnRateRules.tsx: say nothing about input the field's own required
 * rule is already speaking for.
 *
 * A BLANK target — spaces, a tab — is a different matter and IS this
 * validator's business, because nothing else on the field will speak for it:
 * validateRequired measures the untrimmed length, so " " passes it, and
 * validateLength only has an upper bound. ScanTargetUtil trims and returns its
 * own "A scan target is required." for that case, which is why the emptiness
 * check below is made against the raw value and the trim happens after it.
 */
export const validateScanTarget: ScanTargetValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
): string | null => {
  const raw: string = readRawString(values.cidr);

  if (raw === "") {
    return null;
  }

  return ScanTargetUtil.getValidationError(raw.trim());
};

export type RescanIntervalValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
) => string | null;

/*
 * Owns the whole rescan-interval rule rather than sharing it with a
 * `validation: { minValue }` declaration, because the built-in check cannot
 * see two of the three ways this field goes wrong:
 *
 *   - it runs the value through parseInt, so "20.5" reads as 20 and clears a
 *     minimum of 15 — then fails the INSERT against an integer column;
 *   - a non-numeric value parses to NaN, and every NaN comparison is false, so
 *     it raises nothing at all.
 *
 * customValidation also runs last, so a `minValue` rule declared alongside
 * this one would only ever have its message overwritten. One validator, one
 * message.
 */
export const validateRescanInterval: RescanIntervalValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
): string | null => {
  /*
   * The field is revealed by showIf on the same toggle, and Validation skips
   * hidden fields — this guard is the belt to that braces, so the rule can
   * never fire against a value left behind by a toggle the operator turned
   * back off.
   */
  if (!values.isRecurring) {
    return null;
  }

  const raw: string = readRawString(values.rescanIntervalInMinutes);

  /*
   * Only a genuinely empty box belongs to `required` — see readRawString. A
   * blank one falls through, and Number("  ") is 0, so it is reported against
   * the floor rather than waved past.
   */
  if (raw === "") {
    return null;
  }

  const minutes: number = Number(raw.trim());

  if (!isFinite(minutes) || !Number.isInteger(minutes)) {
    return "Rescan Interval must be a whole number of minutes.";
  }

  if (minutes < MINIMUM_RESCAN_INTERVAL_IN_MINUTES) {
    return `Rescan Interval must be at least ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES} minutes.`;
  }

  return null;
};
