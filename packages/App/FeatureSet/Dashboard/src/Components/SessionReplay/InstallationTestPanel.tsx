import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { joinSentences } from "Common/UI/Components/DeleteConfirmation/DeleteConsequences";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  DEFAULT_LANGUAGE,
  formatList,
  TemplateValue,
  TemplateValues,
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { RecordingHealthStatus } from "Common/Types/Rum/SessionReplayHealth";
import {
  diagnoseRecordingHealth,
  formatBytesForCopy,
  formatCountForCopy,
  formatRelativeAge,
  parseHealthTimestamp,
} from "Common/Utils/SessionReplay/SessionReplayHealth";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_FAST_MS,
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthError,
  SessionReplayHealthExtras,
  SessionReplayHealthSnapshot,
  describeHealthError,
} from "./useSessionReplayHealth";
import {
  CAPTURE_TRIGGER_LABELS,
  RecordingHealthDiagnosisBanner,
  RecorderDiagnosticsPasteBox,
  labelEnum,
} from "./RecordingHealthCard";
import SessionReplayInstallSnippet, {
  buildCspSnippet,
  getOneUptimeUrl,
} from "./SessionReplayInstallSnippet";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * "Test your installation": the diagnostic the recorder cannot provide for
 * itself, answered from the server's side and refreshed live.
 *
 * Every install failure mode the recorder has is SILENT in the customer's
 * browser by design, and the server cannot see a recorder that never
 * loaded. So this panel lists every switch, stamp, counter and budget the
 * server knows, as pass/fail rows that each link to the setting that
 * changes them, and while no chunk has ever arrived it polls every 10s so
 * the customer can paste the tag, reload their site and watch the row
 * flip - instead of clicking "Run again" against a stamp the server
 * throttles to once a minute.
 *
 * Given a rumApplicationId it tests that application and hides the
 * picker; this is how the application's own Replay Policy page mounts it,
 * so "Run the installation test" from an application's empty list lands
 * on THAT application.
 */

export const INSTALLATION_TEST_QUERY_PARAM: string = "rumApplicationId";

/*
 * What the rows and the cadence line say without a translator: English,
 * word for word, as a unit test reads them. The panel hands its reader's
 * translator in, and every sentence is looked up whole with it.
 */
const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// The page where ingestion keys are made, as the guide's link names it.
const INGESTION_KEYS_PATH: string =
  "Project Settings > Telemetry & APM > Ingestion Keys";

type CheckState = "pass" | "fail" | "warn" | "info" | "waiting";

interface CheckAction {
  label: string;
  to: Route | URL;
  openInNewTab?: boolean | undefined;
}

export interface CheckRow {
  key: string;
  state: CheckState;
  title: string;
  detail: string;
  action?: CheckAction | undefined;
}

function CheckRowView(props: { row: CheckRow }): ReactElement {
  const { row } = props;

  const icon: IconProp =
    row.state === "pass"
      ? IconProp.CheckCircle
      : row.state === "fail"
        ? IconProp.CircleClose
        : row.state === "warn"
          ? IconProp.Alert
          : row.state === "waiting"
            ? IconProp.Spinner
            : IconProp.Info;

  const iconColor: string =
    row.state === "pass"
      ? "text-emerald-600"
      : row.state === "fail"
        ? "text-rose-600"
        : row.state === "warn"
          ? "text-amber-600"
          : row.state === "waiting"
            ? "animate-spin text-indigo-500"
            : "text-gray-400";

  return (
    <div
      className="flex items-start gap-3 py-2"
      data-testid={`install-check-${row.key}`}
      data-state={row.state}
    >
      <Icon icon={icon} className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">{row.title}</div>
        <div className="text-xs text-gray-500">{row.detail}</div>
        {row.action && (
          <Link
            to={row.action.to}
            openInNewTab={row.action.openInNewTab}
            className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800"
          >
            {row.action.label}
          </Link>
        )}
      </div>
    </div>
  );
}

/*
 * The policy row's title: the trigger, the share sampled and, when it is
 * asked for, consent. One whole sentence per trigger, with and without
 * consent, so a language words each its own way ("Uploads always" is not
 * the label "Always" lower-cased). A trigger this page does not know is
 * named as the policy card names it (labelEnum), in the sentence's language.
 */
