import React, { FunctionComponent, ReactElement } from "react";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Protocol from "Common/Types/API/Protocol";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Tabs from "Common/UI/Components/Tabs/Tabs";

/*
 * SessionReplayInstallSnippet: the ONE install snippet.
 *
 * The setup guide, the installation test and the docs used to each print
 * their own copy of the script tag, and they had drifted (one carried a
 * data-oneuptime-host the recorder derives from its own src anyway, the
 * docs carried crossorigin, and the CSP block was a complete directive
 * pair that would have replaced a customer's 'self'). Everything below is
 * generated from the same builders so the three surfaces cannot disagree
 * again, and the builders are exported so a test can pin the exact text.
 */

/*
 * The identifier is interpolated into an HTML attribute the customer will
 * copy-paste into their own page, and it originates from whatever
 * service.name arrived on telemetry - attacker-writable with a scraped
 * ingestion key. Anything outside this closed charset is not interpolated.
 */
export const SAFE_APP_IDENTIFIER: RegExp = new RegExp(
  "^[A-Za-z0-9._-]{1,100}$",
);

export const APP_IDENTIFIER_PLACEHOLDER: string = "YOUR_APP_IDENTIFIER";
export const TOKEN_PLACEHOLDER: string = "YOUR_TELEMETRY_INGESTION_KEY";
export const ONEUPTIME_URL_PLACEHOLDER: string = "<YOUR_ONEUPTIME_URL>";

export const RECORDER_SCRIPT_PATH: string =
  "/telemetry/session-replay/v1/recorder.js";

export type InstallSnippetFramework = "html" | "nextjs" | "gtm";

export const INSTALL_SNIPPET_TAB_NAMES: Record<
  InstallSnippetFramework,
  string
> = {
  html: "HTML",
  nextjs: "Next.js / React",
  gtm: "Google Tag Manager",
};

/* The identifier as it may appear in a snippet: itself, or the placeholder. */
export function getSafeAppIdentifier(appIdentifier: string): string {
  return SAFE_APP_IDENTIFIER.test(appIdentifier)
    ? appIdentifier
    : APP_IDENTIFIER_PLACEHOLDER;
}

/* This deployment's public origin, from the Dashboard's own config. */
export function getOneUptimeUrl(): string {
  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";

  return HOST ? `${httpProtocol}://${HOST}` : ONEUPTIME_URL_PLACEHOLDER;
}

/*
 * No data-oneuptime-host: the recorder derives its host from the script's
 * own src (Config.readHostFromScriptSrc), and the docs never carried the
 * attribute. crossorigin="anonymous" gives window.onerror a real message
 * for a recorder error instead of "Script error." and costs nothing.
 */
export function buildScriptTagSnippet(
  oneuptimeUrl: string,
  appIdentifier: string,
): string {
  return `<script
  src="${oneuptimeUrl}${RECORDER_SCRIPT_PATH}"
  data-oneuptime-token="${TOKEN_PLACEHOLDER}"
  data-oneuptime-app-identifier="${getSafeAppIdentifier(appIdentifier)}"
  crossorigin="anonymous"
  async
></script>`;
}

/*
 * next/script with afterInteractive: the loader is small and does its own
 * async policy fetch, so it must not block hydration, and it must run on
 * every route, which is why it belongs in the root layout.
 */
export function buildNextJsSnippet(
  oneuptimeUrl: string,
  appIdentifier: string,
): string {
  return `// app/layout.tsx (App Router) - or pages/_app.tsx (Pages Router)
import Script from "next/script";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="${oneuptimeUrl}${RECORDER_SCRIPT_PATH}"
          data-oneuptime-token="${TOKEN_PLACEHOLDER}"
          data-oneuptime-app-identifier="${getSafeAppIdentifier(appIdentifier)}"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}`;
}

/*
 * GTM's Custom HTML tag runs the tag's inline script, so the loader is
 * injected by hand; the data attributes are set on the element before it
 * is appended because Config reads them off the injected script tag.
 */
export function buildGtmSnippet(
  oneuptimeUrl: string,
  appIdentifier: string,
): string {
  return `<!-- Tag type: Custom HTML. Trigger: All Pages. -->
<script>
  (function () {
    var s = document.createElement("script");
    s.src = "${oneuptimeUrl}${RECORDER_SCRIPT_PATH}";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-oneuptime-token", "${TOKEN_PLACEHOLDER}");
    s.setAttribute("data-oneuptime-app-identifier", "${getSafeAppIdentifier(appIdentifier)}");
    document.head.appendChild(s);
  })();
</script>`;
}

export function buildInstallSnippet(
  framework: InstallSnippetFramework,
  oneuptimeUrl: string,
  appIdentifier: string,
): string {
  if (framework === "nextjs") {
    return buildNextJsSnippet(oneuptimeUrl, appIdentifier);
  }

  if (framework === "gtm") {
    return buildGtmSnippet(oneuptimeUrl, appIdentifier);
  }

  return buildScriptTagSnippet(oneuptimeUrl, appIdentifier);
}

