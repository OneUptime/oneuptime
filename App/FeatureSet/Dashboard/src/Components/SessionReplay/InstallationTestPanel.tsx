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
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ProjectUtil from "Common/UI/Utils/Project";
import Navigation from "Common/UI/Utils/Navigation";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { RecordingHealthStatus } from "Common/Types/Rum/SessionReplayHealth";
import {
  formatBytesForCopy,
  formatCountForCopy,
  formatRelativeAge,
  parseHealthTimestamp,
} from "Common/Utils/Rum/SessionReplayHealth";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_FAST_MS,
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
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
 * The rows, as a pure function of the status so every branch is a unit
 * test with a fixed clock (Common/Tests/UI/Rum/RecordingHealthCard.test.tsx).
 */
export function buildInstallationCheckRows(
  status: RecordingHealthStatus,
  extras: SessionReplayHealthExtras,
  nowUnixMs: number,
  rumApplicationId: ObjectID | string,
): Array<CheckRow> {
  const rows: Array<CheckRow> = [];
  const modelId: ObjectID = new ObjectID(rumApplicationId.toString());

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
      ? "Session replay is allowed for this project"
      : "Session replay is switched off for this project",
    detail: status.policy.isProjectEnabled
      ? "The project-wide master switch is on."
      : "While the master switch is off, every chunk from every application is refused at ingest.",
    action: status.policy.isProjectEnabled
      ? undefined
      : { label: "Open the project-wide switch", to: projectSettingsRoute },
  });

  rows.push({
    key: "app-switch",
    state: status.policy.isApplicationEnabled ? "pass" : "fail",
    title: status.policy.isApplicationEnabled
      ? "Recording is enabled for this application"
      : "Recording is disabled for this application",
    detail: status.policy.isApplicationEnabled
      ? "The per-application recording toggle is on."
      : "Recorders on this application's pages fetch a disabled policy and record nothing.",
    action: status.policy.isApplicationEnabled
      ? undefined
      : {
          label: "Open this application's replay policy",
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
        ? `This application allows ${originCount} origin${originCount === 1 ? "" : "s"}`
        : "This application accepts any origin the ingestion key allows",
    detail:
      originCount > 0
        ? `${status.allowedOrigins.join(", ")}. A request must also pass the ingestion key's own allowed origins; if the two lists disagree, uploads are refused as origin-not-allowed and counted below.`
        : "Two allowlists compose: the ingestion key's allowed origins (Project Settings > Telemetry Ingestion Keys) are checked first, then this application's. With this list empty, only the key's list protects the project from a copied key. Fine for getting started; list your domains before production.",
    action:
      originCount > 0
        ? { label: "Check the ingestion key's origins", to: ingestionKeysRoute }
        : {
            label: "Edit this application's allowed origins",
            to: appSettingsRoute,
          },
  });

  const isAlways: boolean =
    status.policy.captureTrigger === SessionReplayCaptureTrigger.Always;
  const sample: number = status.policy.samplePercentage;
  const recordsNothing: boolean = sample <= 0;
  const requiresConsent: boolean =
    status.policy.consentMode === SessionReplayConsentMode.RequireExplicit;

  rows.push({
    key: "policy",
    state: recordsNothing ? "warn" : isAlways ? "pass" : "info",
    title: `Uploads ${labelEnum(CAPTURE_TRIGGER_LABELS, status.policy.captureTrigger).toLowerCase()}, sampling ${sample}%${
      requiresConsent ? ", consent required" : ""
    }`,
    detail: recordsNothing
      ? "Nothing is recorded: the sample percentage is 0, so no session is ever eligible under either trigger. Raise it to record the next visitor."
      : isAlways
        ? `${sample === 100 ? "Every" : `About ${sample}% of`} session${sample === 100 ? "" : "s"} upload${sample === 100 ? "s" : ""} from the first event, so an ordinary visit is as watchable as a broken one.${
            requiresConsent
              ? " Nothing uploads until the page calls OneUptimeReplay.grantConsent()."
              : ""
          }`
        : `Sampled sessions keep a rolling buffer in memory and upload only when an error, a frustration signal or a performance budget fires. A healthy visit produces no recording; that is this setting working as configured.${
            requiresConsent
              ? " Nothing uploads until the page calls OneUptimeReplay.grantConsent()."
              : ""
          }`,
    action: recordsNothing
      ? { label: "Set sampling to 100%", to: appSettingsRoute }
      : isAlways
        ? undefined
        : { label: "Record every session instead", to: appSettingsRoute },
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
        ? `Recorder loaded on your site ${formatRelativeAge(loadedAt, nowUnixMs)}`
        : chunkAt !== null
          ? "When the recorder last loaded is not reported"
          : "Waiting for the recorder to load on your site",
    detail:
      loadedAt !== null
        ? "A page fetched this application's replay policy. This is stamped on every recorder start, so it says the script tag is installed and reachable."
        : chunkAt !== null
          ? "A chunk has arrived, so the recorder has loaded at least once; this server does not stamp policy fetches."
          : "No page has fetched this application's policy. Paste the snippet below, reload a page that carries it, and this row flips within about 10 seconds. If it stays here the tag is not on the page, its identifier does not match, or a CSP script-src rule blocked it.",
  });

  /* settings-setup-2: silence means different things under the two triggers. */
  let chunkDetail: string;

  if (chunkAt !== null) {
    chunkDetail =
      "The end-to-end path works: a recorder on your site reached this server and its chunk was accepted.";
  } else if (recordsNothing) {
    chunkDetail = "Nothing can arrive while sampling is 0%.";
  } else if (requiresConsent) {
    chunkDetail =
      "Nothing arrives until a page calls OneUptimeReplay.grantConsent(). Grant consent on an instrumented page, then reload.";
  } else if (isAlways) {
    chunkDetail =
      "Load any instrumented page: a chunk should land within about 15 seconds. If it does not, the install is broken - the tag is not on the page, a connect-src CSP rule blocks the upload, or the origin is refused (counted below).";
  } else {
    chunkDetail =
      "Under On error or frustration a healthy visit uploads nothing, so silence here can be correct. To prove the path, throw an error on an instrumented page or call OneUptimeReplay.captureSession(), then reload.";
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
        ? `Last recording received ${formatRelativeAge(chunkAt, nowUnixMs)}`
        : "No recording has ever been received",
    detail: chunkDetail,
  });

  rows.push({
    key: "sessions",
    state:
      status.sessionsLast24h === null
        ? "info"
        : status.sessionsLast24h > 0
          ? "pass"
          : "info",
    title:
      status.sessionsLast24h === null
        ? "Sessions in the last 24h: unknown"
        : `${formatCountForCopy(status.sessionsLast24h)} session${
            status.sessionsLast24h === 1 ? "" : "s"
          } in the last 24h${
            status.playableSessionsLast24h === null
              ? ""
              : ` (${formatCountForCopy(status.playableSessionsLast24h)} playable)`
          }`,
    detail:
      status.sessionsLast24h === null
        ? "The session count could not be read from the analytics store."
        : status.lastSessionStartedAt
          ? `Last session started ${formatRelativeAge(
              parseHealthTimestamp(status.lastSessionStartedAt) ?? nowUnixMs,
              nowUnixMs,
            )}.`
          : "No session has started in the last 24h.",
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
        ? "Uploads refused in the last 24h: unknown"
        : refusalTotal === 0
          ? "No uploads refused in the last 24h"
          : `${formatCountForCopy(refusalTotal)} upload${refusalTotal === 1 ? "" : "s"} refused in the last 24h`,
    detail:
      refusalTotal === null
        ? "The refusal counter store was unreachable; this is not the same as zero."
        : refusalTotal === 0
          ? "Every upload that reached the gate was accepted."
          : (status.refusalsLast24h ?? [])
              .map((entry: { reason: string; count: number }): string => {
                return `${formatCountForCopy(entry.count)} ${entry.reason}`;
              })
              .join(", ") +
            ". The reason words match the recorder's own diagnostics.",
    action:
      refusalTotal !== null && refusalTotal > 0
        ? {
            label: "Open this application's replay policy",
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
        ? "Chunks dropped after acceptance in the last 24h: unknown"
        : dropTotal === 0
          ? "No chunks dropped after acceptance in the last 24h"
          : `${formatCountForCopy(dropTotal)} chunk${dropTotal === 1 ? "" : "s"} dropped after acceptance in the last 24h`,
    detail:
      dropTotal === null
        ? "The drop counter store was unreachable; this is not the same as zero."
        : dropTotal === 0
          ? "Everything the gate accepted was stored."
          : (extras.dropsLast24h ?? [])
              .map((entry: { reason: string; count: number }): string => {
                return `${formatCountForCopy(entry.count)} ${entry.reason}`;
              })
              .join(", ") +
            ". These were accepted with a 202 and then not stored by the worker; the recorder was never told.",
  });

  rows.push({
    key: "capabilities",
    state: extras.recorderCapabilities === null ? "info" : "pass",
    title:
      extras.recorderCapabilities === null
        ? "Recorder capabilities: not reported yet"
        : extras.recorderCapabilities.length === 0
          ? "Recorder capabilities: none announced"
          : `Recorder capabilities: ${extras.recorderCapabilities.join(", ")}`,
    detail:
      extras.recorderCapabilities === null
        ? `Announced on the first chunk of a session recorded by a recorder that knows its features${
            status.publishedRecorderVersion
              ? ` (this deployment publishes ${status.publishedRecorderVersion})`
              : ""
          }. A browser holding an older cached artifact refreshes within its cache window; until then its sessions lack click labels and web vitals.`
        : "Read from the newest session's first chunk. A browser holding an older cached artifact refreshes within its cache window.",
  });

  if (status.budgetExceededAt) {
    const exceededAt: number | null = parseHealthTimestamp(
      status.budgetExceededAt,
    );

    rows.push({
      key: "budget-exceeded",
      state: "warn",
      title: `A byte budget was exhausted ${
        exceededAt === null
          ? OneUptimeDate.fromNow(
              OneUptimeDate.fromString(status.budgetExceededAt),
            )
          : formatRelativeAge(exceededAt, nowUnixMs)
      }`,
      detail:
        "Live recorders were told to stand down when the budget ran out. Recordings resume when the window rolls over or the budget is raised.",
      action: { label: "Review the budget", to: appSettingsRoute },
    });
  }

  const dailyDetail: string =
    status.projectBytesUsedToday === null
      ? "Today's project usage is unknown (the usage counter was unreachable)."
      : `${formatBytesForCopy(status.projectBytesUsedToday)} of ${formatBytesForCopy(
          status.dailyByteLimit,
        )} used today across this project.`;

  const monthlyDetail: string =
    status.monthlyBudgetInGB !== null && status.monthlyBudgetInGB > 0
      ? status.applicationBytesUsedThisMonth === null
        ? " This month's application usage is unknown."
        : ` ${formatBytesForCopy(status.applicationBytesUsedThisMonth)} of this application's ${status.monthlyBudgetInGB} GB monthly budget used.`
      : " No monthly budget is set for this application (0 or blank means no ceiling).";

  rows.push({
    key: "bytes",
    state: "info",
    title: "Byte budgets",
    detail: dailyDetail + monthlyDetail,
  });

  return rows;
}

