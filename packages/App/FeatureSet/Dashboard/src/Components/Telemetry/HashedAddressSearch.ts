import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  HashedAddressSignal,
  MAX_HASHED_ADDRESS_SEARCH_TEXTS,
  MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH,
} from "Common/Types/Telemetry/HashedAddressSearch";
import ScrubIpAddress from "Common/Utils/Telemetry/ScrubIpAddress";

/*
 * WHETHER A SEARCH'S RESULTS INCLUDE RECORDS WHERE AN ADDRESS IT NAMES WAS
 * HASHED (#10418).
 *
 * In a project that hashes IP addresses out of its telemetry, the server
 * reads a search for an address as "the address, or the project's token
 * for it" (Common/Server/Utils/Telemetry/HashedAddressSearch.ts). Only the
 * server can make a token and knows the project's rules, so an explorer
 * asks it, with the texts its search compares on the fields the server
 * binds (getHashedAddressSearchTexts), and says so above the results when
 * it answers with an address (HashedAddressSearchNote).
 *
 * It asks only when a text holds an address an IP Address rule hides -
 * found by the rule's own function - so a search for anything else, or for
 * a private address, sends nothing. It never claims what the server did not
 * say: no answer yet, a failed answer or a newer search reads as no note.
 */

// The texts worth asking about: those holding an address, each once, as many and as long as one question takes.
export const getHashedAddressSearchQuestion: (
  texts: ReadonlyArray<string>,
) => Array<string> = (texts: ReadonlyArray<string>): Array<string> => {
  const question: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const text of texts) {
    if (
      question.length >= MAX_HASHED_ADDRESS_SEARCH_TEXTS ||
      seen.has(text) ||
      text.length > MAX_HASHED_ADDRESS_SEARCH_TEXT_LENGTH ||
      ScrubIpAddress.findRanges(text).length === 0
    ) {
      continue;
    }

    seen.add(text);
    question.push(text);
  }

  return question;
};

// The route a signal's question goes to.
export const getHashedAddressSearchRoute: (
  signal: HashedAddressSignal,
) => string = (signal: HashedAddressSignal): string => {
  return `/telemetry/${signal}/hashed-address-search`;
};

// The addresses an answer names, as typed: strings only.
export const readHashedAddressSearchAnswer: (
  data: JSONObject | undefined,
) => Array<string> = (data: JSONObject | undefined): Array<string> => {
  const addresses: unknown = data?.["addresses"];

  if (!Array.isArray(addresses)) {
    return [];
  }

  return addresses.filter((address: unknown): address is string => {
    return typeof address === "string" && address.length > 0;
  });
};

// The server's answer: the addresses it named, none when it could not answer.
export const askHashedAddressSearch: (data: {
  signal: HashedAddressSignal;
  texts: Array<string>;
}) => Promise<Array<string>> = async (data: {
  signal: HashedAddressSignal;
  texts: Array<string>;
}): Promise<Array<string>> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        getHashedAddressSearchRoute(data.signal),
      ),
      data: { texts: data.texts },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    return [];
  }

  return readHashedAddressSearchAnswer(response.data);
};

/*
 * The addresses a search also matched by their hash token, for its note:
 * empty until the server answers, and whenever it named none.
 */
const useHashedAddressSearch: (data: {
  signal: HashedAddressSignal;
  texts: ReadonlyArray<string>;
}) => Array<string> = (data: {
  signal: HashedAddressSignal;
  texts: ReadonlyArray<string>;
}): Array<string> => {
  const question: Array<string> = useMemo((): Array<string> => {
    return getHashedAddressSearchQuestion(data.texts);
  }, [JSON.stringify(data.texts)]);

  const questionKey: string = `${data.signal}:${JSON.stringify(question)}`;
  const [answer, setAnswer] = useState<{
    key: string;
    addresses: Array<string>;
  } | null>(null);
  const latestKey: MutableRefObject<string> = useRef<string>(questionKey);

  latestKey.current = questionKey;

  useEffect((): void => {
    if (question.length === 0) {
      return;
    }

    askHashedAddressSearch({ signal: data.signal, texts: question })
      .then((addresses: Array<string>): void => {
        // A newer search's question replaced this one: its answer is not this search's.
        if (latestKey.current === questionKey) {
          setAnswer({ key: questionKey, addresses });
        }
      })
      .catch((): void => {
        if (latestKey.current === questionKey) {
          setAnswer({ key: questionKey, addresses: [] });
        }
      });
  }, [questionKey]);

  if (question.length === 0 || !answer || answer.key !== questionKey) {
    return [];
  }

  return answer.addresses;
};

export default useHashedAddressSearch;
