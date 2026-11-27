import Probe from "Common/Models/DatabaseModels/Probe";
import XcpNgConnection from "Common/Models/DatabaseModels/XcpNgConnection";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import XcpNgConnectionType from "Common/Types/XcpNg/XcpNgConnectionType";
import { XcpNgCollectionSummary } from "Common/Types/XcpNg/XcpNgProbeCollection";
import XcpNgXapiAccountKind from "Common/Types/XcpNg/XcpNgXapiAccount";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProbeUtil from "../../Utils/Probe";
import { getNextClaimWords } from "../Probe/NextClaimWords";
import { CertificateDetails } from "../VMware/VMwareConnectionTestPanel";
import {
  XCP_NG_CONNECTION_EDIT_FORM_STEPS,
  getXcpNgConnectionEditFormFields,
} from "./XcpNgConnectionFormFields";
import XcpNgConnectionTestPanel from "./XcpNgConnectionTestPanel";
import {
  XCP_NG_STATUS_POLL_INTERVAL_IN_MS,
  XcpNgCollectionStatusView,
  XcpNgCollectionTone,
  XcpNgNotice,
  getXcpNgAccountNotice,
  getXcpNgApiTokenExpiryNotice,
  getXcpNgApiTokenProblemNotice,
  getXcpNgCollectionDescription,
  getXcpNgCollectionStatusView,
  getXcpNgConnectionTypeLabel,
  getXcpNgNextCollection,
  getXcpNgProductLine,
  getXcpNgTrustHint,
} from "./XcpNgConnectionView";
import XcpNgNoticeList from "./XcpNgNoticeList";

/*
 * How an XCP-ng connection is doing, at the top of its page: is the probe
 * reading it, and if not, exactly why and the one thing that fixes it -
 * "Trust this certificate" right here, for a certificate the probe found
 * and nobody trusted yet. Then what its API token or its XAPI account may
 * do, when that needs saying, and how it is set up, with Test Connection
 * and Edit Connection.
 */

export interface ComponentProps {
  modelId: ObjectID;
  // Called after a change, so the page's other cards read it again.
  onChanged?: (() => void) | undefined;
}

function badgeTypeOf(tone: XcpNgCollectionTone): StatusBadgeType {
  switch (tone) {
    case XcpNgCollectionTone.Collecting:
      return StatusBadgeType.Success;
    case XcpNgCollectionTone.Failing:
      return StatusBadgeType.Danger;
    default:
      return StatusBadgeType.Info;
  }
}

const Fact: FunctionComponent<{
  label: string;
  children: ReactElement | string;
  testId?: string | undefined;
}> = (props: {
  label: string;
  children: ReactElement | string;
  testId?: string | undefined;
}): ReactElement => {
  return (
    <div className="min-w-0">
      <dt className="text-gray-500">{props.label}</dt>
      <dd className="break-words text-gray-900" data-testid={props.testId}>
        {props.children}
      </dd>
    </div>
  );
};

const XcpNgConnectionStatusCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [connection, setConnection] = useState<XcpNgConnection | null>(null);
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isRemovingToken, setIsRemovingToken] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const [item, allProbes]: [XcpNgConnection | null, Array<Probe>] =
      await Promise.all([
        ModelAPI.getItem({
          modelType: XcpNgConnection,
          id: props.modelId,
          select: {
            name: true,
            connectionType: true,
            address: true,
            username: true,
            isOpenMetricsSecretSet: true,
            isApiTokenSet: true,
            apiTokenExpiresAt: true,
            isPasswordSet: true,
            credentialsUpdatedAt: true,
            trustedCertificateFingerprint: true,
            collectionIntervalInMinutes: true,
            collectionStatus: true,
            collectionErrorCode: true,
            collectionError: true,
            presentedCertificate: true,
            collectionSummary: true,
            lastCollectionAt: true,
            lastSuccessfulCollectionAt: true,
            xapiMasterAddress: true,
            // What decides whether a probe may read it (XcpNgCollectionStop).
            projectId: true,
            nextCollectionAt: true,
            collectionProbeId: true,
            collectionProbe: {
              name: true,
              isGlobalProbe: true,
              projectId: true,
              connectionStatus: true,
            },
          },
        }),
        ProbeUtil.getAllProbes().catch((): Array<Probe> => {
          // The edit form then offers no probe, and says how to add one.
          return [];
        }),
      ]);

    setConnection(item);
    setProbes(allProbes);
  };

  const reload: () => void = (): void => {
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  useEffect(() => {
    setIsLoading(true);
    reload();
  }, [props.modelId.toString()]);

  const view: XcpNgCollectionStatusView | null = connection
    ? getXcpNgCollectionStatusView(
        connection,
        translator,
        new Date(),
        BILLING_ENABLED,
      )
    : null;

  // Ask again while the probe has the new settings and has not answered yet.
  useEffect(() => {
    if (!view?.isPending) {
      return undefined;
    }

    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      load().catch(() => {
        // A failed background read keeps what the card shows.
      });
    }, XCP_NG_STATUS_POLL_INTERVAL_IN_MS);

    return () => {
      clearInterval(timer);
    };
  }, [view?.isPending]);

  if (isLoading) {
    return <DetailListSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!connection || !view) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new XcpNgConnection(),
    ModelAction.Update,
  ).isAllowed;
  const connectionType: XcpNgConnectionType =
    connection.connectionType === XcpNgConnectionType.Xapi
      ? XcpNgConnectionType.Xapi
      : XcpNgConnectionType.XenOrchestra;
  const isXapi: boolean = connectionType === XcpNgConnectionType.Xapi;
  const summary: XcpNgCollectionSummary | undefined =
    connection.collectionSummary;

  const afterChange: () => void = (): void => {
    setIsEditing(false);
    setIsTesting(false);
    setIsRemovingToken(false);
    reload();
    props.onChanged?.();
  };

  const save: (data: JSONObject) => void = (data: JSONObject): void => {
    setIsSaving(true);
    setSaveError("");
    ModelAPI.updateById({
      modelType: XcpNgConnection,
      id: props.modelId,
      data: data,
    })
      .then(() => {
        afterChange();
      })
      .catch((err: Error) => {
        setSaveError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const buttons: Array<CardButtonSchema> = [];

  if (canEdit) {
    buttons.push(
      {
        title: "Test Connection",
        buttonStyle: ButtonStyleType.OUTLINE,
        icon: IconProp.Play,
        onClick: () => {
          setSaveError("");
          setIsTesting(true);
        },
      },
      {
        title: "Edit Connection",
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Edit,
        onClick: () => {
          setIsEditing(true);
        },
      },
    );
  }

  // What its token or account may do, and when the token runs out.
  const notices: Array<XcpNgNotice> = [];
  const expiryNotice: XcpNgNotice | null = getXcpNgApiTokenExpiryNotice(
    connection,
    translator,
  );
  const tokenNotice: XcpNgNotice | null = connection.isApiTokenSet
    ? getXcpNgApiTokenProblemNotice(summary?.apiToken, translator)
    : null;
  const accountNotice: XcpNgNotice | null = isXapi
    ? getXcpNgAccountNotice(summary?.account, translator)
    : null;

  for (const notice of [expiryNotice, tokenNotice, accountNotice]) {
    if (notice) {
      notices.push(notice);
    }
  }

  const warnings: Array<string> = summary?.warnings || [];
  const product: string | null = isXapi ? getXcpNgProductLine(summary) : null;
  const notSaved: ReactElement = (
    <span className="text-red-700">
      {translator.translateText("Not saved")}
    </span>
  );
  const saved: ReactElement = (
    <span>
      {connection.credentialsUpdatedAt
        ? translator.translateTemplate("Saved {{time}}", {
            time: OneUptimeDate.fromNow(connection.credentialsUpdatedAt),
          })
        : translator.translateText("Saved")}
    </span>
  );

  return (
    <Fragment>
      <Card
        // The connection's own name, as it was typed: never looked up.
        title={
          <span data-testid="xcp-ng-connection-name">
            <bdi>{connection.name || connection.address || ""}</bdi>
          </span>
        }
        description={getXcpNgCollectionDescription(
          connection,
          translator,
          new Date(),
          BILLING_ENABLED,
        )}
        rightElement={
          <StatusBadge text={view.label} type={badgeTypeOf(view.tone)} />
        }
        buttons={buttons}
      >
        <div
          className="space-y-4 text-sm"
          data-testid="xcp-ng-connection-status"
        >
          <div className="flex items-start gap-2">
            <Icon
              icon={
                view.tone === XcpNgCollectionTone.Failing
                  ? IconProp.Alert
                  : view.tone === XcpNgCollectionTone.Collecting
                    ? IconProp.CheckCircle
                    : IconProp.Clock
              }
              className={`mt-0.5 h-4 w-4 flex-none ${
                view.tone === XcpNgCollectionTone.Failing
                  ? "text-red-600"
                  : view.tone === XcpNgCollectionTone.Collecting
                    ? "text-emerald-600"
                    : "text-indigo-600"
              }`}
            />
            <div className="min-w-0">
              <div className="font-medium text-gray-900">{view.title}</div>
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
            </div>
          </div>

          {view.certificate ? (
            <CertificateDetails
              certificate={view.certificate}
              trustHint={getXcpNgTrustHint(connectionType)}
              onTrust={
                canEdit && !isSaving
                  ? () => {
                      save({
                        trustedCertificateFingerprint:
                          view.certificate!.fingerprint256,
                      });
                    }
                  : undefined
              }
            />
          ) : (
            <></>
          )}

          {saveError && !isTesting && !isRemovingToken ? (
            <p className="text-red-700" role="alert">
              <ErrorInSentence message={saveError} showWhereToLook={true} />
            </p>
          ) : (
            <></>
          )}

          <XcpNgNoticeList notices={notices} />

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
            <Fact label={translator.translateText("Reads") as string}>
              {getXcpNgConnectionTypeLabel(connectionType, translator)}
            </Fact>
            <Fact
              label={
                (isXapi
                  ? translator.translateText("Pool master")
                  : translator.translateText("Address")) as string
              }
            >
              <bdi className="font-mono">
                {(isXapi && connection.xapiMasterAddress) ||
                  connection.address ||
                  ""}
              </bdi>
            </Fact>
            <Fact
              label={translator.translateText("Probe") as string}
              testId="xcp-ng-connection-probe"
            >
              {connection.collectionProbe?.name ||
                connection.collectionProbeId?.toString() ||
                (translator.translateText("None") as string)}
            </Fact>
            {isXapi ? (
              <Fragment>
                <Fact label={translator.translateText("User Name") as string}>
                  {connection.username || ""}
                </Fact>
                <Fact label={translator.translateText("Password") as string}>
                  {connection.isPasswordSet ? saved : notSaved}
                </Fact>
                <Fact label={translator.translateText("Access") as string}>
                  {summary?.account
                    ? summary.account.kind === XcpNgXapiAccountKind.ReadOnly
                      ? (translator.translateText("Read-only") as string)
                      : (translator.translateText(
                          "Can change the pool",
                        ) as string)
                    : (translator.translateText("Not read yet") as string)}
                </Fact>
              </Fragment>
            ) : (
              <Fragment>
                <Fact
                  label={
                    translator.translateText("OpenMetrics Secret") as string
                  }
                >
                  {connection.isOpenMetricsSecretSet ? saved : notSaved}
                </Fact>
                <Fact
                  label={translator.translateText("API Token") as string}
                  testId="xcp-ng-connection-api-token"
                >
                  {connection.isApiTokenSet
                    ? connection.apiTokenExpiresAt
                      ? translator.translateTemplate(
                          "Saved, expires {{time}}",
                          {
                            time: OneUptimeDate.fromNow(
                              connection.apiTokenExpiresAt,
                            ),
                          },
                        )
                      : saved
                    : (translator.translateText("None") as string)}
                </Fact>
                <Fact
                  label={
                    translator.translateText("Trusted Certificate") as string
                  }
                >
                  {connection.trustedCertificateFingerprint ? (
                    <code className="break-all font-mono">
                      {connection.trustedCertificateFingerprint}
                    </code>
                  ) : (
                    (translator.translateText(
                      "Any certificate from an authority the probe trusts",
                    ) as string)
                  )}
                </Fact>
              </Fragment>
            )}
            <Fact label={translator.translateText("Last collection") as string}>
              {connection.lastCollectionAt
                ? OneUptimeDate.fromNow(connection.lastCollectionAt)
                : (translator.translateText("Not yet") as string)}
            </Fact>
            <Fact
              label={
                translator.translateText("Last successful collection") as string
              }
            >
              {connection.lastSuccessfulCollectionAt
                ? OneUptimeDate.fromNow(connection.lastSuccessfulCollectionAt)
                : (translator.translateText("Not yet") as string)}
            </Fact>
            <Fact
              label={translator.translateText("Next collection") as string}
              testId="xcp-ng-next-collection"
            >
              {getNextClaimWords(
                getXcpNgNextCollection(connection, new Date(), BILLING_ENABLED),
                translator,
              )}
            </Fact>
            {product ? (
              <Fact
                label={translator.translateText("XCP-ng version") as string}
              >
                {product}
              </Fact>
            ) : (
              <></>
            )}
          </dl>

          {warnings.length > 0 &&
          view.tone === XcpNgCollectionTone.Collecting ? (
            <div className="text-xs text-gray-600">
              <div className="font-medium text-gray-700">
                {translator.translateText("Left out of the last collection:")}
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {warnings.map((warning: string) => {
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

          {canEdit && !isXapi && connection.isApiTokenSet ? (
            <div>
              <button
                type="button"
                className="text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
                data-testid="xcp-ng-remove-api-token"
                onClick={() => {
                  setSaveError("");
                  setIsRemovingToken(true);
                }}
              >
                {translator.translateText("Remove the API token")}
              </button>
            </div>
          ) : (
            <></>
          )}
        </div>
      </Card>

      {isEditing ? (
        <ModelFormModal<XcpNgConnection>
          modelType={XcpNgConnection}
          modelIdToEdit={props.modelId}
          name="Edit Connection"
          title="Edit Connection"
          description="Changing the address, the probe or the trusted certificate needs the secrets again: a saved secret is only sent where it was entered for."
          modalWidth={ModalWidth.Medium}
          submitButtonText="Save Changes"
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={afterChange}
          formProps={{
            name: "Edit Connection",
            modelType: XcpNgConnection,
            id: "xcp-ng-connection-form",
            steps: XCP_NG_CONNECTION_EDIT_FORM_STEPS,
            fields: getXcpNgConnectionEditFormFields({
              probes: probes,
              isBillingEnabled: BILLING_ENABLED,
              translator: translator,
              xcpNgConnectionId: props.modelId,
              connectionType: connectionType,
            }),
            formType: FormType.Update,
          }}
        />
      ) : (
        <></>
      )}

      {isTesting ? (
        <Modal
          title="Test Connection"
          description="The probe reads the connection with its saved settings and secrets, and reports what it found. Nothing is changed."
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setIsTesting(false);
          }}
          closeButtonText="Close"
        >
          <XcpNgConnectionTestPanel
            input={{
              connectionType: connectionType,
              address: connection.address || "",
              probeId: connection.collectionProbeId?.toString() || "",
              trustedCertificateFingerprint:
                connection.trustedCertificateFingerprint || "",
              openMetricsSecret: "",
              apiToken: "",
              username: connection.username || "",
              password: "",
              xcpNgConnectionId: props.modelId,
            }}
            onTrustCertificate={(fingerprint: string) => {
              save({ trustedCertificateFingerprint: fingerprint });
            }}
          />
          {saveError ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              <ErrorInSentence message={saveError} showWhereToLook={true} />
            </p>
          ) : (
            <></>
          )}
        </Modal>
      ) : (
        <></>
      )}

      {isRemovingToken ? (
        <ConfirmModal
          title="Remove the API Token"
          description="The token is deleted from OneUptime. Metrics keep coming through the OpenMetrics secret. Revoke it in Xen Orchestra too if nothing else uses it."
          submitButtonText="Remove Token"
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsRemovingToken(false);
          }}
          onSubmit={() => {
            save({ apiToken: null });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default XcpNgConnectionStatusCard;
