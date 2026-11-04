import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import { OpenStackCollectionOptions } from "Common/Types/OpenStack/OpenStackProbeCollection";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import FieldType from "Common/UI/Components/Types/FieldType";
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
import OpenStackConnectionFormModal, {
  OpenStackConnectionFormMode,
} from "./OpenStackConnectionFormModal";
import OpenStackConnectionTestPanel from "./OpenStackConnectionTestPanel";
import { OpenStackCollectionOptionsField } from "./OpenStackConnectionFields";
import {
  isOpenStackProbeCollected,
  readOpenStackNames,
  readOpenStackOptions,
  validateOpenStackOptions,
} from "./OpenStackProbeCollectionView";

/*
 * How this cloud's data reaches OneUptime, on its Settings page: collected by a probe with the
 * read-only credential saved here, or sent by the OpenStack agent, and the one-click switch
 * between the two. A cloud a probe collects also says here what is read beyond the defaults,
 * which is where the Projects page sends someone who wants quotas.
 *
 * Switching to a probe asks for the address, credential, regions and probe, because nothing is
 * saved for an agent cloud. Switching to the agent forgets the saved credential. Stop the agent
 * once the first collection succeeds, or every metric arrives twice.
 */

export interface ComponentProps {
  modelId: ObjectID;
}

const OpenStackDataCollectionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [formMode, setFormMode] = useState<OpenStackConnectionFormMode | null>(
    null,
  );
  const [isConfirmingAgent, setIsConfirmingAgent] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [options, setOptions] = useState<OpenStackCollectionOptions>({});
  const [isSavingOptions, setIsSavingOptions] = useState<boolean>(false);
  const [optionsError, setOptionsError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const item: OpenStackCloud | null = await ModelAPI.getItem({
      modelType: OpenStackCloud,
      id: props.modelId,
      select: {
        collectionMethod: true,
        authUrl: true,
        endpointInterface: true,
        collectionRegions: true,
        credentialKind: true,
        applicationCredentialId: true,
        keystoneUsername: true,
        projectName: true,
        isCredentialSet: true,
        credentialsUpdatedAt: true,
        collectionProbeId: true,
        collectionProbe: {
          name: true,
        },
        trustedCertificateFingerprints: true,
        collectionIntervalInMinutes: true,
        collectionOptions: true,
      },
    });

    setCloud(item);
    setOptions(readOpenStackOptions(item?.collectionOptions));
  };

  useEffect(() => {
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [props.modelId.toString()]);

  if (isLoading) {
    return <ComponentLoader />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloud) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new OpenStackCloud(),
    ModelAction.Update,
  ).isAllowed;

  const isProbe: boolean = isOpenStackProbeCollected(cloud);

  const buttons: Array<CardButtonSchema> = [];

  if (canEdit && isProbe) {
    buttons.push({
      title: "Test Connection",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Play,
      onClick: () => {
        setSaveError("");
        setIsTesting(true);
      },
    });
    buttons.push({
      title: "Use the OpenStack Agent",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Refresh,
      onClick: () => {
        setSaveError("");
        setIsConfirmingAgent(true);
      },
    });
    buttons.push({
      title: "Edit Connection",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Edit,
      onClick: () => {
        setFormMode(OpenStackConnectionFormMode.Edit);
      },
    });
  }

  if (canEdit && !isProbe) {
    buttons.push({
      title: "Collect With a Probe",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Refresh,
      onClick: () => {
        setFormMode(OpenStackConnectionFormMode.SwitchToProbe);
      },
    });
  }

  const reload: () => void = (): void => {
    setIsLoading(true);
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  const saveAndReload: (data: JSONObject, after: () => void) => void = (
    data: JSONObject,
    after: () => void,
  ): void => {
    setIsSaving(true);
    setSaveError("");
    ModelAPI.updateById({
      modelType: OpenStackCloud,
      id: props.modelId,
      data: data,
    })
      .then(() => {
        after();
        reload();
      })
      .catch((err: Error) => {
        setSaveError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const savedOptions: OpenStackCollectionOptions = readOpenStackOptions(
    cloud.collectionOptions,
  );
  const isOptionsChanged: boolean =
    JSON.stringify(readOpenStackOptions(options)) !==
    JSON.stringify(savedOptions);

  const saveOptions: () => void = (): void => {
    // Said here, where the list was typed: the server would refuse it in the same words.
    const refusal: string | null = validateOpenStackOptions(options);

    if (refusal) {
      setOptionsError(refusal);
      return;
    }

    setIsSavingOptions(true);
    setOptionsError("");
    ModelAPI.updateById({
      modelType: OpenStackCloud,
      id: props.modelId,
      data: {
        collectionOptions: readOpenStackOptions(options) as JSONObject,
      },
    })
      .then(() => {
        return load();
      })
      .catch((err: Error) => {
        setOptionsError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsSavingOptions(false);
      });
  };

  return (
    <Fragment>
      <Card
        title="Data Collection"
        description={
          isProbe
            ? "A OneUptime probe reads this cloud's APIs with the read-only credential saved here, and collects the same data the OpenStack agent would. No agent runs for this cloud."
            : "The OpenStack agent you run sends this cloud's data. Collect it with a probe instead, and no agent or machine of its own is needed."
        }
        buttons={buttons}
      >
        {isProbe ? (
          <div data-testid="openstack-data-collection">
            <Detail<OpenStackCloud>
              id="openstack-data-collection"
              item={cloud}
              showDetailsInNumberOfColumns={2}
              fields={[
                {
                  key: "authUrl",
                  title: "Keystone Address",
                  fieldType: FieldType.Text,
                },
                {
                  key: "collectionProbe",
                  title: "Probe",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    return (
                      <span>
                        {item.collectionProbe?.name ||
                          item.collectionProbeId?.toString() ||
                          "—"}
                      </span>
                    );
                  },
                },
                {
                  key: "credentialKind",
                  title: "Logs In With",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    return (
                      <span className="break-all">
                        {item.credentialKind === "password"
                          ? translator.translateTemplate(
                              "User {{user}}, on project {{project}}",
                              {
                                user: item.keystoneUsername || "—",
                                project: item.projectName || "—",
                              },
                            )
                          : translator.translateTemplate(
                              "Application credential {{id}}",
                              { id: item.applicationCredentialId || "—" },
                            )}
                      </span>
                    );
                  },
                },
                {
                  key: "isCredentialSet",
                  title: "Secret",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    if (!item.isCredentialSet) {
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
                  key: "collectionRegions",
                  title: "Regions",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    return (
                      <span className="break-words">
                        {readOpenStackNames(item.collectionRegions).join(
                          ", ",
                        ) || "—"}
                      </span>
                    );
                  },
                },
                {
                  key: "endpointInterface",
                  title: "Endpoint Interface",
                  fieldType: FieldType.Text,
                },
                {
                  key: "trustedCertificateFingerprints",
                  title: "Trusted Certificates",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    const trusted: Array<string> = readOpenStackNames(
                      item.trustedCertificateFingerprints,
                    );

                    return trusted.length > 0 ? (
                      <ul className="space-y-1">
                        {trusted.map((fingerprint: string) => {
                          return (
                            <li key={fingerprint}>
                              <code className="break-all font-mono text-xs">
                                {fingerprint}
                              </code>
                            </li>
                          );
                        })}
                      </ul>
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
                  key: "collectionIntervalInMinutes",
                  title: "Collected Every",
                  fieldType: FieldType.Element,
                  getElement: (item: OpenStackCloud): ReactElement => {
                    return (
                      <span>
                        {translator.translatePlural(
                          {
                            one: "{{count}} minute",
                            other: "{{count}} minutes",
                          },
                          item.collectionIntervalInMinutes || 2,
                        )}
                      </span>
                    );
                  },
                },
              ]}
            />

            <div
              className="mt-6 border-t border-gray-200 pt-4"
              data-testid="openstack-collection-options"
            >
              <div className="mb-3 text-sm font-medium text-gray-900">
                {translator.translateText("What it reads beyond the defaults")}
              </div>
              <OpenStackCollectionOptionsField
                value={options}
                disabled={!canEdit || isSavingOptions}
                onChange={(value: OpenStackCollectionOptions) => {
                  setOptionsError("");
                  setOptions(value);
                }}
              />
              {canEdit && isOptionsChanged ? (
                <div className="mt-3">
                  <Button
                    title="Save Options"
                    buttonStyle={ButtonStyleType.NORMAL}
                    buttonSize={ButtonSize.Small}
                    isLoading={isSavingOptions}
                    dataTestId="openstack-save-collection-options"
                    onClick={saveOptions}
                  />
                </div>
              ) : (
                <></>
              )}
              {optionsError ? (
                <p className="mt-2 text-sm text-red-700" role="alert">
                  {optionsError}
                </p>
              ) : (
                <></>
              )}
            </div>
          </div>
        ) : (
          <></>
        )}
      </Card>

      {formMode ? (
        <OpenStackConnectionFormModal
          mode={formMode}
          modelId={props.modelId}
          savedCloud={cloud}
          onClose={() => {
            setFormMode(null);
          }}
          onSuccess={() => {
            setFormMode(null);
            reload();
          }}
        />
      ) : (
        <></>
      )}

      {isTesting ? (
        <Modal
          title="Test Connection"
          description="The probe logs in with the saved settings and credential, tries each read a collection makes, and logs out."
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setIsTesting(false);
          }}
          closeButtonText="Close"
        >
          <Fragment>
            <OpenStackConnectionTestPanel
              input={{
                authUrl: cloud.authUrl || "",
                endpointInterface: cloud.endpointInterface || "public",
                regions: readOpenStackNames(cloud.collectionRegions),
                credentialKind: cloud.credentialKind || "applicationCredential",
                applicationCredentialId: cloud.applicationCredentialId || "",
                keystoneUsername: cloud.keystoneUsername || "",
                userDomainName: "",
                projectName: cloud.projectName || "",
                projectDomainName: "",
                credentialSecret: "",
                probeId: cloud.collectionProbeId?.toString() || "",
                trustedCertificateFingerprints: readOpenStackNames(
                  cloud.trustedCertificateFingerprints,
                ),
                openStackCloudId: props.modelId,
              }}
              onTrustCertificate={(fingerprint: string) => {
                saveAndReload(
                  {
                    trustedCertificateFingerprints: [
                      ...readOpenStackNames(
                        cloud.trustedCertificateFingerprints,
                      ),
                      fingerprint,
                    ],
                  },
                  () => {
                    setIsTesting(false);
                  },
                );
              }}
              onUseRegions={(regions: Array<string>) => {
                saveAndReload({ collectionRegions: regions }, () => {
                  setIsTesting(false);
                });
              }}
            />
            {saveError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {saveError}
              </p>
            ) : (
              <></>
            )}
          </Fragment>
        </Modal>
      ) : (
        <></>
      )}

      {isConfirmingAgent ? (
        <ConfirmModal
          title="Use the OpenStack Agent"
          description="The probe stops collecting this cloud and its saved credential is deleted. Start the OpenStack agent first, so nothing is missed."
          submitButtonText="Use the OpenStack Agent"
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsConfirmingAgent(false);
          }}
          onSubmit={() => {
            saveAndReload(
              { collectionMethod: OpenStackCollectionMethod.Agent },
              () => {
                setIsConfirmingAgent(false);
              },
            );
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default OpenStackDataCollectionCard;
