import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ProbeUtil from "../../Utils/Probe";
import StorageArrayConnectionArraysCard from "../../Components/StorageArray/Connection/StorageArrayConnectionArraysCard";
import {
  STORAGE_ARRAY_CONNECTION_FORM_STEPS,
  getStorageArrayConnectionEditFormFields,
} from "../../Components/StorageArray/Connection/StorageArrayConnectionFormFields";
import StorageArrayConnectionStatusCard from "../../Components/StorageArray/Connection/StorageArrayConnectionStatusCard";
import StorageArrayConnectionTestPanel from "../../Components/StorageArray/Connection/StorageArrayConnectionTestPanel";
import {
  STORAGE_ARRAY_STATUS_POLL_INTERVAL_IN_MS,
  StorageArrayCollectionStatusView,
  getCollector,
  getStorageArrayCollectionStatusView,
} from "../../Components/StorageArray/Connection/StorageArrayConnectionView";
import Probe from "Common/Models/DatabaseModels/Probe";
import StorageArrayConnection from "Common/Models/DatabaseModels/StorageArrayConnection";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { StorageArrayProbeCollector } from "Common/Types/StorageArray/Collection/StorageArrayProbeCollector";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import EmptyValue from "Common/UI/Components/Detail/EmptyValue";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import DetailListSkeleton from "Common/UI/Components/Skeleton/DetailListSkeleton";
import FieldType from "Common/UI/Components/Types/FieldType";
import { BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
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

/*
 * ONE STORAGE ARRAY CONNECTION'S PAGE (#11004): how its collection is
 * doing and the one thing that fixes it (Data Collection), the arrays it
 * found (Arrays), and how the probe reaches and logs in to it
 * (Connection), with Test Connection and Edit Connection - the form it was
 * connected with. Delete is last.
 *
 * While the probe has new settings it has not answered yet, the page asks
 * again every ten seconds.
 */

const StorageArrayConnectionView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());
  const [connection, setConnection] = useState<StorageArrayConnection | null>(
    null,
  );
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isTrusting, setIsTrusting] = useState<boolean>(false);
  const [trustError, setTrustError] = useState<string>("");
  const [detailRefresher, setDetailRefresher] = useState<boolean>(false);

  const load: () => Promise<void> = async (): Promise<void> => {
    const item: StorageArrayConnection | null = await ModelAPI.getItem({
      modelType: StorageArrayConnection,
      id: modelId,
      select: {
        name: true,
        storageSystem: true,
        address: true,
        username: true,
        projectId: true,
        isPasswordSet: true,
        collectionIntervalInMinutes: true,
        trustedCertificateFingerprint: true,
        collectionStatus: true,
        collectionErrorCode: true,
        collectionError: true,
        presentedCertificate: true,
        collectionSummary: true,
        nextCollectionAt: true,
        lastCollectionAt: true,
        lastSuccessfulCollectionAt: true,
        collectionProbeId: true,
        collectionProbe: {
          name: true,
          isGlobalProbe: true,
          projectId: true,
          connectionStatus: true,
        },
      },
    });
    setConnection(item);
  };

  useEffect(() => {
    Promise.all([
      load(),
      ProbeUtil.getAllProbes().then((allProbes: Array<Probe>) => {
        setProbes(allProbes);
      }),
    ])
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [modelId.toString()]);

  const collector: StorageArrayProbeCollector = getCollector(
    connection?.storageSystem,
  );

  const view: StorageArrayCollectionStatusView | null = connection
    ? getStorageArrayCollectionStatusView(
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
        // A failed background read keeps what the page shows.
      });
    }, STORAGE_ARRAY_STATUS_POLL_INTERVAL_IN_MS);
    return () => {
      clearInterval(timer);
    };
  }, [view?.isPending]);

  const reloadAll: () => void = (): void => {
    setDetailRefresher((value: boolean) => {
      return !value;
    });
    load().catch((err: Error) => {
      setError(API.getFriendlyErrorMessage(err));
    });
  };

  const trustCertificate: (fingerprint: string) => Promise<void> = async (
    fingerprint: string,
  ): Promise<void> => {
    setIsTrusting(true);
    setTrustError("");
    try {
      await ModelAPI.updateById({
        modelType: StorageArrayConnection,
        id: modelId,
        data: {
          trustedCertificateFingerprint: fingerprint,
        },
      });
      setIsTesting(false);
      reloadAll();
    } catch (err) {
      setTrustError(API.getFriendlyErrorMessage(err as Error));
    } finally {
      setIsTrusting(false);
    }
  };

  if (isLoading) {
    return <DetailListSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!connection || !view) {
    return (
      <ErrorMessage
        message={translator.translateText("Connection not found.") as string}
      />
    );
  }

  const canEdit: boolean = PermissionGate.check(
    new StorageArrayConnection(),
    ModelAction.Update,
  ).isAllowed;

  return (
    <Fragment>
      <StorageArrayConnectionStatusCard
        connection={connection}
        view={view}
        collector={collector}
        canEdit={canEdit}
        isTrusting={isTrusting}
        trustError={isTesting ? "" : trustError}
        onTrustCertificate={(fingerprint: string) => {
          trustCertificate(fingerprint).catch((err: Error) => {
            setTrustError(API.getFriendlyErrorMessage(err));
          });
        }}
      />

      <div className="mt-5">
        <StorageArrayConnectionArraysCard
          storageSystem={collector.storageSystem}
          summary={connection.collectionSummary}
        />
      </div>

      <div className="mt-5">
        <CardModelDetail<StorageArrayConnection>
          name="Storage Array Connection"
          singularName="Connection"
          cardProps={{
            title: "Connection",
            description:
              "How the probe reaches Unisphere and logs in. The password is never shown.",
            buttons: canEdit
              ? [
                  {
                    title: "Test Connection",
                    buttonStyle: ButtonStyleType.OUTLINE,
                    icon: IconProp.Play,
                    onClick: () => {
                      setTrustError("");
                      setIsTesting(true);
                    },
                  },
                ]
              : [],
          }}
          isEditable={true}
          editButtonText="Edit Connection"
          editModalTitle="Edit Connection"
          editModalDescription="Changing the address, the probe or the trusted certificate needs the password again: a saved password is only sent where it was entered for."
          createEditModalWidth={ModalWidth.Medium}
          formSteps={STORAGE_ARRAY_CONNECTION_FORM_STEPS}
          formFields={getStorageArrayConnectionEditFormFields({
            probes: probes,
            isBillingEnabled: BILLING_ENABLED,
            translator: translator,
            collector: collector,
            storageArrayConnectionId: modelId,
          })}
          refresher={detailRefresher}
          onSaveSuccess={() => {
            load().catch((err: Error) => {
              setError(API.getFriendlyErrorMessage(err));
            });
          }}
          modelDetailProps={{
            modelType: StorageArrayConnection,
            id: "storage-array-connection-detail",
            modelId: modelId,
            showDetailsInNumberOfColumns: 2,
            selectMoreFields: {
              credentialsUpdatedAt: true,
            },
            fields: [
              {
                field: {
                  name: true,
                },
                title: "Name",
              },
              {
                field: {
                  address: true,
                },
                title: collector.words.addressTitle,
                fieldType: FieldType.Element,
                getElement: (item: StorageArrayConnection): ReactElement => {
                  return (
                    <span className="break-all font-mono text-sm">
                      {item.address || <EmptyValue />}
                    </span>
                  );
                },
              },
              {
                field: {
                  username: true,
                },
                title: "User Name",
              },
              {
                field: {
                  isPasswordSet: true,
                },
                title: "Password",
                fieldType: FieldType.Element,
                getElement: (item: StorageArrayConnection): ReactElement => {
                  if (!item.isPasswordSet) {
                    return (
                      <span className="text-red-700">
                        {translator.translateText("Not saved")}
                      </span>
                    );
                  }
                  return (
                    <span>
                      {item.credentialsUpdatedAt
                        ? translator.translateTemplate("Saved {{time}}", {
                            time: OneUptimeDate.fromNow(
                              item.credentialsUpdatedAt,
                            ),
                          })
                        : translator.translateText("Saved")}
                    </span>
                  );
                },
              },
              {
                field: {
                  collectionProbe: {
                    name: true,
                  },
                },
                title: "Probe",
                fieldType: FieldType.Element,
                getElement: (item: StorageArrayConnection): ReactElement => {
                  return (
                    <span>
                      {item.collectionProbe?.name ||
                        item.collectionProbeId?.toString() || <EmptyValue />}
                    </span>
                  );
                },
              },
              {
                field: {
                  trustedCertificateFingerprint: true,
                },
                title: "Trusted Certificate",
                fieldType: FieldType.Element,
                getElement: (item: StorageArrayConnection): ReactElement => {
                  return item.trustedCertificateFingerprint ? (
                    <code className="break-all font-mono text-xs">
                      {item.trustedCertificateFingerprint}
                    </code>
                  ) : (
                    <span>
                      {translator.translateText(
                        "Any certificate from an authority the probe trusts",
                      )}
                    </span>
                  );
                },
              },
              {
                field: {
                  collectionIntervalInMinutes: true,
                },
                title: "Collected Every",
                fieldType: FieldType.Element,
                getElement: (item: StorageArrayConnection): ReactElement => {
                  return (
                    <span>
                      {translator.translatePlural(
                        { one: "{{count}} minute", other: "{{count}} minutes" },
                        item.collectionIntervalInMinutes ||
                          collector.collectionInterval.defaultMinutes,
                      )}
                    </span>
                  );
                },
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                placeholder: "No description provided.",
              },
              // On the card's ID line, for the API and Terraform.
              {
                field: {
                  _id: true,
                },
                title: "ID",
                fieldType: FieldType.ObjectID,
              },
            ],
          }}
        />
      </div>

      {isTesting ? (
        <Modal
          title="Test Connection"
          description="The probe logs in to Unisphere with the saved settings and password, reads what the account can see on each array, and leaves."
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setIsTesting(false);
          }}
          closeButtonText="Close"
        >
          <StorageArrayConnectionTestPanel
            input={{
              storageSystem: collector.storageSystem,
              address: connection.address || "",
              username: connection.username || "",
              password: "",
              probeId: connection.collectionProbeId?.toString() || "",
              trustedCertificateFingerprint:
                connection.trustedCertificateFingerprint || "",
              storageArrayConnectionId: modelId,
            }}
            collector={collector}
            startsAtOnce={true}
            onTrustCertificate={
              canEdit && !isTrusting
                ? (fingerprint: string) => {
                    trustCertificate(fingerprint).catch((err: Error) => {
                      setTrustError(API.getFriendlyErrorMessage(err));
                    });
                  }
                : undefined
            }
          />
          {trustError ? (
            <p className="mt-3 text-sm text-red-700" role="alert">
              <ErrorInSentence message={trustError} showWhereToLook={true} />
            </p>
          ) : (
            <></>
          )}
        </Modal>
      ) : (
        <></>
      )}

      <ModelDelete
        modelType={StorageArrayConnection}
        modelId={modelId}
        singularName="Connection"
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.STORAGE_ARRAYS_CONNECTIONS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default StorageArrayConnectionView;
