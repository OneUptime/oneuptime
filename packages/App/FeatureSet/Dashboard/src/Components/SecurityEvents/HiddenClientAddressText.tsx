import AppLink from "../AppLink/AppLink";
import { CLAIMED_NOT_VERIFIED } from "./ClaimedClientAddressCopy";
import {
  HIDDEN_BY_A_SCRUB_RULE,
  HIDDEN_BY_THE_SCRUB_RULE,
} from "./HiddenClientAddressCopy";
import { getHiddenAddressRulesRoute } from "./HiddenClientAddressRoute";
import { SecurityEventDetailField } from "./SecurityEventDetailFields";
import Route from "Common/Types/API/Route";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  HiddenClientAddress,
  ScrubbedAddressRole,
} from "Common/Utils/SecurityEvent/ScrubbedAddress";
import React, { FunctionComponent, ReactElement } from "react";

export const HIDDEN_CLIENT_ADDRESS_TEST_ID: string =
  "security-hidden-client-address";

// Where Target IP says a scrub rule hid the destination (#10419).
export const HIDDEN_TARGET_ADDRESS_TEST_ID: string =
  "security-hidden-target-address";

export const CLAIMED_CLIENT_ADDRESS_TEST_ID: string =
  "security-claimed-client-address";

export interface ComponentProps {
  hidden: HiddenClientAddress;
  dataTestId?: string | undefined;
}

/*
 * WHERE AN EVENT'S ADDRESS WOULD BE, ONCE A SCRUB RULE HID IT (#10397):
 * "Hidden by the scrub rule Scrub IP addresses", the rule's name a link to
 * the list it is in - the logs' or the traces' Scrub Rules, where it can be
 * changed - as Data Security's notices name a rule (TelemetryRuleNotice).
 * An event that names no rule says "Hidden by a scrub rule", the whole
 * sentence the link. Never the value the rule left: "[REDACTED]" says less
 * than the sentence, and a Hash rule's token is the address vault's to read
 * (#10395).
 */
const HiddenClientAddressText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const route: Route | null = getHiddenAddressRulesRoute(props.hidden.signal);
  const dataTestId: string = props.dataTestId || HIDDEN_CLIENT_ADDRESS_TEST_ID;

  if (props.hidden.ruleName) {
    const name: ReactElement = route ? (
      <AppLink
        className="font-medium underline [overflow-wrap:anywhere]"
        to={route}
      >
        {props.hidden.ruleName}
      </AppLink>
    ) : (
      <span className="font-medium [overflow-wrap:anywhere]">
        {props.hidden.ruleName}
      </span>
    );

    return (
      <span data-testid={dataTestId}>
        <TranslatedSentence
          template={HIDDEN_BY_THE_SCRUB_RULE}
          slots={{ rule: name }}
        />
      </span>
    );
  }

  const sentence: string =
    translator.translateText(HIDDEN_BY_A_SCRUB_RULE) || HIDDEN_BY_A_SCRUB_RULE;

  if (route) {
    return (
      <AppLink className="underline" to={route} dataTestId={dataTestId}>
        {sentence}
      </AppLink>
    );
  }

  return <span data-testid={dataTestId}>{sentence}</span>;
};

/*
 * A field of an event's details as drawn (SecurityEventDetailFields): what
 * the event's source wrote, as written; a sentence of OneUptime's in the
 * reader's language; and in an address's place, which scrub rule hid it,
 * linked to the rules. The event's drawer and Check a log line draw them
 * alike.
 */
export function readFieldValue(
  field: SecurityEventDetailField,
  translator: Translator,
): ReactElement | string {
  if (field.hiddenAddress) {
    return (
      <HiddenClientAddressText
        hidden={field.hiddenAddress}
        dataTestId={
          field.hiddenAddressRole === ScrubbedAddressRole.Target
            ? HIDDEN_TARGET_ADDRESS_TEST_ID
            : HIDDEN_CLIENT_ADDRESS_TEST_ID
        }
      />
    );
  }

  /*
   * An address the request only claimed (#10416): the address, or that a
   * scrub rule hid it, and always that it is claimed, not verified.
   */
  if (field.claimedAddress) {
    const value: string = field.isValueTranslated
      ? translator.translateText(field.value) || field.value
      : field.value;

    return (
      <span data-testid={CLAIMED_CLIENT_ADDRESS_TEST_ID}>
        <span className="[overflow-wrap:anywhere]">{value}</span>
        <span className="text-gray-500">
          {" · "}
          {translator.translateText(CLAIMED_NOT_VERIFIED) ||
            CLAIMED_NOT_VERIFIED}
        </span>
      </span>
    );
  }

  return field.isValueTranslated
    ? translator.translateText(field.value) || field.value
    : field.value;
}

export default HiddenClientAddressText;