function describeUploadPolicy(
  policy: RecordingHealthStatus["policy"],
  translator: Translator,
): string {
  const requiresConsent: boolean =
    policy.consentMode === SessionReplayConsentMode.RequireExplicit;
  const values: TemplateValues = {
    percent: translator.formatNumber(policy.samplePercentage),
  };

  if (policy.captureTrigger === SessionReplayCaptureTrigger.Always) {
    return requiresConsent
      ? translator.translateTemplate(
          "Uploads always, sampling {{percent}}%, consent required",
          values,
        )
      : translator.translateTemplate(
          "Uploads always, sampling {{percent}}%",
          values,
        );
  }

  if (
    policy.captureTrigger === SessionReplayCaptureTrigger.OnErrorOrFrustration
  ) {
    return requiresConsent
      ? translator.translateTemplate(
          "Uploads on error or frustration, sampling {{percent}}%, consent required",
          values,
        )
      : translator.translateTemplate(
          "Uploads on error or frustration, sampling {{percent}}%",
          values,
        );
  }

  const withTrigger: TemplateValues = {
    ...values,
    trigger: composedValue((sentence: Translator): string => {
      return labelEnum(CAPTURE_TRIGGER_LABELS, policy.captureTrigger, sentence);
    }),
  };

  return requiresConsent
    ? translator.translateTemplate(
        "Uploads {{trigger}}, sampling {{percent}}%, consent required",
        withTrigger,
      )
    : translator.translateTemplate(
        "Uploads {{trigger}}, sampling {{percent}}%",
        withTrigger,
      );
}

/*
 * "40 consent-required, 3 origin-not-allowed": each count beside the reason
 * word the recorder's own diagnostics use, which stays as written, listed
 * the way the sentence's language lists.
 */
function describeReasonCounts(
  entries: Array<{ reason: string; count: number }>,
): ComposedValue {
  return composedValue((sentence: Translator): string => {
    return formatList(
      entries.map((entry: { reason: string; count: number }): string => {
        return `${formatCountForCopy(entry.count, sentence)} ${entry.reason}`;
      }),
      sentence,
    );
  });
}

/*
 * The rows, as a pure function of the status so every branch is a unit
 * test with a fixed clock (Common/Tests/UI/Rum/RecordingHealthCard.test.tsx).
 * Each title, detail and action is a whole sentence of the Dashboard's
 * locales, looked up with `translator` (the panel's reader's); without one
 * they read in English, word for word.
 */
