import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL, HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import ProjectUtil from "Common/UI/Utils/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

/*
 * "Test your installation" - the diagnostic the recorder cannot provide for
 * itself.
 *
 * Every install failure mode the recorder has is SILENT in the customer's
 * browser by design (a blocked script, a refused origin, a disabled app, an
 * exhausted budget all fail without console noise on end users' pages), and
 * the server cannot see a recorder that never loaded. So this panel answers
 * the question from the server's side: is every switch on, when did the last
 * chunk actually land, and how much budget is left - plus the exact CSP the
 * customer's page must allow, since that is the one failure class only their
 * own deployment can fix.
 */

const INGEST_STATUS_ROUTE: string =
  "/telemetry/rum/session-replay/ingest-status";

/*
 * The identifier is interpolated into an HTML attribute the customer will
 * copy-paste into their own page, and it originates from whatever
 * service.name arrived on telemetry — attacker-writable with a scraped
 * ingestion key. Anything outside this closed charset is not interpolated.
 */
const SAFE_APP_IDENTIFIER: RegExp = new RegExp("^[A-Za-z0-9._-]{1,100}$");

interface IngestStatus {
  isProjectAllowed: boolean;
  isApplicationEnabled: boolean;
  appIdentifier: string;
  allowedOrigins: Array<string>;
  samplePercentage: number;
  captureTrigger: string;
  lastChunkReceivedAt: string | null;
  budgetExceededAt: string | null;
  projectBytesUsedToday: number | null;
  dailyByteLimit: number;
  applicationBytesUsedThisMonth: number | null;
  monthlyBudgetInGB: number | null;
}

