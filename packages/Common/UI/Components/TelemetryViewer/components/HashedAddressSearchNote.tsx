import React, { FunctionComponent, ReactElement } from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";
import useTranslator from "../../../Utils/UseTranslator";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../../Utils/TranslateTemplate";

/*
 * WHAT A SEARCH FOR AN IP ADDRESS SAYS ABOVE ITS RESULTS, ONCE (#10418).
 *
 * In a project that hashes IP addresses out of its telemetry (an IP Address
 * scrub rule with the Hash action), a search for an address also finds the
 * records whose address was hashed, by the project's token for it
 * (Server/Utils/Telemetry/HashedAddressSearch.ts). Those records show the
 * token, not the address, so the results say why they are there.
 *
 * A token made before tokens were keyed per project (#10394) is 8 hex
 * characters, and different addresses share one, so a search never matches
 * one - it would name someone else's records. The note says so rather than
 * leave a reader to think every record of the address is listed.
 *
 * Drawn only when the server said the search matched an address by its
 * token: never before it answers, and never for a search it did not bind.
 */

export const HASHED_ADDRESS_SEARCH_NOTE_TEST_ID: string =
  "hashed-address-search-note";

// What a token from before #10394 looks like: 8 hex characters.
export const LEGACY_HASH_TOKEN_EXAMPLE: string = "[HASHED:8c87b489]";

// The note: for one address its own words, for several how many.
export const HASHED_ADDRESS_SEARCH_NOTE: PluralTemplate = {
  one: "Includes records where this address was hashed.",
  other: "Includes records where these {{count}} addresses were hashed.",
};

// Why some records of the address may still be missing.
export const LEGACY_HASH_TOKEN_NOTE: string = translationKey(
  "Older records whose token has 8 characters, such as {{example}}, can't be matched to an address.",
);

export interface ComponentProps {
  // The addresses the search also matched by their token, as typed.
  addresses?: Array<string> | undefined;
}

const HashedAddressSearchNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const count: number = props.addresses?.length || 0;

  if (count === 0) {
    return <></>;
  }

  return (
    <div
      role="note"
      data-testid={HASHED_ADDRESS_SEARCH_NOTE_TEST_ID}
      className="flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600"
    >
      <Icon
        icon={IconProp.Fingerprint}
        className="mt-0.5 h-4 w-4 flex-none text-gray-400"
      />
      <p className="min-w-0">
        <span className="font-medium text-gray-700">
          {translator.translatePlural(HASHED_ADDRESS_SEARCH_NOTE, count)}
        </span>{" "}
        {translator.translateTemplate(LEGACY_HASH_TOKEN_NOTE, {
          example: LEGACY_HASH_TOKEN_EXAMPLE,
        })}
      </p>
    </div>
  );
};

export default HashedAddressSearchNote;
