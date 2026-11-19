import PageComponentProps from "../../PageComponentProps";
import AppLink from "../../../Components/AppLink/AppLink";
import {
  CIRCUIT_BREAKER_COPY,
  CircuitBreakerStatus,
  getAirflowSnippet,
  getCircuitBreakerPipelineName,
  getCircuitBreakerReasonRoute,
  getCircuitBreakerStatus,
  getCircuitBreakerUrl,
  getCurlSnippet,
  getDbtSnippet,
} from "../../../Components/DataObservability/CircuitBreakerCopy";
import DataObservabilityApi from "../../../Components/DataObservability/DataObservabilityApi";
import { formatOverdue } from "../../../Components/DataObservability/DataObservabilityFormat";
import DataPipeline from "Common/Models/DatabaseModels/DataPipeline";
import OneUptimeDate from "Common/Types/Date";
import {
  DataCircuitBreakerAnswer,
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
  DataCircuitBreakerVerdict,
} from "Common/Types/DataObservability/DataCircuitBreaker";
import { DataPipelineCircuitBreakerState } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

export const CIRCUIT_BREAKER_STATUS_TEST_ID: string =
  "pipeline-circuit-breaker-status";
export const CIRCUIT_BREAKER_SWITCH_TEST_ID: string =
  "pipeline-circuit-breaker-stops-on-late-tables";
export const CIRCUIT_BREAKER_TEST_RESULT_TEST_ID: string =
  "pipeline-circuit-breaker-test-result";

// The tone and words of the status pill.
const STATUS_PILLS: Readonly<
  Record<CircuitBreakerStatus, { text: string; tone: PillTone }>
> = {
  [CircuitBreakerStatus.Stopped]: {
    text: translationKey("Stopped"),
    tone: PillTone.Danger,
  },
  [CircuitBreakerStatus.Go]: {
    text: translationKey("Clear to Run"),
    tone: PillTone.Success,
  },
  [CircuitBreakerStatus.NotSetUp]: {
    text: translationKey("Not Set Up"),
    tone: PillTone.Neutral,
  },
};

// What Test Now's pill says of a stop: what the breaker would do, not what it did.
const WOULD_STOP: string = translationKey("Would Stop");

/*
 * One reason the breaker stopped, or would stop, the pipeline: what is
 * wrong in a pill - the check failing, or how late the table is - then the
 * check and the table by name, as written, opening the table's Checks tab
 * or its page.
 */
const ReasonRow: FunctionComponent<{
  reason: DataCircuitBreakerReason;
  translator: Translator;
}> = (props: {
  reason: DataCircuitBreakerReason;
  translator: Translator;
}): ReactElement => {
  const { reason } = props;
  const isCheck: boolean =
    reason.kind === DataCircuitBreakerReasonKind.CheckFailing;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 py-2">
      {isCheck ? (
        <Pill text="Check Failing" tone={PillTone.Danger} />
      ) : (
        <Pill
          text={formatOverdue(props.translator, reason.lateBySeconds)}
          isUserContent={true}
          tone={PillTone.Warning}
        />
      )}
      <AppLink
        className="min-w-0 break-words text-sm font-medium text-indigo-600 hover:underline"
        to={getCircuitBreakerReasonRoute(reason)}
      >
        {isCheck && reason.check
          ? `${reason.check} · ${reason.table}`
          : reason.table}
      </AppLink>
      {reason.database ? (
        <span className="text-xs text-gray-500">{reason.database}</span>
      ) : (
        <></>
      )}
    </li>
  );
};

/*
 * A PIPELINE'S CIRCUIT BREAKER (#6548).
 *
 * How it stands - stopped since when and why, last said go, or never asked
 * - with Test Now, which asks it as a dry run that keeps nothing; whether a
 * late table stops the pipeline too, a switch that saves as it is flipped;
 * and the step to add to the pipeline, for a shell, Airflow and dbt, with
 * this pipeline's name in it. The reasons are read through Data
 * Observability's route, so a table its reader may not read is never named.
 */
