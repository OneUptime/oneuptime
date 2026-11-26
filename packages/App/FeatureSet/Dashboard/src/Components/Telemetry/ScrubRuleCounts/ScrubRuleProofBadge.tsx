import { PROVEN, PROVEN_TOOLTIP } from "./ScrubRuleCountWords";
import { Green500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { isScrubRuleProven } from "Common/Types/Telemetry/ScrubRuleProof";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  signal: "log" | "trace";
  rule: {
    patternType?: string | undefined;
    customRegex?: string | undefined;
    attributeKeys?: unknown;
    scrubAction?: string | undefined;
    fieldsToScrub?: string | undefined;
    serviceId?: unknown;
    proof?: unknown;
  };
}

/*
 * "Proven" on a scrub rule that carries a proof of itself as it is now
 * (#10366): Data Security ran it on the records the data was seen in,
 * through the code ingest runs, and it hid the data in every value that
 * held it. A rule changed since is no longer the rule that was proven, and
 * loses the badge.
 */
const ScrubRuleProofBadge: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (
    !props.rule.patternType ||
    !isScrubRuleProven({
      rule: {
        signal: props.signal,
        patternType: props.rule.patternType,
        customRegex: props.rule.customRegex,
        attributeKeys: props.rule.attributeKeys,
        scrubAction: props.rule.scrubAction,
        fieldsToScrub: props.rule.fieldsToScrub,
        serviceId: props.rule.serviceId,
      },
      proof: props.rule.proof,
    })
  ) {
    return <></>;
  }

  return (
    <span data-testid="scrub-rule-proven">
      <Pill
        text={PROVEN}
        color={Green500}
        icon={IconProp.CheckCircle}
        tooltip={PROVEN_TOOLTIP}
      />
    </span>
  );
};

export default ScrubRuleProofBadge;
