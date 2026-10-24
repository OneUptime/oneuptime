import {
  AddressNotSetUpFacts,
  AddressNotSetUpKind,
  PASS_HOST_HEADER_LINES,
  SentencePiece,
  markedValues,
  sentencePieces,
} from "../../Utils/AddressNotSetUp";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Clipboard from "Common/UI/Utils/Clipboard";
import useClipboardCopy, {
  ClipboardCopy,
} from "Common/UI/Utils/UseClipboardCopy";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useId,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The page a status page address shows when nothing is set up there
 * (Utils/AddressNotSetUp.ts): in place of the bare "Status Page ID not
 * found" that used to greet a newcomer who opened their new OneUptime at
 * the server's IP address while HOST was still localhost.
 *
 * It says what was opened and where OneUptime opens - the two addresses
 * drawn apart from the words around them - then what to do: the HOST line
 * and the command that applies it (or the proxy setting that passes the
 * host name on), and, for an address that can be a domain, how a status
 * page's custom domain gets there. Every line to type is drawn whole, however
 * long, with its own Copy button. Nothing on it reaches the API; every word
 * is the status page app's locale.
 */

export interface ComponentProps {
  facts: AddressNotSetUpFacts;
}

const SECTION_CLASS_NAME: string = "px-5 py-5 sm:px-6";
const HEADING_CLASS_NAME: string = "text-sm font-semibold text-gray-900";
const TEXT_CLASS_NAME: string = "text-pretty text-sm leading-6 text-gray-600";
// An address inside a sentence: darker and heavier than the words around it.
const VALUE_CLASS_NAME: string = "break-words font-medium text-gray-900";

// The values the page's sentences name.
const VALUE_NAMES: ReadonlyArray<string> = ["visited", "configured"];

// Where a line too long for its box may break: after these characters.
const LINE_BREAK_AFTER: ReadonlyArray<string> = [".", "-", "=", ":", "/"];

/*
 * A line, with a place to break after each dot, dash, equals sign, colon
 * and slash, so a long host name wraps between its parts
 * ("HOST=monitoring." / "example.com") rather than inside a word. The
 * breaks are <wbr>: nothing is added to what is selected or copied.
 */
const withLineBreaks: (value: string) => Array<ReactElement> = (
  value: string,
): Array<ReactElement> => {
  const pieces: Array<ReactElement> = [];
  let piece: string = "";

  for (const character of value) {
    piece += character;

    if (LINE_BREAK_AFTER.includes(character)) {
      pieces.push(
        <React.Fragment key={pieces.length}>
          {piece}
          <wbr />
        </React.Fragment>,
      );
      piece = "";
    }
  }

  if (piece) {
    pieces.push(<React.Fragment key={pieces.length}>{piece}</React.Fragment>);
  }

  return pieces;
};

/*
 * A line to type - a setting, a command - drawn whole (a long one wraps
 * rather than hiding its end), with a Copy button. The button says "Copied!"
 * only once the line is on the clipboard; when the browser refuses (a page
 * on plain http often is refused), the line is selected and the page says
 * so under it, to copy it by hand. A click on the line selects all of it.
 */
