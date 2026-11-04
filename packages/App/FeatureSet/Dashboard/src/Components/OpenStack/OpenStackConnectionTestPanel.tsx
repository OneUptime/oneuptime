import OpenStackCloudConnectionTest from "Common/Models/DatabaseModels/OpenStackCloudConnectionTest";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackPresentedCertificate } from "Common/Types/OpenStack/OpenStackProbeCollection";
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
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  OPENSTACK_TEST_MAX_WAIT_IN_MS,
  OPENSTACK_TEST_POLL_INTERVAL_IN_MS,
  OpenStackConnectionTestInput,
  OpenStackConnectionTestPhase,
  OpenStackConnectionTestView,
  OpenStackTestReadRow,
  getOpenStackConnectionTestBlocker,
  getOpenStackConnectionTestView,
  isOpenStackConnectionTestSettled,
} from "./OpenStackProbeCollectionView";

/*
 * "Test connection": the address, credential, regions and certificates on the form, tried by
 * the probe picked on it, before anything is saved. A test of a cloud that is already set up
 * may leave the secret out: the server then uses the saved one, for the address, probe and
 * certificates it was saved for.
 *
 * It says exactly what failed. A login that fails names why, and one that works lists each
 * read that did not answer in full, what goes without it and the line that opens it.
 *
 * When an API shows a certificate the probe does not trust, the result shows it and "Trust
 * this certificate" adds its fingerprint to the form. Nothing is ever sent to a certificate
 * nobody trusted. And an address on plain HTTP is never tried: it says to turn on TLS or use
 * the agent, because a credential does not go there over a probe.
 */

export interface ComponentProps {
  input: OpenStackConnectionTestInput;
  // Adds the fingerprint an API presented to what is trusted.
  onTrustCertificate?: ((fingerprint: string) => void) | undefined;
  // Picks the regions the catalog names.
  onUseRegions?: ((regions: Array<string>) => void) | undefined;
  dataTestId?: string | undefined;
}

