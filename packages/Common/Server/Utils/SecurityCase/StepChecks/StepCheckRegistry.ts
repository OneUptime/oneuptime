import { isResponseStepOfKind } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import BlockAddressStepCheck from "./BlockAddressStepCheck";
import {
  ContainHostStepCheck,
  ContainUserStepCheck,
} from "./ContainStepChecks";
import FalsePositiveStepCheck from "./FalsePositiveStepCheck";
import {
  FixCredentialsStepCheck,
  FixMfaStepCheck,
} from "./FixAccountStepChecks";
import FixRouteStepCheck from "./FixRouteStepCheck";
import IncidentStepCheck from "./IncidentStepCheck";
import {
  BlockAddressEverywhereStepCheck,
  BlockDomainStepCheck,
  QuarantineFileStepCheck,
} from "./IndicatorBlockStepChecks";
import RequestsStepCheck from "./RequestsStepCheck";
import { StepCheck } from "./StepCheck";

/*
 * THE KINDS OF RESPONSE PLAN STEP ONEUPTIME CHECKS ITSELF (#10340), one
 * module a kind. A step of any other kind - a rule's own step, a Fix step
 * OneUptime cannot read back (persistence, the account changes an attack
 * made) - is a person's to tick. Blocking a domain, a file or a
 * command-and-control address on every machine is read back from the
 * blocklist (#10346).
 *
 * A new kind of step plugs in here: a StepCheck whose `kind` is the start
 * of the step's key (Utils/SecurityCase/ResponsePlan/ResponsePlanKeys), and
 * whose evidence comes through StepCheckEvidence.
 */
export const STEP_CHECKS: ReadonlyArray<StepCheck> = [
  BlockAddressStepCheck,
  RequestsStepCheck,
  FalsePositiveStepCheck,
  ContainUserStepCheck,
  ContainHostStepCheck,
  BlockDomainStepCheck,
  QuarantineFileStepCheck,
  BlockAddressEverywhereStepCheck,
  IncidentStepCheck,
  // The Fix steps (#10347): the route turns the attack away, the password, MFA.
  FixRouteStepCheck,
  FixCredentialsStepCheck,
  FixMfaStepCheck,
];

// The check of a step, by its key; null for a kind OneUptime does not check.
export function getStepCheck(
  stepKey: string,
  checks: ReadonlyArray<StepCheck> = STEP_CHECKS,
): StepCheck | null {
  return (
    checks.find((check: StepCheck): boolean => {
      return isResponseStepOfKind(stepKey, check.kind);
    }) || null
  );
}
