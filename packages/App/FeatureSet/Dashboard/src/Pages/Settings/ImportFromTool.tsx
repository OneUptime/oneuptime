import PageComponentProps from "../PageComponentProps";
import {
  cancelToolImport,
  getToolImportRun,
  listToolImportRuns,
  startToolImport,
  ToolImportRunDetails,
} from "../../Components/ToolImport/ToolImportApi";
import ToolImportConnectForm, {
  ToolImportConnection,
} from "../../Components/ToolImport/ToolImportConnectForm";
import ToolImportHistory from "../../Components/ToolImport/ToolImportHistory";
import {
  getOtherRunningImport,
  isToolImportRunWorking,
  pickToolImportRunToShow,
} from "../../Components/ToolImport/ToolImportPlanView";
import ToolImportPicker from "../../Components/ToolImport/ToolImportPicker";
import ToolImportProgressPanel from "../../Components/ToolImport/ToolImportProgressPanel";
import ToolImportReport from "../../Components/ToolImport/ToolImportReport";
import ToolImportReview from "../../Components/ToolImport/ToolImportReview";
import IconProp from "Common/Types/Icon/IconProp";
import { getToolImportSourceDefinition } from "Common/Types/ToolImport/ToolImportCatalog";
import {
  ToolImportRunView,
  ToolImportSelection,
} from "Common/Types/ToolImport/ToolImportPlan";
import ToolImportRunStatus from "Common/Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "Common/Types/ToolImport/ToolImportSource";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * PROJECT SETTINGS > IMPORT FROM ANOTHER TOOL.
 *
 * "We have customers who are on Incident.io or OpsGenie, and they want to
 * move to OneUptime. ... Please make this great and make it easy (for
 * example, using API keys from these products to import stuff)." (the
 * maintainer)
 *
 * Four steps on one page: pick the tool, paste a read-only API key, look
 * at what was found and tick what to bring over, and read the report. The
 * read and the import run in the background on the server; this page only
 * asks how they are going, every few seconds while one works, and the
 * address keeps the run (?run=), so a reload or a link comes back to it.
 */

// How often the page asks how a working run is going.
export const TOOL_IMPORT_POLL_INTERVAL_MS: number = 2000;

// After a failed ask about a working run, how long before asking again.
const TOOL_IMPORT_POLL_RETRY_MS: number = 5000;

const RUN_QUERY_PARAM: string = "run";

