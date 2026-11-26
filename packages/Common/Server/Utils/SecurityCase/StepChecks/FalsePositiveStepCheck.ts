import { SecurityCaseStepCheckSentence } from "../../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_KINDS } from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import {
  CHECK_FACT_NOT_OWN_ADDRESS,
  CHECK_FACT_NO_SIGNED_IN_USERS,
  CHECK_FACT_NO_THREAT_INTEL,
  CHECK_FACT_OWN_ADDRESS,
  CHECK_FACT_SIGNED_IN_USERS,
  CHECK_FACT_THREAT_INTEL,
  CHECK_FALSE_POSITIVE_JUDGEMENT,
} from "../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { canonicalAddress } from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { readFailed } from "./AddressStepChecks";
import { AddressFactsReading } from "./Evidence/AddressFacts";
import {
  StepCheck,
  StepCheckContext,
  StepCheckResult,
  evidenceOf,
  sentence,
} from "./StepCheck";

/*
 * "RULE OUT A FALSE POSITIVE" (#10340). A judgement, so OneUptime never
 * verifies it on its own: it says so, prefilled with what it knows of the
 * address - whether it is one of the project's own, whether threat intel
 * lists it, whether anyone signed in from it - for a person, or OneUptime AI
 * (#10352), to decide. Only for a step about an address.
 */

export function decideFalsePositive(data: {
  facts: AddressFactsReading | null;
}): StepCheckResult {
  const facts: AddressFactsReading | null = data.facts;

  if (!facts) {
    return readFailed();
  }

  const lines: Array<SecurityCaseStepCheckSentence> = [
    facts.recordName
      ? sentence(CHECK_FACT_OWN_ADDRESS, { name: facts.recordName })
      : sentence(CHECK_FACT_NOT_OWN_ADDRESS),
    facts.threatIntelFeeds > 0
      ? sentence(CHECK_FACT_THREAT_INTEL, {}, { count: facts.threatIntelFeeds })
      : sentence(CHECK_FACT_NO_THREAT_INTEL),
    facts.signedInUsers > 0 && facts.signedInUser
      ? sentence(
          CHECK_FACT_SIGNED_IN_USERS,
          { user: facts.signedInUser },
          { count: facts.signedInUsers },
        )
      : sentence(CHECK_FACT_NO_SIGNED_IN_USERS),
  ];

  return {
    state: SecurityCaseStepCheckState.CannotTell,
    evidence: evidenceOf({
      sentence: sentence(CHECK_FALSE_POSITIVE_JUDGEMENT),
      facts: lines,
      data: {
        reason: "Judgement",
        isOwnAddress: Boolean(facts.recordName),
        threatIntelFeeds: facts.threatIntelFeeds,
        signedInUsers: facts.signedInUsers,
      },
    }),
  };
}

const FalsePositiveStepCheck: StepCheck = {
  kind: RESPONSE_STEP_KINDS.falsePositive,
  // Facts that change slowly: once an hour is enough.
  intervalInMinutes: 60,
  check: async (context: StepCheckContext): Promise<StepCheckResult | null> => {
    const address: string | null = canonicalAddress(context.target.value);

    if (!address) {
      return null;
    }

    let facts: AddressFactsReading | null = null;

    try {
      facts = await context.evidence.readAddressFacts(address);
    } catch {
      facts = null;
    }

    return decideFalsePositive({ facts });
  },
};

export default FalsePositiveStepCheck;