const DataPipelineCircuitBreaker: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [state, setState] = useState<DataPipelineCircuitBreakerState | null>(
    null,
  );
  const [pipeline, setPipeline] = useState<DataPipeline | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [test, setTest] = useState<DataCircuitBreakerAnswer | null>(null);
  const [testError, setTestError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError("");

    try {
      const [readState, readPipeline] = await Promise.all([
        DataObservabilityApi.getPipelineCircuitBreaker(modelId),
        ModelAPI.getItem<DataPipeline>({
          modelType: DataPipeline,
          id: modelId,
          select: { jobName: true, jobNamespace: true, pipelineKey: true },
        }),
      ]);

      setState(readState);
      setPipeline(readPipeline);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  }, [modelId.toString()]);

  useEffect(() => {
    load().catch(() => {
      // load says what failed itself.
    });
  }, [load]);

  const testNow: () => Promise<void> = async (): Promise<void> => {
    setIsTesting(true);
    setTestError("");

    try {
      setTest(await DataObservabilityApi.testPipelineCircuitBreaker(modelId));
    } catch (err) {
      setTest(null);
      setTestError(API.getFriendlyMessage(err));
    }

    setIsTesting(false);
  };

  const status: CircuitBreakerStatus | null = state
    ? getCircuitBreakerStatus(state)
    : null;
  const snippetData: { url: string; pipeline: string } = {
    url: getCircuitBreakerUrl(APP_API_URL.toString()),
    pipeline: getCircuitBreakerPipelineName(pipeline || {}),
  };

  const getStatusSentence: () => string = (): string => {
    if (!state || !status) {
      return "";
    }

    if (status === CircuitBreakerStatus.Stopped && state.stoppedAt) {
      return translator.translateTemplate(CIRCUIT_BREAKER_COPY.stoppedSince, {
        time: OneUptimeDate.fromNow(OneUptimeDate.fromString(state.stoppedAt)),
      });
    }

    if (status === CircuitBreakerStatus.Go && state.checkedAt) {
      return translator.translateTemplate(CIRCUIT_BREAKER_COPY.lastAskedGo, {
        time: OneUptimeDate.fromNow(OneUptimeDate.fromString(state.checkedAt)),
      });
    }

    return (
      translator.translateText(CIRCUIT_BREAKER_COPY.notSetUp) ||
      CIRCUIT_BREAKER_COPY.notSetUp
    );
  };

  const getTestSentence: (answer: DataCircuitBreakerAnswer) => string = (
    answer: DataCircuitBreakerAnswer,
  ): string => {
    const sentence: string =
      answer.verdict === DataCircuitBreakerVerdict.Stop
        ? CIRCUIT_BREAKER_COPY.testStop
        : answer.tables.length === 0
          ? CIRCUIT_BREAKER_COPY.testNoTables
          : CIRCUIT_BREAKER_COPY.testGo;

    return translator.translateText(sentence) || sentence;
  };

  return (
    <div className="space-y-5">
      <Card
        title={CIRCUIT_BREAKER_COPY.cardTitle}
        description={CIRCUIT_BREAKER_COPY.cardDescription}
        buttons={[
          {
            title: CIRCUIT_BREAKER_COPY.testNow,
            buttonStyle: ButtonStyleType.NORMAL,
            icon: IconProp.Play,
            isLoading: isTesting,
            disabled: isLoading || Boolean(error),
            onClick: () => {
              testNow().catch(() => {
                // testNow says what failed itself.
              });
            },
          },
        ]}
      >
        <div data-testid={CIRCUIT_BREAKER_STATUS_TEST_ID}>
          {isLoading ? (
            <DetailListSkeleton fields={2} />
          ) : error ? (
            <ErrorMessage
              message={error}
              onRefreshClick={() => {
                load().catch(() => {
                  // load says what failed itself.
                });
              }}
            />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                {status ? (
                  <Pill
                    text={STATUS_PILLS[status].text}
                    tone={STATUS_PILLS[status].tone}
                  />
                ) : (
                  <></>
                )}
                <span className="text-sm text-gray-700">
                  {getStatusSentence()}
                </span>
              </div>

              {status === CircuitBreakerStatus.Stopped && state ? (
                <div>
                  <h4 className="text-sm font-medium text-gray-900">
                    {translator.translateText(
                      CIRCUIT_BREAKER_COPY.reasonsTitle,
                    )}
                  </h4>
                  {state.reasons.length > 0 ? (
                    <ul className="divide-y divide-gray-100">
                      {state.reasons.map(
                        (
                          reason: DataCircuitBreakerReason,
                          index: number,
                        ): ReactElement => {
                          return (
                            <ReasonRow
                              key={`${reason.dataAssetId}-${reason.dataCheckId || "late"}-${index}`}
                              reason={reason}
                              translator={translator}
                            />
                          );
                        },
                      )}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-gray-600">
                      {translator.translateText(
                        CIRCUIT_BREAKER_COPY.noReadableReasons,
                      )}
                    </p>
                  )}
                </div>
              ) : (
                <></>
              )}

              {testError ? <ErrorMessage message={testError} /> : <></>}

              {test ? (
                <div
                  className="rounded-md border border-gray-200 p-3"
                  data-testid={CIRCUIT_BREAKER_TEST_RESULT_TEST_ID}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Pill
                      text={
                        test.verdict === DataCircuitBreakerVerdict.Stop
                          ? WOULD_STOP
                          : STATUS_PILLS[CircuitBreakerStatus.Go].text
                      }
                      tone={
                        test.verdict === DataCircuitBreakerVerdict.Stop
                          ? PillTone.Danger
                          : PillTone.Success
                      }
                    />
                    <span className="text-sm text-gray-700">
                      {getTestSentence(test)}
                    </span>
                  </div>
                  {test.reasons.length > 0 ? (
                    <ul className="mt-2 divide-y divide-gray-100">
                      {test.reasons.map(
                        (
                          reason: DataCircuitBreakerReason,
                          index: number,
                        ): ReactElement => {
                          return (
                            <ReasonRow
                              key={`test-${reason.dataAssetId}-${reason.dataCheckId || "late"}-${index}`}
                              reason={reason}
                              translator={translator}
                            />
                          );
                        },
                      )}
                    </ul>
                  ) : (
                    <></>
                  )}
                </div>
              ) : (
                <></>
              )}
            </div>
          )}
        </div>
      </Card>

      <ModelSwitchCard<DataPipeline>
        modelType={DataPipeline}
        modelId={modelId}
        column="circuitBreakerStopsOnLateTables"
        cardTitle={CIRCUIT_BREAKER_COPY.switchCardTitle}
        cardDescription={CIRCUIT_BREAKER_COPY.switchCardDescription}
        title={CIRCUIT_BREAKER_COPY.switchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? CIRCUIT_BREAKER_COPY.switchOn
            : CIRCUIT_BREAKER_COPY.switchOff;
        }}
        dataTestId={CIRCUIT_BREAKER_SWITCH_TEST_ID}
      />

      <Card
        title={CIRCUIT_BREAKER_COPY.setupTitle}
        description={CIRCUIT_BREAKER_COPY.setupDescription}
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {translator.translateText(CIRCUIT_BREAKER_COPY.setupKey)}
          </p>
          <Tabs
            label="Where the pipeline runs"
            wrap={true}
            onTabChange={() => {}}
            tabs={[
              {
                name: "curl",
                children: (
                  <div className="space-y-3">
                    <CodeBlock
                      code={getCurlSnippet(snippetData)}
                      language="bash"
                      showCopyButton={true}
                    />
                    <p className="text-sm text-gray-600">
                      {translator.translateText(CIRCUIT_BREAKER_COPY.curlNote)}
                    </p>
                  </div>
                ),
              },
              {
                name: "Airflow",
                children: (
                  <div className="space-y-3">
                    <CodeBlock
                      code={getAirflowSnippet(snippetData)}
                      language="python"
                      showCopyButton={true}
                    />
                    <p className="text-sm text-gray-600">
                      {translator.translateText(
                        CIRCUIT_BREAKER_COPY.airflowNote,
                      )}
                    </p>
                  </div>
                ),
              },
              {
                name: "dbt",
                children: (
                  <div className="space-y-3">
                    <CodeBlock
                      code={getDbtSnippet(snippetData)}
                      language="bash"
                      showCopyButton={true}
                    />
                    <p className="text-sm text-gray-600">
                      {translator.translateText(CIRCUIT_BREAKER_COPY.dbtNote)}
                    </p>
                  </div>
                ),
              },
            ]}
          />
          <a
            className="text-sm font-medium text-indigo-600 hover:underline"
            href="/docs/data-observability/lineage-and-pipelines#circuit-breakers"
            target="_blank"
            rel="noopener noreferrer"
          >
            {translator.translateText(CIRCUIT_BREAKER_COPY.readTheDocs)}
          </a>
        </div>
      </Card>
    </div>
  );
};

export default DataPipelineCircuitBreaker;