function parseIngestStatus(data: JSONObject): IngestStatus {
  const origins: Array<string> = Array.isArray(data["allowedOrigins"])
    ? (data["allowedOrigins"] as Array<unknown>).map(
        (entry: unknown): string => {
          return String(entry);
        },
      )
    : [];

  const readNullableNumber: (key: string) => number | null = (
    key: string,
  ): number | null => {
    const value: unknown = data[key];

    if (value === null || value === undefined) {
      return null;
    }

    const parsed: number = Number(value);

    return isFinite(parsed) ? parsed : null;
  };

  return {
    isProjectAllowed: data["isProjectAllowed"] === true,
    isApplicationEnabled: data["isApplicationEnabled"] === true,
    appIdentifier: String(data["appIdentifier"] || ""),
    allowedOrigins: origins,
    samplePercentage: Number(data["samplePercentage"]) || 0,
    captureTrigger: String(data["captureTrigger"] || ""),
    lastChunkReceivedAt: data["lastChunkReceivedAt"]
      ? String(data["lastChunkReceivedAt"])
      : null,
    budgetExceededAt: data["budgetExceededAt"]
      ? String(data["budgetExceededAt"])
      : null,
    projectBytesUsedToday: readNullableNumber("projectBytesUsedToday"),
    dailyByteLimit: Number(data["dailyByteLimit"]) || 0,
    applicationBytesUsedThisMonth: readNullableNumber(
      "applicationBytesUsedThisMonth",
    ),
    monthlyBudgetInGB: readNullableNumber("monthlyBudgetInGB"),
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

type CheckState = "pass" | "fail" | "warn" | "info";

interface CheckRow {
  state: CheckState;
  title: string;
  detail: string;
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
          : IconProp.Info;

  const iconColor: string =
    row.state === "pass"
      ? "text-emerald-600"
      : row.state === "fail"
        ? "text-rose-600"
        : row.state === "warn"
          ? "text-amber-600"
          : "text-gray-400";

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon icon={icon} className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-gray-900">{row.title}</div>
        <div className="text-xs text-gray-500">{row.detail}</div>
      </div>
    </div>
  );
}

const InstallationTestPanel: FunctionComponent = (): ReactElement => {
  const [applications, setApplications] = useState<Array<RumApplication>>([]);
  const [selectedApplicationId, setSelectedApplicationId] =
    useState<string>("");
  const [status, setStatus] = useState<IngestStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Same guard as ReplayCard: two status requests can race when the user
   * switches applications mid-flight, and the LAST to resolve would win —
   * rendering app A's checks and install snippet under app B's dropdown.
   */
  const loadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const httpProtocol: string =
    HTTP_PROTOCOL === Protocol.HTTPS ? "https" : "http";
  const oneuptimeUrl: string = HOST
    ? `${httpProtocol}://${HOST}`
    : "<YOUR_ONEUPTIME_URL>";

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
            appIdentifier: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      setApplications(result.data);

      if (result.data.length > 0 && result.data[0]?._id) {
        setSelectedApplicationId(result.data[0]._id.toString());
      } else {
        setIsLoading(false);
      }
    }, []);

  const loadStatus: (applicationId: string) => Promise<void> = useCallback(
    async (applicationId: string): Promise<void> => {
      loadGenerationRef.current += 1;
      const generation: number = loadGenerationRef.current;

      try {
        setIsLoading(true);
        setError("");

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              INGEST_STATUS_ROUTE,
            ),
            data: {
              rumApplicationId: applicationId,
            },
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (generation !== loadGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setStatus(parseIngestStatus(response.data));
      } catch (err) {
        if (generation === loadGenerationRef.current) {
          setStatus(null);
          setError(API.getFriendlyMessage(err as HTTPErrorResponse));
        }
      } finally {
        if (generation === loadGenerationRef.current) {
          setIsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    loadApplications().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as HTTPErrorResponse));
      setIsLoading(false);
    });
  }, [loadApplications]);

  useEffect(() => {
    if (selectedApplicationId) {
      void loadStatus(selectedApplicationId);
    }
  }, [selectedApplicationId, loadStatus]);

  const dropdownOptions: Array<DropdownOption> = applications.map(
    (application: RumApplication): DropdownOption => {
      return {
        label: application.name || application._id?.toString() || "Unnamed",
        value: application._id?.toString() || "",
      };
    },
  );

  const rows: Array<CheckRow> = [];

  if (status) {
    rows.push({
      state: status.isProjectAllowed ? "pass" : "fail",
      title: status.isProjectAllowed
        ? "Session replay is allowed for this project"
        : "Session replay is switched off for this project",
      detail: status.isProjectAllowed
        ? "The project-level master switch is on."
        : "Turn on the project-level switch above. While it is off, every chunk is refused at ingest.",
    });

    rows.push({
      state: status.isApplicationEnabled ? "pass" : "fail",
      title: status.isApplicationEnabled
        ? "Recording is enabled for this application"
        : "Recording is disabled for this application",
      detail: status.isApplicationEnabled
        ? "The per-application recording toggle is on."
        : "Enable recording in the per-application policy table above.",
    });

    /*
     * An empty allowlist ACCEPTS every origin - see
     * SessionReplayGateCache.isOriginAllowed. It is not an install failure
     * and must not be reported as one, or the panel sends people to fix
     * the one thing that is not broken. It is still a production gap, so
     * it warns rather than passes.
     */
    rows.push({
      state: status.allowedOrigins.length > 0 ? "pass" : "warn",
      title:
        status.allowedOrigins.length > 0
          ? `Origin allowlist has ${status.allowedOrigins.length} ${
              status.allowedOrigins.length === 1 ? "entry" : "entries"
            }`
          : "Origin allowlist is empty — recordings are accepted from any origin",
      detail:
        status.allowedOrigins.length > 0
          ? status.allowedOrigins.join(", ")
          : "Fine for getting started, wrong for production. Your ingestion key is visible in your page's JavaScript and has no origin binding of its own, so until you list your domains anyone who copies it can write forged recordings into this project.",
    });

    const isErrorTriggered: boolean =
      status.captureTrigger !== "Always" && status.samplePercentage === 0;

    rows.push({
      state: "info",
      title: `Capture: ${status.captureTrigger || "OnErrorOrFrustration"}, ${
        status.samplePercentage
      }% sampled`,
      detail: isErrorTriggered
        ? "Recordings upload only when an error or frustration signal fires. A healthy visit produces no recording — that is expected, not a broken install."
        : "Sampled sessions upload from their first event; the rest only on error or frustration.",
    });

    rows.push({
      state: status.lastChunkReceivedAt ? "pass" : "warn",
      title: status.lastChunkReceivedAt
        ? `Last recording received ${OneUptimeDate.fromNow(
            OneUptimeDate.fromString(status.lastChunkReceivedAt),
          )}`
        : "No recording has ever been received",
      detail: status.lastChunkReceivedAt
        ? "The end-to-end path works: a recorder on your site reached this instance and its chunk was accepted."
        : "This is the definitive end-to-end signal. If every check above passes and this stays empty after an error on an instrumented page, the recorder is most likely blocked by your site's Content-Security-Policy (see below) or the snippet is not installed.",
    });

    if (status.budgetExceededAt) {
      rows.push({
        state: "warn",
        title: `A byte budget was exhausted ${OneUptimeDate.fromNow(
          OneUptimeDate.fromString(status.budgetExceededAt),
        )}`,
        detail:
          "Live recorders were told to stand down when the budget ran out. Recordings resume when the window rolls over or the budget is raised.",
      });
    }

    const dailyDetail: string =
      status.projectBytesUsedToday === null
        ? "Today's usage is unknown (the usage counter is unreachable)."
        : `${formatBytes(status.projectBytesUsedToday)} of ${formatBytes(
            status.dailyByteLimit,
          )} used today across this project.`;

    const monthlyDetail: string =
      status.monthlyBudgetInGB && status.monthlyBudgetInGB > 0
        ? status.applicationBytesUsedThisMonth === null
          ? " This month's application usage is unknown."
          : ` ${formatBytes(
              status.applicationBytesUsedThisMonth,
            )} of this application's ${status.monthlyBudgetInGB} GB monthly budget used.`
        : " No monthly budget is set for this application.";

    rows.push({
      state: "info",
      title: "Byte budgets",
      detail: dailyDetail + monthlyDetail,
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            Test your installation
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Every install failure is silent in your end users&apos; browsers by
            design, and the server cannot see a recorder that never loaded. This
            panel checks everything the server can know.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dropdownOptions.length > 1 && (
            <div className="w-56">
              <Dropdown
                options={dropdownOptions}
                value={dropdownOptions.find((option: DropdownOption) => {
                  return option.value === selectedApplicationId;
                })}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "string") {
                    setSelectedApplicationId(value);
                  }
                }}
              />
            </div>
          )}
          <Button
            title="Run again"
            buttonStyle={ButtonStyleType.OUTLINE}
            onClick={() => {
              if (selectedApplicationId) {
                void loadStatus(selectedApplicationId);
              }
            }}
          />
        </div>
      </div>

      <div className="px-5 py-4">
        {isLoading && <ComponentLoader />}

        {!isLoading && error && (
          <div className="text-sm text-rose-600">{error}</div>
        )}

        {!isLoading && !error && applications.length === 0 && (
          <div className="text-sm text-gray-500">
            No RUM applications yet. Create one first, then test its
            installation here.
          </div>
        )}

        {!isLoading && !error && status && (
          <div>
            <div className="divide-y divide-gray-100">
              {rows.map((row: CheckRow, index: number): ReactElement => {
                return <CheckRowView key={index} row={row} />;
              })}
            </div>

            <div className="mt-4 rounded-lg bg-gray-50 p-4">
              <div className="text-xs font-semibold text-gray-700">
                Install snippet
              </div>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
                {`<script
  src="${oneuptimeUrl}/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-host="${oneuptimeUrl}"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_KEY"
  data-oneuptime-app-identifier="${
    SAFE_APP_IDENTIFIER.test(status.appIdentifier)
      ? status.appIdentifier
      : "YOUR_APP_IDENTIFIER"
  }"
  async
></script>`}
              </pre>

              <div className="mt-3 text-xs font-semibold text-gray-700">
                Content-Security-Policy your site must allow
              </div>
              <p className="mt-1 text-xs text-gray-500">
                A page with <code>script-src &apos;self&apos;</code> cannot load
                the recorder and <code>connect-src &apos;self&apos;</code>{" "}
                blocks uploads — both fail silently. If your site sets a CSP,
                include:
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
                {`script-src  ${oneuptimeUrl};
connect-src ${oneuptimeUrl};`}
              </pre>

              {/*
               * Every check above answers from the SERVER's side, which is
               * the half that cannot see a recorder that never loaded - a
               * blocked script, a browser privacy signal, an unsampled
               * session, a consent mode nobody granted. This is the other
               * half, and it is the same panel's job to hand it over.
               */}
              <div className="mt-3 text-xs font-semibold text-gray-700">
                Ask the browser instead
              </div>
              <p className="mt-1 text-xs text-gray-500">
                These checks answer from the server&apos;s side. Anything that
                stops the recorder before it uploads — a blocked script, a Do
                Not Track signal, an unsampled session, consent that was never
                granted — is only visible in the browser. Run this in the
                console on the page that is failing, then reload:
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
                {`localStorage.setItem("oneuptime.sessionReplay.debug", "true");

// after reloading, for a support ticket:
OneUptimeReplay.getDiagnostics();`}
              </pre>
              <p className="mt-1 text-xs text-gray-500">
                Every line is explained in{" "}
                <a
                  className="underline"
                  href="/docs/rum/session-replay-troubleshooting"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Session Replay Troubleshooting
                </a>
                . Note that a recorder making no upload requests is usually
                working correctly: under the <code>OnErrorOrFrustration</code>{" "}
                trigger it uploads only when something goes wrong. Call{" "}
                <code>OneUptimeReplay.captureSession()</code> to force one.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InstallationTestPanel;
