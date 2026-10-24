import {
  AddressNotSetUpFacts,
  AddressNotSetUpKind,
  PASS_HOST_HEADER_LINES,
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
  useRef,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * The page a status page address shows when nothing is set up there
 * (Utils/AddressNotSetUp.ts): in place of the bare "Status Page ID not
 * found" that used to greet a newcomer who opened their new OneUptime at
 * the server's IP address while HOST was still localhost.
 *
 * It says what was opened and where OneUptime opens, then what to do: the
 * HOST line to copy and the command that applies it (or the proxy setting
 * that passes the host name on), and, for an address that can be a domain,
 * how a status page's custom domain gets there. Nothing on it reaches the
 * API; every word is the status page app's locale.
 */

export interface ComponentProps {
  facts: AddressNotSetUpFacts;
}

const SECTION_CLASS_NAME: string = "px-5 py-5 sm:px-6";
const HEADING_CLASS_NAME: string = "text-sm font-semibold text-gray-900";
const TEXT_CLASS_NAME: string = "text-pretty text-sm leading-6 text-gray-600";

// A line of configuration or a command, as written, with no copy button.
const CodeLine: FunctionComponent<{ value: string; testId: string }> = (props: {
  value: string;
  testId: string;
}): ReactElement => {
  return (
    <code
      dir="ltr"
      className="mt-2 block overflow-x-auto whitespace-pre rounded-md bg-gray-50 px-3 py-2 text-left font-mono text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
      data-testid={props.testId}
    >
      {props.value}
    </code>
  );
};

/*
 * The HOST line, ready to copy. The copy says "Copied!" only once the line
 * is on the clipboard; when the browser refuses (a page on plain http often
 * is refused), it says so and selects the line, to copy by hand.
 */
const CopyableLine: FunctionComponent<{ value: string }> = (props: {
  value: string;
}): ReactElement => {
  const { t } = useTranslation();
  const clipboard: ClipboardCopy = useClipboardCopy({ failedForMs: null });
  const lineRef: MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  const copy: () => Promise<void> = async (): Promise<void> => {
    const hasCopied: boolean = await clipboard.copy(props.value);

    if (!hasCopied) {
      Clipboard.selectForManualCopy(lineRef.current);
    }
  };

  return (
    <div>
      <div dir="ltr" className="mt-2 flex min-w-0 rounded-md shadow-sm">
        <input
          ref={lineRef}
          type="text"
          readOnly={true}
          value={props.value}
          aria-label={t("errors.addressNotSetUp.hostStep")}
          className="block min-w-0 flex-1 rounded-l-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          data-testid="address-not-set-up-host-line"
          onFocus={(event: React.FocusEvent<HTMLInputElement>) => {
            event.target.select();
          }}
        />
        <button
          type="button"
          className="-ml-px inline-flex flex-none items-center gap-1.5 rounded-r-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid="address-not-set-up-copy"
          onClick={() => {
            void copy();
          }}
        >
          <Icon
            icon={clipboard.isCopied ? IconProp.Check : IconProp.Copy}
            className={`h-4 w-4 ${clipboard.isCopied ? "text-green-600" : "text-gray-400"}`}
          />
          <span aria-live="polite">
            {clipboard.isCopied
              ? t("errors.addressNotSetUp.copied")
              : t("errors.addressNotSetUp.copy")}
          </span>
        </button>
      </div>
      <div role="status" data-testid="address-not-set-up-copy-status">
        {clipboard.isFailed ? (
          <div
            className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-amber-700"
            data-testid="address-not-set-up-copy-failed"
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
  const values: { visited: string; configured: string } = {
    visited: facts.visitedHost,
    configured: facts.configuredHost,
  };

  let title: string = t("errors.addressNotSetUp.noPageTitle");
  let description: string = t(
    "errors.addressNotSetUp.noPageDescription",
    values,
  );

  if (facts.kind === AddressNotSetUpKind.NotHost) {
    title = t("errors.addressNotSetUp.title");
    description = t("errors.addressNotSetUp.description", values);
  }

  if (facts.kind === AddressNotSetUpKind.ProxyRewroteHost) {
    title = t("errors.addressNotSetUp.proxyTitle");
    description = t("errors.addressNotSetUp.proxyDescription", values);
  }

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
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
              1
            </span>
            <div className="min-w-0 flex-1">
              <p className={TEXT_CLASS_NAME}>
                {t("errors.addressNotSetUp.hostStep")}
              </p>
              <CopyableLine value={facts.hostLine} />
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-600">
              2
            </span>
            <div className="min-w-0 flex-1">
              <p className={TEXT_CLASS_NAME}>
                {t("errors.addressNotSetUp.restartStep")}
              </p>
              <CodeLine value="npm start" testId="address-not-set-up-restart" />
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
                <CodeLine
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
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-6 text-gray-600">
            {description}
          </p>
          {facts.kind === AddressNotSetUpKind.NotHost && facts.configuredUrl ? (
            <a
              href={facts.configuredUrl}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              data-testid="address-not-set-up-open-configured"
            >
              {t("errors.addressNotSetUp.openConfigured", values)}
              <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
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
