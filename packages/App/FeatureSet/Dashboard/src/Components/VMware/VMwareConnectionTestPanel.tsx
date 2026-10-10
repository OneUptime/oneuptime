import VMwareVCenterConnectionTest from "Common/Models/DatabaseModels/VMwareVCenterConnectionTest";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { VMwarePresentedCertificate } from "Common/Types/VMware/VMwareProbeCollection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Loader, { LoaderType } from "Common/UI/Components/Loader/Loader";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import OneUptimeDate from "Common/Types/Date";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  VMWARE_TEST_MAX_WAIT_IN_MS,
  VMWARE_TEST_POLL_INTERVAL_IN_MS,
  VMwareConnectionTestInput,
  VMwareConnectionTestPhase,
  VMwareConnectionTestView,
  getVMwareConnectionTestBlocker,
  getVMwareConnectionTestView,
  isVMwareConnectionTestSettled,
} from "./VMwareProbeCollectionView";

/*
 * "Test connection": the address, account and certificate on the form,
 * tried by the probe picked on it - before anything is saved. A test of a
 * vCenter that is already set up may leave the password out: the server
 * then uses the saved one, for the address, probe and certificate it was
 * saved for.
 *
 * When vCenter shows a certificate the probe does not trust - vCenter's own
 * VMCA certificate, by default - the result shows it, and "Trust this
 * certificate" puts its fingerprint on the form. Nothing is ever sent to a
 * certificate nobody trusted.
 */

export interface ComponentProps {
  input: VMwareConnectionTestInput;
  // Puts the fingerprint vCenter presented on the form.
  onTrustCertificate?: ((fingerprint: string) => void) | undefined;
  dataTestId?: string | undefined;
}

const CertificateDetails: FunctionComponent<{
  certificate: VMwarePresentedCertificate;
  onTrust?: (() => void) | undefined;
}> = (props: {
  certificate: VMwarePresentedCertificate;
  onTrust?: (() => void) | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  const rows: Array<{ label: string; value: string }> = [
    {
      label: translator.translateText("Issued to") as string,
      value: props.certificate.subject || "—",
    },
    {
      label: translator.translateText("Issued by") as string,
      value: props.certificate.issuer || "—",
    },
  ];

  if (props.certificate.validTo) {
    rows.push({
      label: translator.translateText("Valid until") as string,
      value: OneUptimeDate.getDateAsLocalFormattedString(
        new Date(props.certificate.validTo),
        true,
      ),
    });
  }

  return (
    <div className="mt-3 rounded-md border border-gray-200 bg-white p-3">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {rows.map((row: { label: string; value: string }) => {
          return (
            <div key={row.label} className="sm:col-span-1">
              <dt className="text-gray-500">{row.label}</dt>
              <dd className="break-words text-gray-900">{row.value}</dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-2 text-xs">
        <div className="text-gray-500">
          {translator.translateText("SHA-256 fingerprint")}
        </div>
        <code
          className="block break-all font-mono text-gray-900"
          data-testid="vmware-presented-fingerprint"
        >
          {props.certificate.fingerprint256}
        </code>
      </div>
      {props.onTrust ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            title="Trust this certificate"
            buttonStyle={ButtonStyleType.OUTLINE}
            buttonSize={ButtonSize.Small}
            icon={IconProp.ShieldCheck}
            dataTestId="vmware-trust-certificate-button"
            onClick={props.onTrust}
          />
          <span className="text-xs text-gray-500">
            {translator.translateText(
              "Check the fingerprint against vCenter's certificate first: in the vSphere Client, Administration > Certificates.",
            )}
          </span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const VMwareConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [test, setTest] = useState<VMwareVCenterConnectionTest | null>(null);
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
    new VMwareVCenterConnectionTest(),
    ModelAction.Create,
  ).isAllowed;

  const blocker: string | null = getVMwareConnectionTestBlocker(props.input);

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
        const latest: VMwareVCenterConnectionTest | null =
          await ModelAPI.getItem({
            modelType: VMwareVCenterConnectionTest,
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

          if (isVMwareConnectionTestSettled(latest.status)) {
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

      if (Date.now() - startedAt > VMWARE_TEST_MAX_WAIT_IN_MS) {
        setError(
          translator.translateText(
            "The test did not finish. Check that the probe is connected, then test again.",
          ) as string,
        );
        return;
      }

      poll(testId, run, startedAt);
    }, VMWARE_TEST_POLL_INTERVAL_IN_MS);
  };

  const startTest: () => Promise<void> = async (): Promise<void> => {
    stopPolling();
    const run: number = ++runRef.current;

    setError("");
    setTest(null);
    setIsStarting(true);

    try {
      const model: VMwareVCenterConnectionTest =
        new VMwareVCenterConnectionTest();
      model.vcenterUrl = props.input.vcenterUrl.trim();
      model.vcenterUsername = props.input.vcenterUsername.trim();
      model.probeId = new ObjectID(props.input.probeId);

      if (props.input.vcenterPassword) {
        model.vcenterPassword = props.input.vcenterPassword;
      }

      if (props.input.trustedCertificateFingerprint.trim()) {
        model.trustedCertificateFingerprint =
          props.input.trustedCertificateFingerprint.trim();
      }

      if (props.input.vmwareVCenterId) {
        model.vmwareVCenterId = props.input.vmwareVCenterId;
      }

      const response: HTTPResponse<VMwareVCenterConnectionTest> =
        (await ModelAPI.create({
          model: model,
          modelType: VMwareVCenterConnectionTest,
        })) as HTTPResponse<VMwareVCenterConnectionTest>;

      if (run !== runRef.current) {
        return;
      }

      const created: VMwareVCenterConnectionTest = response.data;
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

      const pending: VMwareVCenterConnectionTest =
        new VMwareVCenterConnectionTest();
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

  const view: VMwareConnectionTestView | null = test
    ? getVMwareConnectionTestView(test, translator)
    : null;
  const isRunning: boolean =
    isStarting ||
    Boolean(
      view &&
        (view.phase === VMwareConnectionTestPhase.Waiting ||
          view.phase === VMwareConnectionTestPhase.Running) &&
        !error,
    );

  return (
    <div
      className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={props.dataTestId || "vmware-connection-test"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="text-xs text-gray-500">
            {translator.translateText(
              "The probe logs in to vCenter with these settings, reads what the account can see, and logs out. Nothing is saved.",
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
          dataTestId="vmware-test-connection-button"
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
          <span>{error}</span>
        </div>
      ) : (
        <></>
      )}

      {view && !error ? (
        <div className="mt-3" role="status" data-testid="vmware-test-result">
          {view.phase === VMwareConnectionTestPhase.Waiting ||
          view.phase === VMwareConnectionTestPhase.Running ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Loader loaderType={LoaderType.Beats} size={16} />
              <span>{view.title}</span>
            </div>
          ) : (
            <></>
          )}

          {view.phase === VMwareConnectionTestPhase.Succeeded ? (
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
            </div>
          ) : (
            <></>
          )}

          {view.phase === VMwareConnectionTestPhase.Failed ? (
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

export { CertificateDetails };

export default VMwareConnectionTestPanel;