const ImportFromTool: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [runs, setRuns] = useState<Array<ToolImportRunView> | null>(null);
  const [listError, setListError] = useState<string>("");
  const [shownRunId, setShownRunId] = useState<string | null>(null);
  const [details, setDetails] = useState<ToolImportRunDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string>("");
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [pickedSource, setPickedSource] = useState<ToolImportSource | null>(
    null,
  );
  const [pickedRegion, setPickedRegion] = useState<string | undefined>(
    undefined,
  );
  /*
   * What the person gave besides the key for the last read they started -
   * an API ID, an API address - so trying that tool again does not ask for
   * it twice. Only on this page, while it is open; never the key.
   */
  const [lastConnection, setLastConnection] = useState<{
    source: ToolImportSource;
    connection: ToolImportConnection;
  } | null>(null);
  const lastStatusRef: React.MutableRefObject<ToolImportRunStatus | null> =
    useRef<ToolImportRunStatus | null>(null);

  const showRun: (runId: string | null) => void = useCallback(
    (runId: string | null): void => {
      lastStatusRef.current = null;
      setShownRunId(runId);
      setDetails(null);
      setDetailsError("");
      Navigation.setQueryString({ [RUN_QUERY_PARAM]: runId });
    },
    [],
  );

  const loadRuns: (options: { isFirstLoad: boolean }) => Promise<void> =
    useCallback(
      async (options: { isFirstLoad: boolean }): Promise<void> => {
        try {
          const list: Array<ToolImportRunView> = await listToolImportRuns();

          setRuns(list);
          setListError("");

          if (options.isFirstLoad) {
            showRun(
              pickToolImportRunToShow({
                runs: list,
                requestedRunId:
                  Navigation.getQueryStringByName(RUN_QUERY_PARAM),
              }),
            );
          }
        } catch (err) {
          setListError(API.getFriendlyMessage(err));
          setRuns((current: Array<ToolImportRunView> | null) => {
            return current || [];
          });
        }
      },
      [showRun],
    );

  useEffect(() => {
    void loadRuns({ isFirstLoad: true });
  }, []);

  /*
   * The shown run: asked for once, then every few seconds while it reads or
   * imports. When it settles, the list of imports is asked for again, so
   * the history shows how it ended.
   */
  useEffect(() => {
    if (!shownRunId) {
      return;
    }

    let isCancelled: boolean = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const next: ToolImportRunDetails = await getToolImportRun(shownRunId);

        if (isCancelled) {
          return;
        }

        const wasWorking: boolean = Boolean(
          lastStatusRef.current &&
            isToolImportRunWorking(lastStatusRef.current),
        );

        lastStatusRef.current = next.run.status;
        setDetails(next);
        setDetailsError("");

        if (isToolImportRunWorking(next.run.status)) {
          timer = setTimeout(() => {
            void load();
          }, TOOL_IMPORT_POLL_INTERVAL_MS);
        } else if (wasWorking) {
          void loadRuns({ isFirstLoad: false });
        }
      } catch (err) {
        if (isCancelled) {
          return;
        }

        setDetailsError(API.getFriendlyMessage(err));

        // A run that was working is asked about again: the network blinked.
        if (
          lastStatusRef.current &&
          isToolImportRunWorking(lastStatusRef.current)
        ) {
          timer = setTimeout(() => {
            void load();
          }, TOOL_IMPORT_POLL_RETRY_MS);
        }
      }
    };

    void load();

    return () => {
      isCancelled = true;

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [shownRunId, reloadToken]);

  /*
   * The tool picker, or - to try a tool again - that tool's connect step,
   * in the region picked last time.
   */
  const startNewImport: (
    source?: ToolImportSource | undefined,
    region?: string | undefined,
  ) => void = (
    source?: ToolImportSource | undefined,
    region?: string | undefined,
  ): void => {
    setPickedSource(source || null);
    setPickedRegion(region);
    showRun(null);
  };

  const onReadStarted: (
    runId: string,
    connection: ToolImportConnection,
  ) => void = (runId: string, connection: ToolImportConnection): void => {
    if (pickedSource) {
      setLastConnection({ source: pickedSource, connection: connection });
    }

    setPickedSource(null);
    showRun(runId);
    void loadRuns({ isFirstLoad: false });
  };

  const onStartImport: (
    selection: ToolImportSelection,
  ) => Promise<void> = async (
    selection: ToolImportSelection,
  ): Promise<void> => {
    if (!shownRunId) {
      return;
    }

    await startToolImport(shownRunId, selection);
    lastStatusRef.current = ToolImportRunStatus.Importing;
    setReloadToken((token: number): number => {
      return token + 1;
    });
    void loadRuns({ isFirstLoad: false });
  };

  const onDiscard: () => Promise<void> = async (): Promise<void> => {
    if (!shownRunId) {
      return;
    }

    await cancelToolImport(shownRunId);
    startNewImport();
    void loadRuns({ isFirstLoad: false });
  };

  const otherRunning: ToolImportRunView | null = runs
    ? getOtherRunningImport(runs)
    : null;

  const blockedReason: string | undefined = otherRunning
    ? translator.translateTemplate(
        "{{name}} is importing from {{tool}} now. One import runs at a time, so start yours when it finishes.",
        {
          name: otherRunning.createdByUserName || translatableTerm("Someone"),
          tool: getToolImportSourceDefinition(otherRunning.source).title,
        },
      )
    : undefined;

  const renderStart: () => ReactElement = (): ReactElement => {
    if (pickedSource) {
      return (
        <ToolImportConnectForm
          key={pickedSource}
          source={pickedSource}
          initialRegion={pickedRegion}
          initialConnection={
            lastConnection && lastConnection.source === pickedSource
              ? lastConnection.connection
              : undefined
          }
          blockedReason={blockedReason}
          onBack={() => {
            setPickedSource(null);
          }}
          onStarted={onReadStarted}
        />
      );
    }

    return (
      <ToolImportPicker
        onPick={(source: ToolImportSource) => {
          setPickedRegion(undefined);
          setPickedSource(source);
        }}
      />
    );
  };

  const renderRun: () => ReactElement = (): ReactElement => {
    if (!details) {
      if (detailsError) {
        return (
          <ErrorMessage
            message={detailsError}
            action={
              <Button
                title="Start a new import"
                buttonStyle={ButtonStyleType.NORMAL}
                icon={IconProp.Add}
                onClick={() => {
                  startNewImport();
                }}
                dataTestId="tool-import-start-another"
              />
            }
          />
        );
      }

      return <ComponentLoader />;
    }

    const run: ToolImportRunView = details.run;

    if (isToolImportRunWorking(run.status)) {
      return <ToolImportProgressPanel run={run} />;
    }

    if (run.status === ToolImportRunStatus.ReadyToReview) {
      if (details.plan) {
        return (
          <ToolImportReview
            key={run.id}
            plan={details.plan}
            onStart={onStartImport}
            onDiscard={onDiscard}
          />
        );
      }

      return (
        <div data-testid="tool-import-waiting">
          <p className="text-sm text-gray-700">
            {translator.translateTemplate(
              "{{name}} read {{tool}} and has not started the import yet. Only the person who read a tool picks what to bring over.",
              {
                name: run.createdByUserName || translatableTerm("Someone"),
                tool: getToolImportSourceDefinition(run.source).title,
              },
            )}
          </p>
          <div className="mt-4">
            <Button
              title="Start a new import"
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.Add}
              onClick={() => {
                startNewImport();
              }}
              dataTestId="tool-import-start-another"
            />
          </div>
        </div>
      );
    }

    return (
      <ToolImportReport
        run={run}
        report={details.report}
        onStartAnother={startNewImport}
      />
    );
  };

  return (
    <Fragment>
      <Card
        title="Import from another tool"
        description="Bring your team over from the tool you use today: people, teams, on-call schedules, escalation policies and more. Nothing in the other tool is changed."
      >
        <div data-testid="tool-import-page">
          {runs === null ? (
            <ComponentLoader />
          ) : shownRunId ? (
            renderRun()
          ) : (
            renderStart()
          )}
          {detailsError && details && (
            <p
              className="mt-4 text-sm text-red-600"
              role="alert"
              data-testid="tool-import-details-error"
            >
              {translator.translateText(detailsError)}
            </p>
          )}
        </div>
      </Card>

      {runs && (runs.length > 0 || listError) && (
        <Card
          title="Earlier imports"
          description="Imports in this project, newest first. Project owners and admins see everyone's."
        >
          {listError ? (
            <ErrorMessage
              message={listError}
              onRefreshClick={() => {
                void loadRuns({ isFirstLoad: false });
              }}
            />
          ) : (
            <ToolImportHistory
              runs={runs}
              shownRunId={shownRunId}
              onOpen={(runId: string) => {
                setPickedSource(null);
                showRun(runId);
              }}
            />
          )}
        </Card>
      )}
    </Fragment>
  );
};

export default ImportFromTool;