/*
 * The command queue form works before the recorder has loaded, which is
 * the common case for an identify() call fired from a login handler.
 */
export function buildIdentifySnippet(): string {
  return `// Once you know who the visitor is. Traits are optional and are masked
// by the application's masking mode before they leave the browser.
window.OneUptimeReplay
  ? OneUptimeReplay.identify("user-123", { plan: "pro" })
  : (window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push(
      ["identify", "user-123", { plan: "pro" }],
    );`;
}

/*
 * OPTIONAL, and only for telemetry the page produces itself. Backend
 * telemetry needs no code: the recorder carries the session id on the
 * page's same-origin requests (tracestate) and ingest stamps it. What that
 * cannot reach is the page's own OpenTelemetry browser SDK - document
 * loads, route changes, reported errors - so this stamps those spans.
 *
 * A span processor rather than a write to resource.attributes: the
 * resource is serialised when a batch is exported, so a mutated resource
 * re-labels spans that started before a rotation, and writing into it
 * relies on the object OpenTelemetry JS 2.x happens to memoise behind its
 * `attributes` getter. onStart stamps each span with the id current when
 * it began. Queued, so it works whether or not the recorder has loaded
 * yet (the queue stays live after the drain).
 */
export function buildOnSessionChangeSnippet(): string {
  return `// Optional. Only if this page also runs the OpenTelemetry browser SDK:
// stamps its own spans (page loads, route changes, errors) with the
// replay session id. Requests to your own origin are linked without it.
// Fires as soon as the recorder starts - before consent or a trigger - so
// gate on your own consent state if that matters.
let replaySessionId = null;

(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([
  "onSessionChange",
  (sessionId) => {
    replaySessionId = sessionId;
  },
]);

// Add to the spanProcessors of your WebTracerProvider.
const replaySessionSpanProcessor = {
  onStart: (span) => {
    if (replaySessionId) {
      span.setAttribute("session.id", replaySessionId);
    }
  },
  onEnd: () => {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};`;
}

/*
 * ADD to the existing directives, never replace them. The previous block
 * printed "script-src <origin>;" on its own, and a developer who pasted it
 * over "script-src 'self'" locked their own scripts out of their page.
 */
export function buildCspSnippet(oneuptimeUrl: string): string {
  return `script-src  'self' ${oneuptimeUrl};
connect-src 'self' ${oneuptimeUrl};`;
}

export interface ComponentProps {
  /* Raw identifier; the safe-charset guard is applied here. */
  appIdentifier: string;
  /* Defaults to this deployment's origin. */
  oneuptimeUrl?: string | undefined;
  showIdentify?: boolean | undefined;
}

const SessionReplayInstallSnippet: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const oneuptimeUrl: string = props.oneuptimeUrl ?? getOneUptimeUrl();
  const frameworks: Array<InstallSnippetFramework> = ["html", "nextjs", "gtm"];

  return (
    <div data-testid="install-snippet">
      <Tabs
        onTabChange={(): void => {
          /* The tab is presentational; nothing else depends on it. */
        }}
        tabs={frameworks.map(
          (
            framework: InstallSnippetFramework,
          ): { name: string; children: ReactElement } => {
            return {
              name: INSTALL_SNIPPET_TAB_NAMES[framework],
              children: (
                <div
                  className="mt-3"
                  data-testid={`install-snippet-${framework}`}
                >
                  <CodeBlock
                    code={buildInstallSnippet(
                      framework,
                      oneuptimeUrl,
                      props.appIdentifier,
                    )}
                    language={framework === "nextjs" ? "javascript" : "xml"}
                  />
                </div>
              ),
            };
          },
        )}
      />

      <p className="mt-2 text-xs text-gray-500">
        <code>data-oneuptime-app-identifier</code> must match this
        application&apos;s identifier (the same value you use for{" "}
        <code>service.name</code>). The token is an ingestion key: it sits in
        your page&apos;s JavaScript, grants ingestion only, and cannot read
        anything back out of your project.
      </p>

      {props.showIdentify !== false && (
        <div className="mt-4" data-testid="install-snippet-identify">
          <div className="text-xs font-semibold text-gray-700">
            Identify your users
          </div>
          <p className="mb-2 mt-1 text-xs text-gray-500">
            Recordings are pseudonymous until your page says who the visitor is.
            Without this call, sessions from the same browser are still grouped
            under an anonymous visitor id the recorder mints itself, but nobody
            is named. <code>identify()</code> is what groups sessions by person,
            makes <code>user:</code> search work in the list, and attaches the
            traits to the session.
          </p>
          <CodeBlock code={buildIdentifySnippet()} language="javascript" />
        </div>
      )}
    </div>
  );
};

export default SessionReplayInstallSnippet;
