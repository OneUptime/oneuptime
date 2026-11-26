import StorageArrayConnectionTest from "Common/Models/DatabaseModels/StorageArrayConnectionTest";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  StorageArrayCollectionArraySummary,
  StorageArrayPresentedCertificate,
} from "Common/Types/StorageArray/Collection/StorageArrayProbeCollection";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import { isStorageArrayConnectionTestSettled } from "Common/Types/StorageArray/Collection/StorageArrayConnectionTestStatus";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import StorageArrayCertificateDetails from "./StorageArrayCertificateDetails";
import {
  PerformanceState,
  STORAGE_ARRAY_TEST_MAX_WAIT_IN_MS,
  STORAGE_ARRAY_TEST_POLL_INTERVAL_IN_MS,
  StorageArrayTestInput,
  StorageArrayTestPhase,
  StorageArrayTestView,
  getArrayLine,
  getPerformanceState,
  getPerformanceWords,
  getStorageArrayTestBlocker,
  getStorageArrayTestView,
} from "./StorageArrayConnectionView";

/*
 * "Test connection" (#11004): the address, account and certificate on the
 * form, tried by the probe picked on it - before anything is saved. It
 * says how many arrays, storage groups and volumes the account can see,
 * and for each array whether Unisphere collects its performance, so what
 * is wrong is named in every case: unreachable, the certificate, the
 * login, a role, performance collection off.
 *
 * When Unisphere shows a certificate the probe does not trust - its own
 * self-signed one, by default - the result shows it, and "Trust this
 * certificate" puts its fingerprint on the form.
 */

export interface ComponentProps {
  input: StorageArrayTestInput;
  collector: StorageArrayProbeCollector;
  onTrustCertificate?: ((fingerprint: string) => void) | undefined;
}

function getPerformanceTone(
  array: StorageArrayCollectionArraySummary,
): PillTone {
  switch (getPerformanceState(array)) {
    case PerformanceState.On:
    case PerformanceState.RealTime:
      return PillTone.Success;
    case PerformanceState.Off:
      return PillTone.Warning;
    default:
      return PillTone.Neutral;
  }
}

