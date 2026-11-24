import {
  SNMP_TRAP_REFUSAL_FIXES,
  SNMP_TRAP_REFUSAL_HEADLINE,
  SNMP_TRAP_REFUSAL_REASONS,
  SNMP_TRAP_REFUSAL_WHEN,
} from "./SnmpTrapReceiverCopy";
import OneUptimeDate from "Common/Types/Date";
import { SnmpTrapRefusal } from "Common/Types/Probe/SnmpTrapReceiver";
import {
  Translator,
  composedValue,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  refusals: Array<SnmpTrapRefusal>;
  dataTestId?: string | undefined;
}

/*
 * Refused SNMPv3 traps, one source, reason and user a row (#11005): what
 * failed, in one sentence - "12 SNMPv3 traps from 10.20.0.5 failed: unknown
 * user san-monitor" - what to change so it stops, and when it last
 * happened. The probe's page lists them all; a device's pages list its own.
 */
const SnmpTrapRefusalList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="divide-y divide-gray-100"
      data-testid={props.dataTestId || "snmp-trap-refusals"}
    >
      {props.refusals.map((refusal: SnmpTrapRefusal): ReactElement => {
        const headline: string = translator.translatePlural(
          SNMP_TRAP_REFUSAL_HEADLINE,
          refusal.count,
          {
            address: refusal.sourceAddress,
            reason: composedValue((sentence: Translator): string => {
              return sentence.translateTemplate(
                SNMP_TRAP_REFUSAL_REASONS[refusal.reason],
                { user: refusal.userName },
              );
            }),
          },
        );

        return (
          <li
            key={`${refusal.sourceAddress}|${refusal.reason}|${refusal.userName}`}
            className="py-3 first:pt-0 last:pb-0"
            data-testid="snmp-trap-refusal"
          >
            <p className="text-sm font-medium text-gray-900 break-words">
              {headline}
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                SNMP_TRAP_REFUSAL_FIXES[refusal.reason],
              )}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {translator.translateTemplate(SNMP_TRAP_REFUSAL_WHEN, {
                time: OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(refusal.lastSeenAt),
                ),
                first: OneUptimeDate.fromNow(
                  OneUptimeDate.fromString(refusal.firstSeenAt),
                ),
              })}
            </p>
          </li>
        );
      })}
    </ul>
  );
};

export default SnmpTrapRefusalList;
