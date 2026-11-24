import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import {
  DocsLinkSource,
  recordDocsLinkOpened,
} from "Common/UI/Utils/DocsLinkEvents";
import { DocsSearchHit, searchDocs } from "Common/UI/Utils/DocsSearch";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FormEvent,
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

/*
 * WHEN ASK AI CANNOT ANSWER, THE DOCS STILL CAN (#7063).
 *
 * Ask AI cannot answer when the project's plan leaves AI out, when AI is
 * switched off for the project, when no LLM provider is set up, when a
 * daily limit or the AI credits are used up, and when the provider fails.
 * Each of those said why - and that was all: a person who asked "how do I
 * get a text when my site is down?" got a settings page they may not be
 * allowed to open. Now the question is also looked up in the docs, with the
 * same search the docs' own search box and Search (Cmd/Ctrl+K) ask
 * (Common/UI/Utils/DocsSearch): the installation's own docs, in the
 * reader's language, an air-gapped one too. Each result opens its page in
 * a new tab, so what the person was doing stays where it was.
 *
 * Two ways it is drawn: in Ask AI's place when it is unavailable, with a
 * box to type the question in (there is no composer then); and under an
 * answer or a question Ask AI could not answer, its first few results
 * only, and nothing when no page matches - the reason above it is said
 * already.
 */

// The longest question the docs are searched with.
export const MAX_DOCS_QUESTION_CHARS: number = 200;

// How many docs results each way shows.
export const DOCS_RESULTS_IN_PLACE_OF_ASK_AI: number = 5;
export const DOCS_RESULTS_UNDER_AN_ANSWER: number = 3;

// The words the docs are searched with: the question, on one line, cut short.
export const toDocsQuestion: (question: string) => string = (
  question: string,
): string => {
  return question.replace(/\s+/g, " ").trim().slice(0, MAX_DOCS_QUESTION_CHARS);
};

export interface ComponentProps {
  // What the person asked, or "" for nothing yet.
  question: string;
  /*
   * In Ask AI's place: a heading of its own, a box to type the question
   * in, and a line when no page matches.
   */
  isInPlaceOfAskAi?: boolean | undefined;
  // Where it sits apart from what is around it: a card's frame, a margin.
  className?: string | undefined;
}

const AskAiDocsResults: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const headingId: string = useId();
  const isInPlace: boolean = Boolean(props.isInPlaceOfAskAi);
  const limit: number = isInPlace
    ? DOCS_RESULTS_IN_PLACE_OF_ASK_AI
    : DOCS_RESULTS_UNDER_AN_ANSWER;

  // What the box holds, and what was last searched for.
  const [draft, setDraft] = useState<string>(props.question);
  const [query, setQuery] = useState<string>(toDocsQuestion(props.question));
  const [hits, setHits] = useState<Array<DocsSearchHit>>([]);
  const [searchedFor, setSearchedFor] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // A new question - another answer that failed - is looked up again.
  useEffect(() => {
    setDraft(props.question);
    setQuery(toDocsQuestion(props.question));
  }, [props.question]);

  useEffect(() => {
    if (!query) {
      setHits([]);
      setSearchedFor("");
      setIsSearching(false);
      return;
    }

    let isCurrent: boolean = true;
    setIsSearching(true);

    // Never throws: a search that fails is no results (DocsSearch).
    searchDocs({ query, language: translator.language, limit })
      .then((found: Array<DocsSearchHit>) => {
        if (!isCurrent) {
          return;
        }

        setHits(found);
        setSearchedFor(query);
        setIsSearching(false);
      })
      .catch(() => {
        if (isCurrent) {
          setHits([]);
          setSearchedFor(query);
          setIsSearching(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [query, translator.language, limit]);

  const onSubmit: (event: FormEvent<HTMLFormElement>) => void = (
    event: FormEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    setQuery(toDocsQuestion(draft));
  };

  const hasNoMatch: boolean =
    !isSearching && Boolean(searchedFor) && hits.length === 0;

  // Under an answer, only what helps: nothing while nothing matched.
  if (!isInPlace && (hits.length === 0 || !searchedFor)) {
    return <></>;
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isSearching}
      data-testid="ask-ai-docs-results"
      className={`w-full text-start ${props.className || ""}`}
    >
      <h3
        id={headingId}
        className={`flex items-center gap-1.5 font-semibold text-gray-900 ${
          isInPlace ? "text-sm" : "text-xs"
        }`}
      >
        <Icon icon={IconProp.Book} className="h-4 w-4 text-indigo-600" />
        <span>
          {translator.translateText(
            isInPlace ? "Find it in the docs" : "From the docs",
          )}
        </span>
      </h3>

      {isInPlace ? (
        <form
          role="search"
          onSubmit={onSubmit}
          className="mt-2 flex items-center gap-2"
        >
          <input
            type="search"
            value={draft}
            maxLength={MAX_DOCS_QUESTION_CHARS}
            aria-label={translator.translateText("Search the docs") as string}
            placeholder={translator.translateText("Search the docs") as string}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setDraft(event.target.value);
            }}
            data-testid="ask-ai-docs-search"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="flex-shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {translator.translateText("Search")}
          </button>
        </form>
      ) : (
        <></>
      )}

      {isInPlace && isSearching ? (
        <p role="status" className="mt-3 text-sm text-gray-500">
          {translator.translateText("Searching the docs…")}
        </p>
      ) : (
        <></>
      )}

      {isInPlace && hasNoMatch ? (
        <p
          role="status"
          data-testid="ask-ai-docs-no-match"
          className="mt-3 text-sm text-gray-500"
        >
          {translator.translateText(
            "No docs page matches this. Try other words.",
          )}
        </p>
      ) : (
        <></>
      )}

      {hits.length > 0 ? (
        <ul
          role="list"
          className={`divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 ${
            isInPlace ? "mt-3" : "mt-2"
          }`}
        >
          {hits.map((hit: DocsSearchHit): ReactElement => {
            return (
              <li key={hit.url}>
                <a
                  href={hit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="ask-ai-docs-result"
                  onClick={() => {
                    // Which docs page Ask AI sent the person to, when it could not answer.
                    recordDocsLinkOpened({
                      href: hit.url,
                      source: DocsLinkSource.AskAiUnavailable,
                    });
                  }}
                  className="group flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      dir="auto"
                      className="block truncate text-sm font-medium text-gray-900"
                    >
                      {hit.title}
                    </span>
                    {hit.where ? (
                      <span
                        dir="auto"
                        className="block truncate text-xs text-gray-500"
                      >
                        {hit.where}
                      </span>
                    ) : (
                      <></>
                    )}
                  </span>
                  <Icon
                    icon={IconProp.ExternalLink}
                    className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400 group-hover:text-gray-600"
                  />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}
    </section>
  );
};

export default AskAiDocsResults;