export const OpenStackCertificateDetails: FunctionComponent<{
  certificate: OpenStackPresentedCertificate;
  onTrust?: (() => void) | undefined;
}> = (props: {
  certificate: OpenStackPresentedCertificate;
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

  // A cloud can have a host per service, so this may be one service's alone.
  if (props.certificate.host) {
    rows.push({
      label: translator.translateText("Presented by") as string,
      value: props.certificate.port
        ? `${props.certificate.host}:${props.certificate.port}`
        : props.certificate.host,
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
          data-testid="openstack-presented-fingerprint"
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
            dataTestId="openstack-trust-certificate-button"
            onClick={props.onTrust}
          />
          <span className="text-xs text-gray-500">
            {translator.translateText(
              "Check the fingerprint against the API's own certificate first.",
            )}
          </span>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const ReadRow: FunctionComponent<{ row: OpenStackTestReadRow }> = (props: {
  row: OpenStackTestReadRow;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const isBad: boolean =
    props.row.access === "Failing" || props.row.access === "Refused";

  return (
    <li
      className="py-2"
      data-testid="openstack-test-read"
      data-access={props.row.access}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${
            isBad
              ? "bg-red-50 text-red-700 ring-red-200"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          }`}
        >
          {props.row.label}
        </span>
        <span className="break-words text-sm text-gray-900">
          {props.row.title}
        </span>
      </div>
      {props.row.reason ? (
        <p className="mt-1 break-words text-xs text-gray-600">
          {props.row.reason}
        </p>
      ) : (
        <></>
      )}
      {props.row.goesWithout ? (
        <p className="mt-1 break-words text-xs text-gray-600">
          {translator.translateTemplate("Goes without it: {{what}}", {
            what: props.row.goesWithout,
          })}
        </p>
      ) : (
        <></>
      )}
      {props.row.fix ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-600">
          {translator.translateTemplate("What opens it: {{fix}}", {
            fix: props.row.fix,
          })}
        </p>
      ) : (
        <></>
      )}
    </li>
  );
};

// What the probe found, on a test that worked and on one that stopped part of the way.
const FoundDetails: FunctionComponent<{
  view: OpenStackConnectionTestView;
  regionsOnForm: Array<string>;
  onUseRegions?: ((regions: Array<string>) => void) | undefined;
}> = (props: {
  view: OpenStackConnectionTestView;
  regionsOnForm: Array<string>;
  onUseRegions?: ((regions: Array<string>) => void) | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { view } = props;

  const isRegionsOnForm: boolean =
    view.regionsInCatalog.length === props.regionsOnForm.length &&
    view.regionsInCatalog.every((region: string): boolean => {
      return props.regionsOnForm.includes(region);
    });

  return (
    <Fragment>
      {view.credentialLine ? (
        <p className="mt-2 break-words text-xs text-gray-600">
          {view.credentialLine}
        </p>
      ) : (
        <></>
      )}

      {view.regionsInCatalog.length > 0 ? (
        <div className="mt-3" data-testid="openstack-test-regions">
          <div className="text-xs text-gray-500">
            {translator.translateText("Regions the catalog names")}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {view.regionsInCatalog.map((region: string) => {
              return (
                <span
                  key={region}
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800 ring-1 ring-inset ring-gray-200"
                >
                  {region}
                </span>
              );
            })}
            {props.onUseRegions && !isRegionsOnForm ? (
              <Button
                title="Use these regions"
                buttonStyle={ButtonStyleType.OUTLINE}
                buttonSize={ButtonSize.Small}
                dataTestId="openstack-use-regions-button"
                onClick={() => {
                  props.onUseRegions?.(view.regionsInCatalog);
                }}
              />
            ) : (
              <></>
            )}
          </div>
        </div>
      ) : (
        <></>
      )}

      {view.fullReadCount > 0 ? (
        <p
          className="mt-3 text-xs text-gray-600"
          data-testid="openstack-test-full-reads"
        >
          {translator.translatePlural(
            {
              one: "{{count}} read answered in full.",
              other: "{{count}} reads answered in full.",
            },
            view.fullReadCount,
          )}
        </p>
      ) : (
        <></>
      )}

      {view.reads.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-gray-700">
            {translator.translateText("What did not answer in full")}
          </div>
          <ul className="mt-1 divide-y divide-gray-200">
            {view.reads.map((row: OpenStackTestReadRow) => {
              return <ReadRow key={row.key} row={row} />;
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}

      {view.warnings.length > 0 ? (
        <div className="mt-3" data-testid="openstack-test-warnings">
          <div className="text-xs font-medium text-gray-700">
            {translator.translateText("Worth knowing")}
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
            {view.warnings.map((warning: string) => {
              return (
                <li key={warning} className="break-words">
                  {warning}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

const OpenStackConnectionTestPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [test, setTest] = useState<OpenStackCloudConnectionTest | null>(null);
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
    new OpenStackCloudConnectionTest(),
    ModelAction.Create,
  ).isAllowed;

  const blocker: string | null = getOpenStackConnectionTestBlocker(props.input);

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
        const latest: OpenStackCloudConnectionTest | null =
          await ModelAPI.getItem({
            modelType: OpenStackCloudConnectionTest,
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

          if (isOpenStackConnectionTestSettled(latest.status)) {
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

      if (Date.now() - startedAt > OPENSTACK_TEST_MAX_WAIT_IN_MS) {
        setError(
          translator.translateText(
            "The test did not finish. Check that the probe is connected, then test again.",
          ) as string,
        );
        return;
      }

      poll(testId, run, startedAt);
    }, OPENSTACK_TEST_POLL_INTERVAL_IN_MS);
  };

  const startTest: () => Promise<void> = async (): Promise<void> => {
    stopPolling();
    const run: number = ++runRef.current;
    const input: OpenStackConnectionTestInput = props.input;

    setError("");
    setTest(null);
    setIsStarting(true);

    try {
      const model: OpenStackCloudConnectionTest =
        new OpenStackCloudConnectionTest();
      model.authUrl = input.authUrl.trim();
      model.endpointInterface = input.endpointInterface;
      model.collectionRegions = input.regions;
      model.probeId = new ObjectID(input.probeId);
      model.trustedCertificateFingerprints =
        input.trustedCertificateFingerprints;

      /*
       * A secret goes with what names it, on the form. With none, the server uses what the
       * cloud has saved, names and all.
       */
      if (input.credentialSecret) {
        model.credentialSecret = input.credentialSecret;

        if (input.credentialKind === "password") {
          model.keystoneUsername = input.keystoneUsername.trim();
          model.userDomainName = input.userDomainName.trim();
          model.projectName = input.projectName.trim();
          model.projectDomainName = input.projectDomainName.trim();
        } else {
          model.applicationCredentialId = input.applicationCredentialId.trim();
        }
      }

      if (input.openStackCloudId) {
        model.openStackCloudId = input.openStackCloudId;
      }

      const response: HTTPResponse<OpenStackCloudConnectionTest> =
        (await ModelAPI.create({
          model: model,
          modelType: OpenStackCloudConnectionTest,
        })) as HTTPResponse<OpenStackCloudConnectionTest>;

      if (run !== runRef.current) {
        return;
      }

      const created: OpenStackCloudConnectionTest = response.data;
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

      setTest(new OpenStackCloudConnectionTest());
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

  const view: OpenStackConnectionTestView | null = test
    ? getOpenStackConnectionTestView(test, translator)
    : null;
  const isRunning: boolean =
    isStarting ||
    Boolean(
      view &&
        (view.phase === OpenStackConnectionTestPhase.Waiting ||
          view.phase === OpenStackConnectionTestPhase.Running) &&
        !error,
    );

  return (
    <div
      className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid={props.dataTestId || "openstack-connection-test"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {translator.translateText("Test the connection")}
          </div>
          <div className="text-xs text-gray-500">
            {translator.translateText(
              "The probe logs in to Keystone with these settings, tries each read a collection makes in each region, and logs out. Nothing is saved.",
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
          dataTestId="openstack-test-connection-button"
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
        <div className="mt-3" role="status" data-testid="openstack-test-result">
          {view.phase === OpenStackConnectionTestPhase.Waiting ||
          view.phase === OpenStackConnectionTestPhase.Running ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Loader loaderType={LoaderType.Beats} size={16} />
              <span>{view.title}</span>
            </div>
          ) : (
            <></>
          )}

          {view.phase === OpenStackConnectionTestPhase.Succeeded ? (
            <div className="text-sm text-emerald-800">
              <div className="flex items-start gap-2">
                <Icon
                  icon={IconProp.CheckCircle}
                  className="mt-0.5 h-4 w-4 flex-none text-emerald-600"
                />
                <span className="font-medium">{view.title}</span>
              </div>
              <FoundDetails
                view={view}
                regionsOnForm={props.input.regions}
                onUseRegions={props.onUseRegions}
              />
            </div>
          ) : (
            <></>
          )}

          {view.phase === OpenStackConnectionTestPhase.Failed ? (
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
                <OpenStackCertificateDetails
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
              <FoundDetails
                view={view}
                regionsOnForm={props.input.regions}
                onUseRegions={props.onUseRegions}
              />
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

export default OpenStackConnectionTestPanel;