export function buildInstallationCheckRows(
  status: RecordingHealthStatus,
  extras: SessionReplayHealthExtras,
  nowUnixMs: number,
  rumApplicationId: ObjectID | string,
  translator: Translator = ENGLISH,
): Array<CheckRow> {
  const rows: Array<CheckRow> = [];
  const modelId: ObjectID = new ObjectID(rumApplicationId.toString());

  // A fixed line in the reader's language; a line is a string.
  const translateLine: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  // "5m ago", in the language its sentence is drawn in.
  const ageOf: (fromUnixMs: number) => ComposedValue = (
    fromUnixMs: number,
  ): ComposedValue => {
    return composedValue((sentence: Translator): string => {
      return formatRelativeAge(fromUnixMs, nowUnixMs, sentence);
    });
  };

  const appSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS] as Route,
    { modelId: modelId },
  );
  const projectSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route,
  );
  const ingestionKeysRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
  );

  rows.push({
    key: "project-switch",
    state: status.policy.isProjectEnabled ? "pass" : "fail",
    title: status.policy.isProjectEnabled
      ? translateLine("Session replay is allowed for this project")
      : translateLine("Session replay is switched off for this project"),
    detail: status.policy.isProjectEnabled
      ? translateLine("The project-wide master switch is on.")
      : translateLine(
          "While the master switch is off, every chunk from every application is refused at ingest.",
        ),
    action: status.policy.isProjectEnabled
      ? undefined
      : {
          label: translateLine("Open the project-wide switch"),
          to: projectSettingsRoute,
        },
  });

  rows.push({
    key: "app-switch",
    state: status.policy.isApplicationEnabled ? "pass" : "fail",
    title: status.policy.isApplicationEnabled
      ? translateLine("Recording is enabled for this application")
      : translateLine("Recording is disabled for this application"),
    detail: status.policy.isApplicationEnabled
      ? translateLine("The per-application recording toggle is on.")
      : translateLine(
          "Recorders on this application's pages fetch a disabled policy and record nothing.",
        ),
    action: status.policy.isApplicationEnabled
      ? undefined
      : {
          label: translateLine("Open this application's replay policy"),
          to: appSettingsRoute,
        },
  });

  /*
   * settings-setup-6: two allowlists compose. The ingestion key has its own
   * allowed origins (checked first, by the telemetry ingest middleware) and
   * the application has this list (checked by the replay gate). An empty
   * application list accepts any origin THE KEY allows, so it is a warning
   * for production, never a failure.
   */
  const originCount: number = status.allowedOrigins.length;

  rows.push({
    key: "origins",
    state: originCount > 0 ? "pass" : "warn",
    title:
      originCount > 0
        ? translator.translatePlural(
            {
              one: "This application allows {{count}} origin",
              other: "This application allows {{count}} origins",
            },
            originCount,
          )
        : translateLine(
            "This application accepts any origin the ingestion key allows",
          ),
    detail:
      originCount > 0
        ? translator.translateTemplate(
            "{{origins}}. A request must also pass the ingestion key's own allowed origins; if the two lists disagree, uploads are refused as origin-not-allowed and counted below.",
            {
              origins: composedValue((sentence: Translator): string => {
                return formatList(status.allowedOrigins, sentence);
              }),
            },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            "Two allowlists compose: the ingestion key's allowed origins ({{ingestionKeys}}) are checked first, then this application's. With this list empty, only the key's list protects the project from a copied key. Fine for getting started; list your domains before production.",
            { ingestionKeys: translatableTerm(INGESTION_KEYS_PATH) },
          ),
    action:
      originCount > 0
        ? {
            label: translateLine("Check the ingestion key's origins"),
            to: ingestionKeysRoute,
          }
        : {
            label: translateLine("Edit this application's allowed origins"),
            to: appSettingsRoute,
          },
  });

  const isAlways: boolean =
    status.policy.captureTrigger === SessionReplayCaptureTrigger.Always;
  const sample: number = status.policy.samplePercentage;
  const recordsNothing: boolean = sample <= 0;
  const requiresConsent: boolean =
    status.policy.consentMode === SessionReplayConsentMode.RequireExplicit;

  // Said after what the trigger does, as a sentence of its own.
  const consentSentence: string = requiresConsent
    ? translateLine(
        "Nothing uploads until the page calls OneUptimeReplay.grantConsent().",
      )
    : "";

  rows.push({
    key: "policy",
    state: recordsNothing ? "warn" : isAlways ? "pass" : "info",
    title: describeUploadPolicy(status.policy, translator),
    detail: recordsNothing
      ? translateLine(
          "Nothing is recorded: the sample percentage is 0, so no session is ever eligible under either trigger. Raise it to record the next visitor.",
        )
      : isAlways
        ? joinSentences([
            sample === 100
              ? translateLine(
                  "Every session uploads from the first event, so an ordinary visit is as watchable as a broken one.",
                )
              : translator.translateTemplate(
                  "About {{percent}}% of sessions upload from the first event, so an ordinary visit is as watchable as a broken one.",
                  { percent: translator.formatNumber(sample) },
                ),
            consentSentence,
          ])
        : joinSentences([
            translateLine(
              "Sampled sessions keep a rolling buffer in memory and upload only when an error, a frustration signal or a performance budget fires. A healthy visit produces no recording; that is this setting working as configured.",
            ),
            consentSentence,
          ]),
    action: recordsNothing
      ? { label: translateLine("Set sampling to 100%"), to: appSettingsRoute }
      : isAlways
        ? undefined
        : {
            label: translateLine("Record every session instead"),
            to: appSettingsRoute,
          },
  });

  const loadedAt: number | null = parseHealthTimestamp(
    status.lastConfigFetchAt,
  );
  const chunkAt: number | null = parseHealthTimestamp(
    status.lastChunkReceivedAt,
  );

  rows.push({
    key: "loaded",
    state: loadedAt !== null ? "pass" : chunkAt !== null ? "info" : "waiting",
    title:
      loadedAt !== null
        ? translator.translateTemplate(
            "Recorder loaded on your site {{when}}",
            {
              when: ageOf(loadedAt),
            },
          )
        : chunkAt !== null
          ? translateLine("When the recorder last loaded is not reported")
          : translateLine("Waiting for the recorder to load on your site"),
    detail:
      loadedAt !== null
        ? translateLine(
            "A page fetched this application's replay policy. This is stamped on every recorder start, so it says the script tag is installed and reachable.",
          )
        : chunkAt !== null
          ? translateLine(
              "A chunk has arrived, so the recorder has loaded at least once; this server does not stamp policy fetches.",
            )
          : translateLine(
              "No page has fetched this application's policy. Paste the snippet below, reload a page that carries it, and this row flips within about 10 seconds. If it stays here the tag is not on the page, its identifier does not match, or a CSP script-src rule blocked it.",
            ),
  });

  /* settings-setup-2: silence means different things under the two triggers. */
  let chunkDetail: string;

  if (chunkAt !== null) {
    chunkDetail = translateLine(
      "The end-to-end path works: a recorder on your site reached this server and its chunk was accepted.",
    );
  } else if (recordsNothing) {
    chunkDetail = translateLine("Nothing can arrive while sampling is 0%.");
  } else if (requiresConsent) {
    chunkDetail = translateLine(
      "Nothing arrives until a page calls OneUptimeReplay.grantConsent(). Grant consent on an instrumented page, then reload.",
    );
  } else if (isAlways) {
    chunkDetail = translateLine(
      "Load any instrumented page: a chunk should land within about 15 seconds. If it does not, the install is broken - the tag is not on the page, a connect-src CSP rule blocks the upload, or the origin is refused (counted below).",
    );
  } else {
    chunkDetail = translator.translateTemplate(
      "Under {{trigger}} a healthy visit uploads nothing, so silence here can be correct. To prove the path, throw an error on an instrumented page or call OneUptimeReplay.captureSession(), then reload.",
      { trigger: translatableTerm("On error or frustration") },
    );
  }

  rows.push({
    key: "chunk",
    state:
      chunkAt !== null
        ? "pass"
        : recordsNothing
          ? "warn"
          : isAlways || requiresConsent
            ? "waiting"
            : "info",
    title:
      chunkAt !== null
        ? translator.translateTemplate("Last recording received {{when}}", {
            when: ageOf(chunkAt),
          })
        : translateLine("No recording has ever been received"),
    detail: chunkDetail,
  });

  const sessionCount: number | null = status.sessionsLast24h;
  const playableCount: number | null = status.playableSessionsLast24h;

  rows.push({
    key: "sessions",
    state: sessionCount === null ? "info" : sessionCount > 0 ? "pass" : "info",
    title:
      sessionCount === null
        ? translateLine("Sessions in the last 24h: unknown")
        : playableCount === null
          ? translator.translatePlural(
              {
                one: "{{count}} session in the last 24h",
                other: "{{count}} sessions in the last 24h",
              },
              sessionCount,
            )
          : translator.translatePlural(
              {
                one: "{{count}} session in the last 24h ({{playable}} playable)",
                other:
                  "{{count}} sessions in the last 24h ({{playable}} playable)",
              },
              sessionCount,
              { playable: formatCountForCopy(playableCount, translator) },
            ),
    detail:
      sessionCount === null
        ? translateLine(
            "The session count could not be read from the analytics store.",
          )
        : status.lastSessionStartedAt
          ? translator.translateTemplate("Last session started {{when}}.", {
              when: ageOf(
                parseHealthTimestamp(status.lastSessionStartedAt) ?? nowUnixMs,
              ),
            })
          : translateLine("No session has started in the last 24h."),
  });

  const refusalTotal: number | null =
    status.refusalsLast24h === null
      ? null
      : status.refusalsLast24h.reduce(
          (sum: number, entry: { count: number }): number => {
            return sum + entry.count;
          },
          0,
        );

  rows.push({
    key: "refusals",
    state: refusalTotal === null ? "info" : refusalTotal > 0 ? "warn" : "pass",
    title:
      refusalTotal === null
        ? translateLine("Uploads refused in the last 24h: unknown")
        : refusalTotal === 0
          ? translateLine("No uploads refused in the last 24h")
          : translator.translatePlural(
              {
                one: "{{count}} upload refused in the last 24h",
                other: "{{count}} uploads refused in the last 24h",
              },
              refusalTotal,
            ),
    detail:
      refusalTotal === null
        ? translateLine(
            "The refusal counter store was unreachable; this is not the same as zero.",
          )
        : refusalTotal === 0
          ? translateLine("Every upload that reached the gate was accepted.")
          : translator.translateTemplate(
              "{{reasons}}. The reason words match the recorder's own diagnostics.",
              { reasons: describeReasonCounts(status.refusalsLast24h ?? []) },
              { setsValuesApart: true },
            ),
    action:
      refusalTotal !== null && refusalTotal > 0
        ? {
            label: translateLine("Open this application's replay policy"),
            to: appSettingsRoute,
          }
        : undefined,
  });

  const dropTotal: number | null =
    extras.dropsLast24h === null
      ? null
      : extras.dropsLast24h.reduce(
          (sum: number, entry: { count: number }): number => {
            return sum + entry.count;
          },
          0,
        );

  rows.push({
    key: "drops",
    state: dropTotal === null ? "info" : dropTotal > 0 ? "warn" : "pass",
    title:
      dropTotal === null
        ? translateLine(
            "Chunks dropped after acceptance in the last 24h: unknown",
          )
        : dropTotal === 0
          ? translateLine("No chunks dropped after acceptance in the last 24h")
          : translator.translatePlural(
              {
                one: "{{count}} chunk dropped after acceptance in the last 24h",
                other:
                  "{{count}} chunks dropped after acceptance in the last 24h",
              },
              dropTotal,
            ),
    detail:
      dropTotal === null
        ? translateLine(
            "The drop counter store was unreachable; this is not the same as zero.",
          )
        : dropTotal === 0
          ? translateLine("Everything the gate accepted was stored.")
          : translator.translateTemplate(
              "{{reasons}}. These were accepted with a 202 and then not stored by the worker; the recorder was never told.",
              { reasons: describeReasonCounts(extras.dropsLast24h ?? []) },
              { setsValuesApart: true },
            ),
  });

  /*
   * docs-and-design-fidelity-3: "not reported yet" was printed for an
   * application that has never recorded anything AND for one whose newest
   * recording came from an artifact too old to announce its features. They
   * need different sentences: the first is not about the recorder version
   * at all, and telling that customer to wait for a cache window is a lie.
   */
  const hasEverRecorded: boolean = status.lastChunkReceivedAt !== null;
  const capabilities: Array<string> | null = extras.recorderCapabilities;

  rows.push({
    key: "capabilities",
    state: capabilities === null ? "info" : "pass",
    title:
      capabilities === null
        ? hasEverRecorded
          ? translateLine(
              "Recorder capabilities: not reported by the newest recording",
            )
          : translateLine("Recorder capabilities: not reported yet")
        : capabilities.length === 0
          ? translateLine("Recorder capabilities: none announced")
          : translator.translateTemplate(
              "Recorder capabilities: {{capabilities}}",
              {
                capabilities: composedValue((sentence: Translator): string => {
                  return formatList(capabilities, sentence);
                }),
              },
              { setsValuesApart: true },
            ),
    detail:
      capabilities === null
        ? hasEverRecorded
          ? status.publishedRecorderVersion === null
            ? translateLine(
                "The newest session's first chunk announced no capabilities, and this deployment did not report a current recorder artifact to reload.",
              )
            : translateLine(
                "The newest session's first chunk announced none, so it came from an older recorder, possibly on a page opened before the current deployment. Reloading that page fetches the latest artifact with click labels and web vitals.",
              )
          : translateLine(
              "Capabilities are announced on a session's first chunk. No chunk has arrived for this application yet, so there is nothing to read them from - the checks above say why.",
            )
        : translateLine(
            "Read from the newest session's first chunk. Long-lived pages fetch the latest recorder when they reload.",
          ),
  });

  if (status.budgetExceededAt) {
    const exceededAt: number | null = parseHealthTimestamp(
      status.budgetExceededAt,
    );
    /*
     * When, in the language of the sentence it goes into: an age, or - for
     * a stamp this page cannot read as one - the date's own words, which an
     * English sentence turns back into English.
     */
    const when: TemplateValue =
      exceededAt === null
        ? OneUptimeDate.fromNow(
            OneUptimeDate.fromString(status.budgetExceededAt),
          )
        : ageOf(exceededAt);

    /*
     * server-1: budgetExceededAt is a STAMP, not a live flag - it is left
     * behind by the last exhaustion and is never cleared, so an application
     * that spent its budget in March showed "Live recorders were told to
     * stand down" for the rest of the year. diagnoseRecordingHealth already
     * owns the "is it paused right now?" rule (the stamp counts only while
     * this window's usage is unknown or over budget); read it rather than
     * re-deriving a second, quietly different answer here.
     */
    const isPausedNow: boolean =
      diagnoseRecordingHealth(status, nowUnixMs).state === "budget-paused";

    rows.push({
      key: "budget-exceeded",
      state: isPausedNow ? "fail" : "info",
      title: isPausedNow
        ? translator.translateTemplate(
            "Uploads are paused: a byte budget was exhausted {{when}}",
            { when: when },
          )
        : translator.translateTemplate(
            "A byte budget was exhausted {{when}}; uploads are flowing again",
            { when: when },
          ),
      detail: isPausedNow
        ? translateLine(
            "Live recorders are being told to stand down, so nothing is being recorded for this application right now. Recordings resume when the window rolls over or the budget is raised.",
          )
        : translateLine(
            "That budget window has rolled over and usage is back under the ceiling; this is the last exhaustion, not a live one. Raise the budget if you expect the same traffic again.",
          ),
      action: {
        label: translateLine("Review the budget"),
        to: appSettingsRoute,
      },
    });
  }

  const dailySentence: string =
    status.projectBytesUsedToday === null
      ? translateLine(
          "Today's project usage is unknown (the usage counter was unreachable).",
        )
      : translator.translateTemplate(
          "{{used}} of {{limit}} used today across this project.",
          {
            used: formatBytesForCopy(status.projectBytesUsedToday, translator),
            limit: formatBytesForCopy(status.dailyByteLimit, translator),
          },
        );

  const monthlySentence: string =
    status.monthlyBudgetInGB !== null && status.monthlyBudgetInGB > 0
      ? status.applicationBytesUsedThisMonth === null
        ? translateLine("This month's application usage is unknown.")
        : translator.translateTemplate(
            "{{used}} of this application's {{budget}} GB monthly budget used.",
            {
              used: formatBytesForCopy(
                status.applicationBytesUsedThisMonth,
                translator,
              ),
              budget: translator.formatNumber(status.monthlyBudgetInGB),
            },
          )
      : translateLine(
          "No monthly budget is set for this application (0 or blank means no ceiling).",
        );

  rows.push({
    key: "bytes",
    state: "info",
    title: translateLine("Byte budgets"),
    detail: joinSentences([dailySentence, monthlySentence]),
  });

  return rows;
}

