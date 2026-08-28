import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import ScanNameUtil from "Common/Utils/NetworkDiscovery/ScanNameUtil";
import SnmpScanConfigUtil from "Common/Utils/NetworkDiscovery/SnmpScanConfigUtil";
import { MINIMUM_RESCAN_INTERVAL_IN_MINUTES } from "Common/Utils/NetworkDiscovery/RescanIntervalUtil";

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
 * The field DEFINITIONS deliberately stay in Discovery.tsx: the wizard
 * invariants in App/Tests/Dashboard/NetworkFormStepsInvariants.test.ts match a
 * page's declared step ids against the `stepId: "..."` literals on that same
 * page, and moving the fields to another file would move the literals with
 * them. (Module scope within Discovery.tsx is fine, and is where they live, so
 * the create wizard and the edit dialog share one definition.)
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
 *
 * Re-exported rather than declared, so the form, the write hooks that derive
 * the next run from it, and the probe-ingest endpoint that clamps to it are
 * all quoting one number. It used to be written out separately in each of
 * those three places.
 */
export { MINIMUM_RESCAN_INTERVAL_IN_MINUTES } from "Common/Utils/NetworkDiscovery/RescanIntervalUtil";

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

export type ScanNameValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
) => string | null;

/*
 * The scan's optional name (issue #3391). Delegates to the same
 * ScanNameUtil.getValidationError the server throws with
 * (NetworkDeviceDiscoveryScanService.onBeforeCreate / onBeforeUpdate), so the
 * two messages are identical by construction.
 *
 * It covers two cases the field's own rules cannot:
 *
 *   - a value that is not text at all, which the server rejects and no form
 *     rule looks at;
 *   - a name whose length is only acceptable AFTER normalization. Length is
 *     measured here exactly as the server measures it — on the value that
 *     would be stored — so a name of 100 characters plus a trailing newline
 *     is saved rather than rejected.
 *
 * ModelForm also infers a maxLength of 100 from the ShortText column, and that
 * rule keeps its own message: customValidation runs last but only OVERWRITES
 * when it returns something, so a box holding more than 100 characters is
 * refused by the inferred rule even in the narrow case where collapsing its
 * internal whitespace would have brought it under the cap. That errs toward
 * the operator shortening a name they can see is too long, which is the safe
 * direction — the form never accepts a name the server would refuse, which is
 * the failure shape issue #3377 was about.
 *
 * Nothing else here is an error: the field is optional, so an empty box and a
 * blank one are both simply "no name", and neither the form nor the server
 * complains.
 */
export const validateScanName: ScanNameValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
): string | null => {
  return ScanNameUtil.getValidationError(values.name);
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

/*
 * The credential LIST the SNMP Credentials step now collects
 * (Components/NetworkDevice/SnmpConfigListEditor).
 *
 * Every rule is delegated to SnmpScanConfigUtil — the same module
 * NetworkDeviceDiscoveryScanService validates the write with — so the sentence
 * shown under the editor is, word for word, the sentence the API would have
 * returned. That is the whole reason the rules live in Common: a scan that
 * saves is a scan the probe can run.
 *
 * A module-level constant rather than an inline arrow inside the field
 * factory: the edit dialog builds its fields by calling the wizard's factory a
 * second time, and Common/Tests/App/Dashboard/DiscoveryScanEditForm.test.tsx
 * compares the two field arrays' validators BY IDENTITY to prove the two
 * layouts judge every field by the same rule. A per-call closure would fail
 * that — correctly, because it would no longer be the same rule object.
 */
export type SnmpConfigsValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
) => string | null;

export const validateSnmpConfigs: SnmpConfigsValidatorFunction = (
  values: FormValues<NetworkDeviceDiscoveryScan>,
): string | null => {
  const raw: unknown = values.snmpConfigs;

  /*
   * Untouched on a form the editor has not reported into yet. `required`
   * speaks for that case, exactly as it does for every other field here —
   * see readRawString above for why emptiness is not this validator's
   * business.
   */
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  return SnmpScanConfigUtil.getValidationError(raw);
};
