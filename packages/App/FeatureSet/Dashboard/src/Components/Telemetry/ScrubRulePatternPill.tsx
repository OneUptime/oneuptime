import { Blue500, Red500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { doesScrubRuleScrubNothing } from "Common/Types/Telemetry/ScrubRule";
import Pill from "Common/UI/Components/Pill/Pill";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A scrub rule's pattern type in the rules table - and, beside it, a red
 * "Scrubs nothing" for a rule ingest skips: a Custom Regex rule saved with
 * no pattern, or one that does not compile, before the server refused them,
 * or a pattern type ingest does not know (Types/Telemetry/ScrubRule
 * doesScrubRuleScrubNothing). Such a rule looked active while the data it
 * was made for was stored in the clear; it is left as it was saved, and
 * this says so until someone edits it.
 */

export interface ScrubRulePatternPillConfig {
  label: string;
  color: Color;
  icon: IconProp;
  tooltip: string;
}

export interface ComponentProps {
  patternType: string | undefined;
  customRegex: string | undefined;
  // How each pattern type is drawn.
  patternTypes: Record<string, ScrubRulePatternPillConfig>;
  // The pattern types ingest scrubs with (LOG_ / TRACE_SCRUB_PATTERN_TYPES).
  knownPatternTypes: ReadonlyArray<string>;
}

const ScrubRulePatternPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const key: string = props.patternType || "unknown";
  const config: ScrubRulePatternPillConfig = props.patternTypes[key] || {
    label: key,
    color: Blue500,
    icon: IconProp.ShieldCheck,
    tooltip: key,
  };

  const scrubsNothing: boolean = doesScrubRuleScrubNothing({
    patternType: props.patternType,
    customRegex: props.customRegex,
    knownPatternTypes: props.knownPatternTypes,
  });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Pill
        text={config.label}
        color={config.color}
        icon={config.icon}
        tooltip={config.tooltip}
      />
      {scrubsNothing && (
        <span data-testid="scrub-rule-scrubs-nothing">
          <Pill
            text="Scrubs nothing"
            color={Red500}
            icon={IconProp.Alert}
            tooltip="This rule has no pattern that ingest can use, so it scrubs nothing. Edit it to give it one, or delete it."
          />
        </span>
      )}
    </div>
  );
};

export default ScrubRulePatternPill;
