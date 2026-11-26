import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { HashedAddressSignal } from "Common/Types/Telemetry/HashedAddressSearch";
import {
  askHashedAddressSearch,
  getHashedAddressSearchQuestion,
} from "./HashedAddressSearch";

/*
 * The addresses a search also matched by their hash token, for its note:
 * empty until the server answers, and whenever it named none (#10418).
 *
 * The question, the route and the answer are HashedAddressSearch's, which
 * stays free of React so the App's tests - which run with no React
 * installed - load it as the explorers do.
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