const TestedArrays: FunctionComponent<{
  arrays: Array<StorageArrayCollectionArraySummary>;
}> = (props: {
  arrays: Array<StorageArrayCollectionArraySummary>;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.arrays.length === 0) {
    return <></>;
  }

  return (
    <ul
      className="mt-3 divide-y divide-gray-200 rounded-md border border-gray-200 bg-white"
      data-testid="storage-array-test-arrays"
    >
      {props.arrays.map((array: StorageArrayCollectionArraySummary) => {
        return (
          <li key={array.id} className="px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono font-medium text-gray-900">
                  {array.id}
                </span>
                {getArrayLine(array) ? (
                  <span className="ms-2 text-xs text-gray-500">
                    {getArrayLine(array)}
                  </span>
                ) : (
                  <></>
                )}
              </div>
              {array.isLocal ? (
                <Pill
                  text={getPerformanceWords(array, translator)}
                  isUserContent={true}
                  tone={getPerformanceTone(array)}
                />
              ) : (
                <Pill
                  text={
                    translator.translateText(
                      "Remote: not collected here",
                    ) as string
                  }
                  isUserContent={true}
                  tone={PillTone.Neutral}
                />
              )}
            </div>
            {array.warnings.length > 0 ? (
              <ul className="mt-1 space-y-1 text-xs text-gray-600">
                {array.warnings.map((warning: string) => {
                  return (
                    <li key={warning} className="flex items-start gap-1.5">
                      <Icon
                        icon={IconProp.Info}
                        className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600"
                      />
                      <span className="break-words">{warning}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <></>
            )}
          </li>
        );
      })}
    </ul>
  );
};

const StorageArrayConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [test, setTest] = useState<StorageArrayConnectionTest | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const timerRef: MutableRefObject<ReturnType<typeof setTimeout> | null> =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef: MutableRefObject<number> = useRef<number>(0);

  const stopPolling: () => void = (): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      runRef.current++;
      stopPolling();
    };
  }, []);

  const canTest: boolean = PermissionGate.check(
    new StorageArrayConnectionTest(),
    ModelAction.Create,
  ).isAllowed;

  const blocker: string | null = getStorageArrayTestBlocker(props.input);

  const poll: (testId: ObjectID, run: number, startedAt: number) => void = (
    testId: ObjectID,
    run: number,
    startedAt: number,
  ): void => {
    timerRef.current = setTimeout(async () => {
      if (run !== runRef.current) {
        return;
      }
      try {
        const latest: StorageArrayConnectionTest | null =
          await ModelAPI.getItem({
            modelType: StorageArrayConnectionTest,
            id: testId,
            select: {
              status: true,
              errorCode: true,
              errorMessage: true,
              presentedCertificate: true,
              summary: true,
            },
          });
        if (run !== runRef.current) {
          return;
        }
        if (latest) {
          setTest(latest);
          if (isStorageArrayConnectionTestSettled(latest.status)) {
            return;
          }
        }
      } catch (err) {
        if (run === runRef.current) {
          setError(API.getFriendlyErrorMessage(err as Error));
        }
        return;
      }
      if (Date.now() - startedAt > STORAGE_ARRAY_TEST_MAX_WAIT_IN_MS) {
        setError(
          translator.translateText(
            "The test did not finish. Check that the probe is connected, then test again.",
          ) as string,
        );
        return;
      }
      poll(testId, run, startedAt);
    }, STORAGE_ARRAY_TEST_POLL_INTERVAL_IN_MS);
  };

  const startTest: () => Promise<void> = async (): Promise<void> => {
    stopPolling();
    const run: number = ++runRef.current;

    setError("");
    setTest(null);
    setIsStarting(true);

    try {
      const model: StorageArrayConnectionTest =
        new StorageArrayConnectionTest();
      model.storageSystem = props.input.storageSystem;
      model.address = props.input.address.trim();
      model.username = props.input.username.trim();
      model.probeId = new ObjectID(props.input.probeId);
      if (props.input.password) {
        model.password = props.input.password;
      }
      if (props.input.trustedCertificateFingerprint.trim()) {
        model.trustedCertificateFingerprint =
          props.input.trustedCertificateFingerprint.trim();
      }
      if (props.input.storageArrayConnectionId) {
        model.storageArrayConnectionId = props.input.storageArrayConnectionId;
      }

      const response: HTTPResponse<StorageArrayConnectionTest> =
        (await ModelAPI.create({
          model: model,
          modelType: StorageArrayConnectionTest,
        })) as HTTPResponse<StorageArrayConnectionTest>;

      if (run !== runRef.current) {
        return;
      }

      const createdId: string | undefined =
        response.data?._id?.toString() ||
        ((response.data as unknown as JSONObject)?.["_id"] as
          | string
          | undefined);

      if (!createdId) {
        setError(
          translator.translateText("The test could not be started.") as string,
        );
        return;
      }

      setTest(new StorageArrayConnectionTest());
      poll(new ObjectID(createdId), run, Date.now());
    } catch (err) {
      if (run === runRef.current) {
        setError(API.getFriendlyErrorMessage(err as Error));
      }
    } finally {
      if (run === runRef.current) {
        setIsStarting(false);
      }
    }
  };

  if (!canTest) {
    return <></>;
  }

  const view: StorageArrayTestView | null = test
    ? getStorageArrayTestView(test, translator)
    : null;
  const isRunning: boolean =
    isStarting ||
    Boolean(
      view &&
        (view.phase === StorageArrayTestPhase.Waiting ||
          view.phase === StorageArrayTestPhase.Running) &&
        !error,
    );
  const certificate: StorageArrayPresentedCertificate | null =
    view?.certificate || null;

  return (
    <div
      className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid="storage-array-connection-test"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="text-xs text-gray-500">
            {translator.translateText(props.collector.words.testDescription)}
          </div>
        </div>
        <Button
          title={test ? "Test again" : "Test connection"}
          buttonStyle={ButtonStyleType.NORMAL}
          buttonSize={ButtonSize.Small}
          icon={IconProp.Play}
          isLoading={isRunning}
          disabled={Boolean(blocker) || isRunning}
          tooltip={blocker ? translator.translateText(blocker) : undefined}
          dataTestId="storage-array-test-connection-button"
          onClick={() => {
            startTest().catch((err: Error) => {
              setError(API.getFriendlyErrorMessage(err));
            });
          }}
        />
      </div>

      {error ? (
        <div
          className="mt-3 flex items-start gap-2 text-sm text-red-700"
          role="alert"
        >
          <Icon icon={IconProp.Alert} className="mt-0.5 h-4 w-4 flex-none" />
          <span>
            <ErrorInSentence message={error} showWhereToLook={true} />
          </span>
        </div>
      ) : (
        <></>
      )}

      {view && !error ? (
        <div
          className="mt-3"
          role="status"
          data-testid="storage-array-test-result"
        >
          {view.phase === StorageArrayTestPhase.Waiting ||
          view.phase === StorageArrayTestPhase.Running ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Loader loaderType={LoaderType.Beats} size={16} />
              <span>{view.title}</span>
            </div>
          ) : (
            <></>
          )}

          {view.phase === StorageArrayTestPhase.Succeeded ? (
            <div className="text-sm text-emerald-800">
              <div className="flex items-start gap-2">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="mt-0.5 h-4 w-4 flex-none text-emerald-600"
                />
                <span className="font-medium">{view.title}</span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {view.inventory.map((phrase: string) => {
                  return (
                    <li key={phrase}>
                      <Pill
                        text={phrase}
                        isUserContent={true}
                        tone={PillTone.Success}
                        isDotHidden={true}
                      />
                    </li>
                  );
                })}
              </ul>
              <TestedArrays arrays={view.arrays} />
              {view.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  {view.warnings.map((warning: string) => {
                    return (
                      <li key={warning} className="flex items-start gap-1.5">
                        <Icon
                          icon={IconProp.Info}
                          className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600"
                        />
                        <span className="break-words">{warning}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}

          {view.phase === StorageArrayTestPhase.Failed ? (
            <div className="text-sm">
              <div className="flex items-start gap-2 text-red-800">
                <Icon
                  icon={IconProp.Alert}
                  className="mt-0.5 h-4 w-4 flex-none text-red-600"
                />
                <span className="font-medium">{view.title}</span>
              </div>
              {view.message ? (
                <p className="mt-1 break-words text-gray-700">{view.message}</p>
              ) : (
                <></>
              )}
              {view.nextStep ? (
                <p className="mt-1 text-gray-600">{view.nextStep}</p>
              ) : (
                <></>
              )}
              {certificate ? (
                <StorageArrayCertificateDetails
                  certificate={certificate}
                  checkHint={props.collector.words.certificateCheckHint}
                  onTrust={
                    props.onTrustCertificate
                      ? () => {
                          props.onTrustCertificate?.(
                            certificate.fingerprint256,
                          );
                        }
                      : undefined
                  }
                />
              ) : (
                <></>
              )}
            </div>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default StorageArrayConnectionTestPanel;