/*
 * The last refresh's failure, as a sentence of its own: one per kind, so the
 * heading describeHealthError gives it is never lower-cased into another
 * sentence.
 */
function describeRefreshFailure(
  error: SessionReplayHealthError,
  translator: Translator,
): string {
  const translateLine: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (error.kind === "permission") {
    return translateLine(
      "The last refresh failed: you cannot see recording health.",
    );
  }

  if (error.kind === "plan") {
    return translateLine(
      "The last refresh failed: recording health is not included in this project's plan.",
    );
  }

  return translateLine(
    "The last refresh failed: recording health could not be loaded.",
  );
}

export interface InstallationTestCadence {
  // A first chunk is still outstanding: the panel polls fast.
  isWaiting: boolean;
  fetchedAtUnixMs: number | null;
  nowUnixMs: number;
  error: SessionReplayHealthError | null;
}

/*
 * The line under the rows: how often the panel checks, when it last read
 * the status, and whether the last refresh failed. Each variant is a whole
 * sentence; without a translator, English word for word.
 */
export function describeInstallationTestCadence(
  cadence: InstallationTestCadence,
  translator: Translator = ENGLISH,
): string {
  const seconds: string = translator.formatNumber(
    Math.round(
      (cadence.isWaiting
        ? SESSION_REPLAY_HEALTH_POLL_FAST_MS
        : SESSION_REPLAY_HEALTH_POLL_SLOW_MS) / 1000,
    ),
  );
  const fetchedAtUnixMs: number | null = cadence.fetchedAtUnixMs;
  let pace: string;

  if (fetchedAtUnixMs === null) {
    pace = cadence.isWaiting
      ? translator.translateTemplate(
          "Checking every {{seconds}}s while a first chunk is outstanding.",
          { seconds: seconds },
        )
      : translator.translateTemplate("Refreshes every {{seconds}}s.", {
          seconds: seconds,
        });
  } else {
    const when: ComposedValue = composedValue(
      (sentence: Translator): string => {
        return formatRelativeAge(fetchedAtUnixMs, cadence.nowUnixMs, sentence);
      },
    );

    pace = cadence.isWaiting
      ? translator.translateTemplate(
          "Checking every {{seconds}}s while a first chunk is outstanding; last read {{when}}.",
          { seconds: seconds, when: when },
        )
      : translator.translateTemplate(
          "Refreshes every {{seconds}}s; last read {{when}}.",
          { seconds: seconds, when: when },
        );
  }

  return joinSentences([
    pace,
    cadence.error ? describeRefreshFailure(cadence.error, translator) : "",
  ]);
}