export const CommandLine: FunctionComponent<{
  value: string;
  testId: string;
}> = (props: { value: string; testId: string }): ReactElement => {
  const { t } = useTranslation();
  const clipboard: ClipboardCopy = useClipboardCopy({ failedForMs: null });
  const lineRef: MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  const lineId: string = useId();

  const copy: () => Promise<void> = async (): Promise<void> => {
    const hasCopied: boolean = await clipboard.copy(props.value);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(lineRef.current);
    }
  };

  return (
    <div>
      <div
        dir="ltr"
        className="mt-2 flex items-start gap-2 rounded-lg bg-gray-50 py-1.5 pl-3 pr-1.5 ring-1 ring-inset ring-gray-200"
      >
        <code
          id={lineId}
          ref={lineRef}
          className="min-w-0 flex-1 select-all break-words py-1 text-left font-mono text-[13px] leading-5 text-gray-900"
          data-testid={props.testId}
        >
          {withLineBreaks(props.value)}
        </code>
        <button
          type="button"
          className="inline-flex flex-none items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 text-xs font-medium leading-4 text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          aria-describedby={lineId}
          data-testid={`${props.testId}-copy`}
          data-copy-state={clipboard.status}
          onClick={() => {
            void copy();
          }}
        >
          <Icon
            icon={clipboard.isCopied ? IconProp.Check : IconProp.Copy}
            className={`h-3.5 w-3.5 flex-none ${clipboard.isCopied ? "text-green-600" : "text-gray-400"}`}
          />
          {/* A phone shows the icon alone, leaving the line the room. */}
          <span className="max-sm:sr-only">
            {clipboard.isCopied
              ? t("errors.addressNotSetUp.copied")
              : t("errors.addressNotSetUp.copy")}
          </span>
        </button>
      </div>
      {/* What the copy did, told to a screen reader as it happens. */}
      <div role="status" data-testid={`${props.testId}-copy-status`}>
        {clipboard.isCopied ? (
          <span className="sr-only">{t("errors.addressNotSetUp.copied")}</span>
        ) : (
          <></>
        )}
        {clipboard.isFailed ? (
          <div
            className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-700"
            data-testid={`${props.testId}-copy-failed`}
          >
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-3.5 w-3.5 flex-none"
            />
            <span className="min-w-0 text-pretty">
              {t("errors.addressNotSetUp.copyFailed")}
            </span>
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

const AddressNotSetUp: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t, i18n } = useTranslation();
  /*
   * Right to left in Persian, as the language reads; the lines to copy and
   * the commands stay left to right (dir="ltr" on each).
   */
  const direction: string =
    i18n && typeof i18n.dir === "function" ? i18n.dir() : "ltr";
  const facts: AddressNotSetUpFacts = props.facts;
  const values: Record<string, string> = {
    visited: facts.visitedHost,
    configured: facts.configuredHost,
  };

  // A sentence of the page, its addresses drawn apart from its words.
  const sentence: (key: string) => ReactElement = (
    key: string,
  ): ReactElement => {
    return (
      <>
        {sentencePieces(t(key, markedValues(VALUE_NAMES)), VALUE_NAMES).map(
          (piece: SentencePiece, index: number): ReactElement => {
            if (piece.value) {
              return (
                <span
                  key={index}
                  className={VALUE_CLASS_NAME}
                  data-testid={`address-not-set-up-${piece.value}`}
                >
                  {values[piece.value]}
                </span>
              );
            }

            return <React.Fragment key={index}>{piece.text}</React.Fragment>;
          },
        )}
      </>
    );
  };

  let titleKey: string = "errors.addressNotSetUp.noPageTitle";
  let descriptionKey: string = "errors.addressNotSetUp.noPageDescription";

  if (facts.kind === AddressNotSetUpKind.NotHost) {
    titleKey = "errors.addressNotSetUp.title";
    descriptionKey = "errors.addressNotSetUp.description";
  }

  if (facts.kind === AddressNotSetUpKind.ProxyRewroteHost) {
    titleKey = "errors.addressNotSetUp.proxyTitle";
    descriptionKey = "errors.addressNotSetUp.proxyDescription";
  }

  const title: string = t(titleKey);

  // The browser's tab says it too, not the "Status Page" it was served as.
  useEffect(() => {
    const titleBefore: string = document.title;

    document.title = title;

    return () => {
      document.title = titleBefore;
    };
  }, [title]);

  const sections: Array<ReactElement> = [];

  if (facts.kind === AddressNotSetUpKind.NotHost) {
    sections.push(
      <section
        key="host"
        className={SECTION_CLASS_NAME}
        aria-labelledby="address-not-set-up-host-heading"
        data-testid="address-not-set-up-host"
      >
        <h2 id="address-not-set-up-host-heading" className={HEADING_CLASS_NAME}>
          {t("errors.addressNotSetUp.hostHeading")}
        </h2>
        <ol className="mt-3 space-y-4">
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600"
            >
              1
            </span>
            <div className="min-w-0 flex-1">
              <p className={TEXT_CLASS_NAME}>
                {t("errors.addressNotSetUp.hostStep")}
              </p>
              <CommandLine
                value={facts.hostLine}
                testId="address-not-set-up-host-line"
              />
            </div>
          </li>
          <li className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600"
            >
              2
            </span>
            <div className="min-w-0 flex-1">
              <p className={TEXT_CLASS_NAME}>
                {t("errors.addressNotSetUp.restartStep")}
              </p>
              <CommandLine
                value="npm start"
                testId="address-not-set-up-restart"
              />
            </div>
          </li>
        </ol>
        <p className="mt-4 text-pretty text-xs leading-5 text-gray-500">
          {t("errors.addressNotSetUp.helm")}
        </p>
      </section>,
    );
  }

  if (facts.kind === AddressNotSetUpKind.ProxyRewroteHost) {
    sections.push(
      <section
        key="proxy"
        className={SECTION_CLASS_NAME}
        aria-labelledby="address-not-set-up-proxy-heading"
        data-testid="address-not-set-up-proxy"
      >
        <h2
          id="address-not-set-up-proxy-heading"
          className={HEADING_CLASS_NAME}
        >
          {t("errors.addressNotSetUp.proxyHeading")}
        </h2>
        <p className={`mt-1 ${TEXT_CLASS_NAME}`}>
          {t("errors.addressNotSetUp.proxySteps")}
        </p>
        {PASS_HOST_HEADER_LINES.map(
          (entry: { proxy: string; line: string }): ReactElement => {
            return (
              <div key={entry.proxy} className="mt-3">
                <div className="text-xs font-medium text-gray-500">
                  {entry.proxy}
                </div>
                <CommandLine
                  value={entry.line}
                  testId={`address-not-set-up-proxy-${entry.proxy.toLowerCase()}`}
                />
              </div>
            );
          },
        )}
      </section>,
    );
  }

  if (facts.canBeStatusPageDomain) {
    const domainSection: ReactElement = (
      <section
        key="domain"
        className={SECTION_CLASS_NAME}
        aria-labelledby="address-not-set-up-domain-heading"
        data-testid="address-not-set-up-domain"
      >
        <h2
          id="address-not-set-up-domain-heading"
          className={HEADING_CLASS_NAME}
        >
          {t("errors.addressNotSetUp.domainHeading")}
        </h2>
        <p className={`mt-1 ${TEXT_CLASS_NAME}`}>
          {t("errors.addressNotSetUp.domainSteps")}
        </p>
      </section>
    );

    // First when it is the likelier reason the address is here.
    if (facts.isStatusPageDomainLikelier) {
      sections.unshift(domainSection);
    } else {
      sections.push(domainSection);
    }
  }

  return (
    <main
      dir={direction}
      className="flex min-h-screen items-center justify-center px-4 py-12 sm:px-6"
      data-testid="status-page-address-not-set-up"
    >
      <div className="w-full max-w-lg">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <Icon icon={IconProp.Globe} className="h-6 w-6" />
          </div>
          <h1 className="mt-5 text-balance text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
            {title}
          </h1>
          <p
            className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-gray-600"
            data-testid="address-not-set-up-description"
          >
            {sentence(descriptionKey)}
          </p>
          {facts.kind === AddressNotSetUpKind.NotHost && facts.configuredUrl ? (
            <a
              href={facts.configuredUrl}
              className="mt-3 inline-block max-w-full break-words rounded-sm text-sm font-medium leading-6 text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              data-testid="address-not-set-up-open-configured"
            >
              {t("errors.addressNotSetUp.openConfigured", values)}
              {/*
               * In the line, so it stays by the last word when the link
               * wraps, and pointing the way the language reads: left in
               * Persian.
               */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="ms-0.5 inline-block h-4 w-4 align-[-0.2em] rtl:rotate-180"
                data-testid="address-not-set-up-open-configured-chevron"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </a>
          ) : (
            <></>
          )}
        </div>
        {sections.length > 0 ? (
          <div className="mt-8 divide-y divide-gray-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-gray-200">
            {sections}
          </div>
        ) : (
          <></>
        )}
      </div>
    </main>
  );
};

export default AddressNotSetUp;
