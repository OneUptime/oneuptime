import Route from "Common/Types/API/Route";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  SYSTEMD_UNIT_CURRENT,
  SystemdFailedUnit,
} from "../../Pages/Host/Utils/SystemdUnitFailure";
import {
  loadSystemdFailedUnits,
  loadSystemdUnitFailure,
} from "../../Pages/Host/Utils/SystemdUnitFailureDialog";
import ResourceAttentionPill from "../ResourcePart/ResourceAttentionPill";

/*
 * A FAILED SYSTEMD UNIT OPENS WHY IT FAILED (#9748, #9960).
 *
 * "Failed" on a unit's page and on its row of the host's Systemd Units list
 * is one pill, opening one dialog: why, as systemd said it (an exit code,
 * the signal that killed it, a timeout), since when and what the unit
 * printed, read from its journal when it is pressed. From the list the row
 * has View, to the unit's page; on that page it is "This unit".
 *
 * And the list's count of failed units ("3 units failed") opens all of them
 * in the same dialog, each with why, since when and View, the newest
 * failure first (SystemdFailedUnitsPill).
 */

const STATE_FAILED: string = translationKey("Failed");
const FAILED_TITLE: string = translationKey("Why {{unit}} failed");
const FAILED_HINT: string = translationKey("Show why");
const FAILED_EMPTY: string = translationKey("Nothing needs attention now.");
const FAILED_READ_FAILED: string = translationKey(
  "Couldn't read what needs attention",
);

const FAILED_UNITS_COUNT: { one: string; other: string } = {
  one: translationKey("{{count}} unit failed"),
  other: translationKey("{{count}} units failed"),
};
const FAILED_UNITS_TITLE: { one: string; other: string } = {
  one: translationKey("{{count}} failed systemd unit"),
  other: translationKey("{{count}} failed systemd units"),
};
const FAILED_UNITS_HINT: string = translationKey(
  "Show which units failed and why",
);
const FAILED_UNITS_EMPTY: string = translationKey("No unit is failed now.");
const FAILED_UNITS_TRUNCATED: { one: string; other: string } = {
  one: translationKey("Showing the first {{count}}, the newest failure first."),
  other: translationKey(
    "Showing the first {{count}}, the newest failure first.",
  ),
};

export interface ComponentProps {
  // The host's name, as its lines carry it (resource.host.name).
  hostIdentifier: string;
  unitName: string;
  testId: string;
  // On the unit's own page: its row is "This unit", with no View.
  isCurrentUnit?: boolean | undefined;
  // From a list: the unit's page, which its row's View opens.
  unitRoute?: Route | undefined;
}

const SystemdUnitFailedPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ResourceAttentionPill
      label={translator.translateText(STATE_FAILED) || STATE_FAILED}
      tone="danger"
      testId={props.testId}
      dataAttributes={{ "data-unit": props.unitName }}
      hint={FAILED_HINT}
      dialog={{
        title: translator.translateTemplate(
          FAILED_TITLE,
          { unit: props.unitName },
          { setsValuesApart: true },
        ),
        load: () => {
          return loadSystemdUnitFailure({
            hostIdentifier: props.hostIdentifier,
            unitName: props.unitName,
            translator: translator,
            unitRoute: props.isCurrentUnit ? undefined : props.unitRoute,
          });
        },
        emptyMessage: FAILED_EMPTY,
        whatFailed: FAILED_READ_FAILED,
        showKind: false,
        current: props.isCurrentUnit ? SYSTEMD_UNIT_CURRENT : undefined,
      }}
    />
  );
};

export default SystemdUnitFailedPill;

export interface SystemdFailedUnitsPillProps {
  hostIdentifier: string;
  // The units the list read as failed, each with its page.
  units: ReadonlyArray<SystemdFailedUnit>;
  testId: string;
}

// "3 units failed", opening which and why.
export const SystemdFailedUnitsPill: FunctionComponent<
  SystemdFailedUnitsPillProps
> = (props: SystemdFailedUnitsPillProps): ReactElement => {
  const translator: Translator = useTranslator();
  const count: number = props.units.length;

  return (
    <ResourceAttentionPill
      label={translator.translatePlural(FAILED_UNITS_COUNT, count)}
      tone="danger"
      testId={props.testId}
      hint={FAILED_UNITS_HINT}
      dialog={{
        title: translator.translatePlural(FAILED_UNITS_TITLE, count),
        load: () => {
          return loadSystemdFailedUnits({
            hostIdentifier: props.hostIdentifier,
            units: props.units,
            translator: translator,
          });
        },
        emptyMessage: FAILED_UNITS_EMPTY,
        whatFailed: FAILED_READ_FAILED,
        showKind: false,
        truncatedMessage: FAILED_UNITS_TRUNCATED,
      }}
    />
  );
};