interface BodyProps {
  rumApplicationId: ObjectID | string;
}

/* One application: the hook, the rows, the snippet, the paste box. */
function InstallationTestBody(props: BodyProps): ReactElement {
  const translator: Translator = useTranslator();
  const [pollIntervalMs, setPollIntervalMs] = useState<number>(
    SESSION_REPLAY_HEALTH_POLL_FAST_MS,
  );

  const health: SessionReplayHealthSnapshot & { refresh: () => Promise<void> } =
    useSessionReplayHealth(props.rumApplicationId, {
      pollIntervalMs: pollIntervalMs,
    });

  /*
   * settings-setup-8: the live waiting loop. Fast while no chunk has ever
   * arrived (the customer is watching this panel for the first flip), slow
   * once one has - after that the panel is a status readout.
   */
  useEffect((): void => {
    const wanted: number =
      health.status && health.status.lastChunkReceivedAt !== null
        ? SESSION_REPLAY_HEALTH_POLL_SLOW_MS
        : SESSION_REPLAY_HEALTH_POLL_FAST_MS;

    if (wanted !== pollIntervalMs) {
      setPollIntervalMs(wanted);
    }
  }, [health.status, pollIntervalMs]);

  const oneuptimeUrl: string = getOneUptimeUrl();

  const rows: Array<CheckRow> = health.status
    ? buildInstallationCheckRows(
        health.status,
        health.extras,
        health.nowUnixMs,
        props.rumApplicationId,
        translator,
      )
    : [];

  const isWaiting: boolean = rows.some((row: CheckRow): boolean => {
    return row.state === "waiting";
  });

  return (
    <div data-testid="install-test" data-state={health.diagnosis.state}>
      {health.isLoading && <ComponentLoader />}

      {!health.isLoading && health.status === null && health.error && (
        <div
          className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
          data-testid="install-test-error"
        >
          <div className="text-sm font-semibold text-gray-900">
            {describeHealthError(health.error, translator).title}
          </div>
          <div className="mt-0.5 text-sm text-gray-700">
            {describeHealthError(health.error, translator).detail}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            <ErrorSentence
              template="Server said: {{message}}"
              error={health.error.message}
              errorPlaceholder="message"
            />
          </div>
        </div>
      )}

      {!health.isLoading && health.status !== null && (
        <div>
          <RecordingHealthDiagnosisBanner
            diagnosis={health.diagnosis}
            rumApplicationId={props.rumApplicationId}
          />

          <div
            className="mt-3 divide-y divide-gray-100"
            aria-live="polite"
            data-testid="install-test-rows"
          >
            {rows.map((row: CheckRow): ReactElement => {
              return <CheckRowView key={row.key} row={row} />;
            })}
          </div>

          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500"
            data-testid="install-test-cadence"
          >
            <Button
              title={health.isRefreshing ? "Refreshing…" : "Refresh now"}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="install-test-run-again"
              disabled={health.isRefreshing}
              onClick={(): void => {
                void health.refresh();
              }}
            />
            <span>
              {describeInstallationTestCadence(
                {
                  isWaiting: isWaiting,
                  fetchedAtUnixMs: health.fetchedAtUnixMs,
                  nowUnixMs: health.nowUnixMs,
                  error: health.error,
                },
                translator,
              )}
            </span>
          </div>

          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-700">
              {translator.translateText("Install snippet")}
            </div>
            <div className="mt-2">
              <SessionReplayInstallSnippet
                appIdentifier={health.status.appIdentifier}
                oneuptimeUrl={oneuptimeUrl}
                showIdentify={true}
              />
            </div>

            <div className="mt-4 text-xs font-semibold text-gray-700">
              {translator.translateText(
                "Content-Security-Policy your site must allow",
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              <TranslatedSentence
                template="{{scriptSrc}} decides whether the recorder loads, {{connectSrc}} whether it uploads; both fail silently. Add {{url}} to the values your site already sets - keep {{self}} and everything else:"
                slots={{
                  scriptSrc: <code>script-src</code>,
                  connectSrc: <code>connect-src</code>,
                  url: <code>{oneuptimeUrl}</code>,
                  self: <code>&apos;self&apos;</code>,
                }}
              />
            </p>
            <div className="mt-2">
              <CodeBlock
                code={buildCspSnippet(oneuptimeUrl)}
                language="plaintext"
              />
            </div>

            <div className="mt-4 border-t border-gray-200 pt-4">
              <RecorderDiagnosticsPasteBox />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export interface ComponentProps {
  /* Given: test this application and hide the picker. */
  rumApplicationId?: ObjectID | string | undefined;
}

const InstallationTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const pinnedApplicationId: string | null = props.rumApplicationId
    ? props.rumApplicationId.toString()
    : null;

  const [applications, setApplications] = useState<Array<RumApplication>>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string>(
    pinnedApplicationId ?? "",
  );
  const [isLoadingApplications, setIsLoadingApplications] = useState<boolean>(
    pinnedApplicationId === null,
  );
  const [applicationsError, setApplicationsError] = useState<string>("");

  const loadApplications: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const result: ListResult<RumApplication> =
        await ModelAPI.getList<RumApplication>({
          modelType: RumApplication,
          query: {
            projectId: ProjectUtil.getCurrentProjectId()!,
          },
          select: {
            _id: true,
            name: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      setApplications(result.data);

      /*
       * settings-setup-17: honour ?rumApplicationId= so a link from another
       * page lands on the application it came from, and only then fall back
       * to the first one alphabetically.
       */
      const requested: string | null = Navigation.getQueryStringByName(
        INSTALLATION_TEST_QUERY_PARAM,
      );
      const requestedExists: boolean =
        requested !== null &&
        result.data.some((application: RumApplication): boolean => {
          return application._id?.toString() === requested;
        });

      if (requestedExists && requested) {
        setSelectedApplicationId(requested);
      } else if (result.data.length > 0 && result.data[0]?._id) {
        setSelectedApplicationId(result.data[0]._id.toString());
      }
    }, []);

  useEffect((): void => {
    if (pinnedApplicationId !== null) {
      setSelectedApplicationId(pinnedApplicationId);
      setIsLoadingApplications(false);
      return;
    }

    loadApplications()
      .catch((err: unknown): void => {
        setApplicationsError(API.getFriendlyMessage(err as HTTPErrorResponse));
      })
      .finally((): void => {
        setIsLoadingApplications(false);
      });
  }, [pinnedApplicationId, loadApplications]);

  const dropdownOptions: Array<DropdownOption> = applications.map(
    (application: RumApplication): DropdownOption => {
      const name: string =
        application.name || application._id?.toString() || "";

      /*
       * An application is drawn by the name it was given, never looked up
       * as a translation key; only the stand-in for a nameless one is ours,
       * and the Dropdown translates it.
       */
      return name
        ? {
            label: name,
            value: application._id?.toString() || "",
            isUserContent: true,
          }
        : { label: "Unnamed", value: application._id?.toString() || "" };
    },
  );

  return (
    <div
      className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm"
      data-testid="install-test-panel"
    >
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {translator.translateText("Test your installation")}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {translator.translateText(
              "Every install failure is silent in your end users' browsers by design, and the server cannot see a recorder that never loaded. This panel checks everything the server can know, and keeps checking while you set up.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pinnedApplicationId === null && dropdownOptions.length > 1 && (
            <div className="w-56">
              <Dropdown
                options={dropdownOptions}
                value={dropdownOptions.find(
                  (option: DropdownOption): boolean => {
                    return option.value === selectedApplicationId;
                  },
                )}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ): void => {
                  if (typeof value === "string") {
                    setSelectedApplicationId(value);
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoadingApplications && <ComponentLoader />}

        {!isLoadingApplications && applicationsError && (
          <div
            className="text-sm text-rose-700"
            data-testid="install-test-apps-error"
          >
            <ErrorSentence
              template="The application list could not be loaded: {{error}}"
              error={applicationsError}
            />
          </div>
        )}

        {!isLoadingApplications &&
          !applicationsError &&
          pinnedApplicationId === null &&
          applications.length === 0 && (
            <div className="text-sm text-gray-500">
              {translator.translateText(
                "No RUM applications yet. Create one first, then test its installation here.",
              )}
            </div>
          )}

        {!isLoadingApplications && selectedApplicationId && (
          <InstallationTestBody
            key={selectedApplicationId}
            rumApplicationId={selectedApplicationId}
          />
        )}
      </div>
    </div>
  );
};

export default InstallationTestPanel;