interface BodyProps {
  rumApplicationId: ObjectID | string;
}

/* One application: the hook, the rows, the snippet, the paste box. */
function InstallationTestBody(props: BodyProps): ReactElement {
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
            {describeHealthError(health.error).title}
          </div>
          <div className="mt-0.5 text-sm text-gray-700">
            {describeHealthError(health.error).detail}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            Server said: {health.error.message}
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
              {isWaiting
                ? `Checking every ${Math.round(SESSION_REPLAY_HEALTH_POLL_FAST_MS / 1000)}s while a first chunk is outstanding`
                : `Refreshes every ${Math.round(SESSION_REPLAY_HEALTH_POLL_SLOW_MS / 1000)}s`}
              {health.fetchedAtUnixMs !== null
                ? `; last read ${formatRelativeAge(health.fetchedAtUnixMs, health.nowUnixMs)}`
                : ""}
              {health.error
                ? `. The last refresh failed: ${describeHealthError(health.error).title.toLowerCase()}`
                : ""}
              .
            </span>
          </div>

          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="text-xs font-semibold text-gray-700">
              Install snippet
            </div>
            <div className="mt-2">
              <SessionReplayInstallSnippet
                appIdentifier={health.status.appIdentifier}
                oneuptimeUrl={oneuptimeUrl}
                showIdentify={true}
              />
            </div>

            <div className="mt-4 text-xs font-semibold text-gray-700">
              Content-Security-Policy your site must allow
            </div>
            <p className="mt-1 text-xs text-gray-500">
              <code>script-src</code> decides whether the recorder loads,{" "}
              <code>connect-src</code> whether it uploads; both fail silently.
              Add <code>{oneuptimeUrl}</code> to the values your site already
              sets - keep <code>&apos;self&apos;</code> and everything else:
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
      return {
        label: application.name || application._id?.toString() || "Unnamed",
        value: application._id?.toString() || "",
      };
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
            Test your installation
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Every install failure is silent in your end users&apos; browsers by
            design, and the server cannot see a recorder that never loaded. This
            panel checks everything the server can know, and keeps checking
            while you set up.
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
            The application list could not be loaded: {applicationsError}
          </div>
        )}

        {!isLoadingApplications &&
          !applicationsError &&
          pinnedApplicationId === null &&
          applications.length === 0 && (
            <div className="text-sm text-gray-500">
              No RUM applications yet. Create one first, then test its
              installation here.
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
