import XcpNgConnectionTest from "Common/Models/DatabaseModels/XcpNgConnectionTest";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
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
import { CertificateDetails } from "../VMware/VMwareConnectionTestPanel";
import XcpNgNoticeList from "./XcpNgNoticeList";
import {
  XCP_NG_TEST_MAX_WAIT_IN_MS,
  XCP_NG_TEST_POLL_INTERVAL_IN_MS,
  XcpNgConnectionTestInput,
  XcpNgConnectionTestPhase,
  XcpNgConnectionTestView,
  getXcpNgConnectionTestBlocker,
  getXcpNgConnectionTestView,
  getXcpNgTrustHint,
  isXcpNgConnectionTestSettled,
} from "./XcpNgConnectionView";

/*
 * "Test connection": the kind, address, secrets and certificate on the
 * form, tried by the probe picked on it - before anything is saved. A test
 * of a connection that is already set up may leave its secrets out: the
 * server then uses the saved ones, for the address, probe and certificate
 * they were saved for.
 *
 * Xen Orchestra signs its own certificate, and an XCP-ng host signs its
 * own: the result shows the one presented, and "Trust this certificate"
 * puts its fingerprint on the form. Nothing is ever sent to a certificate
 * nobody trusted.
 */

export interface ComponentProps {
  input: XcpNgConnectionTestInput;
  // Puts the fingerprint presented on the form.
  onTrustCertificate?: ((fingerprint: string) => void) | undefined;
  dataTestId?: string | undefined;
}

const XcpNgConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [test, setTest] = useState<XcpNgConnectionTest | null>(null);
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
    new XcpNgConnectionTest(),
    ModelAction.Create,
  ).isAllowed;

  const blocker: string | null = getXcpNgConnectionTestBlocker(props.input);
  const isXapi: boolean =
    props.input.connectionType === XcpNgConnectionType.Xapi;

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
        const latest: XcpNgConnectionTest | null = await ModelAPI.getItem({
          modelType: XcpNgConnectionTest,
          id: testId,
          select: {
            status: true,
            connectionType: true,
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

          if (isXcpNgConnectionTestSettled(latest.status)) {
            return;
          }
        }
      } catch (err) {
        if (run !== runRef.current) {
          return;
        }

        setError(API.getFriendlyErrorMessage(err as Error));
        return;
      }

      if (Date.now() - startedAt > XCP_NG_TEST_MAX_WAIT_IN_MS) {
        setError(
          translator.translateText(
            "The test did not finish. Check that the probe is connected, then test again.",
          ) as string,
        );
        return;
      }

      poll(testId, run, startedAt);
    }, XCP_NG_TEST_POLL_INTERVAL_IN_MS);
  };

  const startTest: () => Promise<void> = async (): Promise<void> => {
    stopPolling();
    const run: number = ++runRef.current;

    setError("");
    setTest(null);
    setIsStarting(true);

    try {
      const model: XcpNgConnectionTest = new XcpNgConnectionTest();
      model.connectionType =
        props.input.connectionType || XcpNgConnectionType.XenOrchestra;
      model.address = props.input.address.trim();
      model.probeId = new ObjectID(props.input.probeId);

      if (props.input.trustedCertificateFingerprint.trim()) {
        model.trustedCertificateFingerprint =
          props.input.trustedCertificateFingerprint.trim();
      }

      // Only what was typed: a saved connection's own secrets stay on the server.
      if (isXapi) {
        model.username = props.input.username.trim();

        if (props.input.password) {
          model.password = props.input.password;
        }
      } else {
        if (props.input.openMetricsSecret) {
          model.openMetricsSecret = props.input.openMetricsSecret;
        }

        if (props.input.apiToken) {
          model.apiToken = props.input.apiToken;
        }
      }

      if (props.input.xcpNgConnectionId) {
        model.xcpNgConnectionId = props.input.xcpNgConnectionId;
      }

      const response: HTTPResponse<XcpNgConnectionTest> =
        (await ModelAPI.create({
          model: model,
          modelType: XcpNgConnectionTest,
        })) as HTTPResponse<XcpNgConnectionTest>;

      if (run !== runRef.current) {
        return;
      }

      const created: XcpNgConnectionTest = response.data;
      const createdId: string | undefined =
        created?._id?.toString() ||
        ((response.data as unknown as JSONObject)?.["_id"] as
          | string
          | undefined);

      if (!createdId) {
        setError(
          translator.translateText("The test could not be started.") as string,
        );
        return;
      }

      const pending: XcpNgConnectionTest = new XcpNgConnectionTest();
      pending.connectionType = model.connectionType;
      setTest(pending);
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

  const view: XcpNgConnectionTestView | null = test
    ? getXcpNgConnectionTestView(test, translator)
    : null;
  const isRunning: boolean =
    isStarting ||
    Boolean(
      view &&
        (view.phase === XcpNgConnectionTestPhase.Waiting ||
          view.phase === XcpNgConnectionTestPhase.Running) &&
        !error,
    );

  return (
    <div
      className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={props.dataTestId || "xcp-ng-connection-test"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="text-xs text-gray-500">
            {isXapi
              ? translator.translateText(
                  "The probe logs in to the pool master with these settings, reads what the account can see, and logs out. Nothing is saved.",
                )
              : translator.translateText(
                  "The probe reads Xen Orchestra's OpenMetrics plugin with these settings, and checks the API token. Nothing is saved.",
                )}
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
          dataTestId="xcp-ng-test-connection-button"
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
        <div className="mt-3" role="status" data-testid="xcp-ng-test-result">
          {view.phase === XcpNgConnectionTestPhase.Waiting ||
          view.phase === XcpNgConnectionTestPhase.Running ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Loader loaderType={LoaderType.Beats} size={16} />
              <span>{view.title}</span>
            </div>
          ) : (
            <></>
          )}

          {view.phase === XcpNgConnectionTestPhase.Succeeded ? (
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
                    <li
                      key={phrase}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200"
                    >
                      {phrase}
                    </li>
                  );
                })}
              </ul>
              {view.poolNames.length > 0 ? (
                <p
                  className="mt-2 break-words text-xs text-gray-600"
                  data-testid="xcp-ng-test-pool-names"
                >
                  {translator.translateTemplate("Pools: {{names}}", {
                    names: view.poolNames.join(", "),
                  })}
                </p>
              ) : (
                <></>
              )}
              <XcpNgNoticeList notices={view.notices} className="mt-3" />
            </div>
          ) : (
            <></>
          )}

          {view.phase === XcpNgConnectionTestPhase.Failed ? (
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
              {view.certificate ? (
                <CertificateDetails
                  certificate={view.certificate}
                  trustHint={getXcpNgTrustHint(props.input.connectionType)}
                  onTrust={
                    props.onTrustCertificate
                      ? () => {
                          props.onTrustCertificate?.(
                            view.certificate!.fingerprint256,
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

export default XcpNgConnectionTestPanel;
