import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS,
  AttributeKeyVerdict,
  AttributeValueAnswer,
  forgetAttributeValues,
  getTypedAttributeKey,
  judgeTypedAttributeKey,
  lookUpAttributeValues,
  onAttributeValueAnswers,
  readAnswer,
  toAnswerKey,
} from "./AttributeValueSuggestions";
import { TelemetryLoadError } from "./TelemetryLoadError";

/*
 * The values a search bar offers under `@key:` (issue #4708): asked for once
 * the reader pauses, only for a key the project has, once per key and window
 * (AttributeValueSuggestions.ts has the rules and the cache). Every explorer
 * with a `@key:` picker - logs, traces, exceptions, metrics, security events
 * - reads its suggestions through this hook.
 */
export interface UseAttributeValueSuggestionsOptions {
  // The whole text of the search bar.
  searchText: string;
  // The project's attribute keys, as the explorer loaded them.
  attributeKeys: ReadonlyArray<string>;
  isAttributeKeysLoading: boolean;
  hasAttributeKeysFailed: boolean;
  /*
   * Keys the bar reads as something other than an attribute (a field typed
   * with `@`): never looked up.
   */
  ignoreKey?: ((key: string) => boolean) | undefined;
  /*
   * Everything besides the key that decides the answer - the signal, the
   * project, the window, a metric. Answers are kept per scope and key.
   */
  scope: string;
  // Asks the server for one key's values.
  fetchValues: (attributeKey: string) => Promise<Array<string>>;
  pauseInMs?: number | undefined;
}

export interface AttributeValueSuggestionsState {
  // The key whose values the bar is showing, if any.
  typedKey: string | null;
  // `{ [typedKey]: values }` once they are here, else empty.
  valueSuggestions: Record<string, Array<string>>;
  // The typed key's values are on their way (or will be, after the pause).
  isLoading: boolean;
  // The typed key's values could not be loaded.
  error: TelemetryLoadError | undefined;
  /*
   * The typed key's values came back, and there were none: the bar says so
   * rather than closing its dropdown without a word.
   */
  hasNoValues: boolean;
  // Asks for the typed key's values again, now.
  retry: () => void;
}

const NO_VALUES: Record<string, Array<string>> = {};

export default function useAttributeValueSuggestions(
  options: UseAttributeValueSuggestionsOptions,
): AttributeValueSuggestionsState {
  const pauseInMs: number =
    options.pauseInMs ?? ATTRIBUTE_VALUE_LOOKUP_PAUSE_IN_MS;

  const [, setVersion] = useState<number>(0);

  // The newest fetcher, without restarting a pause each time it changes.
  const fetchValuesRef: MutableRefObject<
    (attributeKey: string) => Promise<Array<string>>
  > = useRef(options.fetchValues);
  fetchValuesRef.current = options.fetchValues;

  useEffect(() => {
    return onAttributeValueAnswers((): void => {
      setVersion((version: number): number => {
        return version + 1;
      });
    });
  }, []);

  const typedKey: string | null = getTypedAttributeKey(options.searchText);

  const verdict: AttributeKeyVerdict | null =
    typedKey === null || options.ignoreKey?.(typedKey)
      ? null
      : judgeTypedAttributeKey(typedKey, {
          keys: options.attributeKeys,
          isLoading: options.isAttributeKeysLoading,
          hasFailed: options.hasAttributeKeysFailed,
        });

  const answerKey: string | null =
    verdict === AttributeKeyVerdict.LookUp && typedKey !== null
      ? toAnswerKey(options.scope, typedKey)
      : null;

  const answer: AttributeValueAnswer | undefined = answerKey
    ? readAnswer(answerKey)
    : undefined;

  const hasAnswer: boolean = Boolean(answer);

  /*
   * A key with no answer yet is asked about once the reader has left it
   * alone for the pause. Typing on - a longer key, another key - cancels
   * the wait, so the keys typed on the way are never asked about.
   */
  useEffect(() => {
    if (!answerKey || typedKey === null || hasAnswer) {
      return undefined;
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      void lookUpAttributeValues(answerKey, (): Promise<Array<string>> => {
        return fetchValuesRef.current(typedKey);
      });
    }, pauseInMs);

    return (): void => {
      clearTimeout(timer);
    };
  }, [answerKey, typedKey, hasAnswer, pauseInMs]);

  const retry: () => void = useCallback((): void => {
    if (!answerKey || typedKey === null) {
      return;
    }

    forgetAttributeValues(answerKey);
    void lookUpAttributeValues(answerKey, (): Promise<Array<string>> => {
      return fetchValuesRef.current(typedKey);
    });
  }, [answerKey, typedKey]);

  const loadedValues: Array<string> | undefined =
    answer && answer.kind === "loaded" ? answer.values : undefined;

  const valueSuggestions: Record<string, Array<string>> = useMemo(() => {
    if (!loadedValues || typedKey === null) {
      return NO_VALUES;
    }

    return { [typedKey]: loadedValues };
  }, [typedKey, loadedValues]);

  return {
    typedKey: verdict === null ? null : typedKey,
    valueSuggestions: valueSuggestions,
    isLoading:
      verdict === AttributeKeyVerdict.WaitForKeyList ||
      (verdict === AttributeKeyVerdict.LookUp &&
        (!answer || answer.kind === "loading")),
    error: answer && answer.kind === "failed" ? answer.error : undefined,
    hasNoValues: Boolean(loadedValues && loadedValues.length === 0),
    retry: retry,
  };
}
