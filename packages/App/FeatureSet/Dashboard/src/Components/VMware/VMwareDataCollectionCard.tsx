import Probe from "Common/Models/DatabaseModels/Probe";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import VMwareCollectionMethod from "Common/Types/VMware/VMwareCollectionMethod";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card, { CardButtonSchema } from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import FieldType from "Common/UI/Components/Types/FieldType";
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
import VMwareConnectionTestPanel from "./VMwareConnectionTestPanel";
import {
  VMWARE_CONNECTION_EDIT_FORM_STEPS,
  getVMwareConnectionFormFields,
} from "./VMwareConnectionFormFields";
import { isProbeCollected } from "./VMwareProbeCollectionView";

/*
 * How this vCenter's data reaches OneUptime, on its Settings page: collected
 * by a probe with the read-only account saved here, or sent by the VMware
 * agent - and the one-click switch between the two.
 *
 * Switching to a probe asks for the address, account and probe (and the
 * password: nothing is saved for an agent vCenter). Switching to the agent
 * forgets the saved password; stop the agent before switching to a probe,
 * once the first collection succeeds, or every metric arrives twice.
 */

export interface ComponentProps {
  modelId: ObjectID;
}

const VMwareDataCollectionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [vcenter, setVCenter] = useState<VMwareVCenter | null>(null);
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isSwitchingToProbe, setIsSwitchingToProbe] = useState<boolean>(false);
  const [isConfirmingAgent, setIsConfirmingAgent] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  const load: () => Promise<void> = async (): Promise<void> => {
    const [item, allProbes]: [VMwareVCenter | null, Array<Probe>] =
      await Promise.all([
        ModelAPI.getItem({
          modelType: VMwareVCenter,
          id: props.modelId,
          select: {
            collectionMethod: true,
            vcenterUrl: true,
            vcenterUsername: true,
            isVCenterPasswordSet: true,
            vcenterCredentialsUpdatedAt: true,
            collectionProbeId: true,
            collectionProbe: {
              name: true,
            },
            trustedCertificateFingerprint: true,
            collectionIntervalInMinutes: true,
          },
        }),
        ProbeUtil.getAllProbes(),
      ]);

    setVCenter(item);
    setProbes(allProbes);
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

  if (!vcenter) {
    return <></>;
  }

  const canEdit: boolean = PermissionGate.check(
    new VMwareVCenter(),
    ModelAction.Update,
  ).isAllowed;

  const isProbe: boolean = isProbeCollected(vcenter);

  const buttons: Array<CardButtonSchema> = [];

  if (canEdit && isProbe) {
    buttons.push({
      title: "Test Connection",
      buttonStyle: ButtonStyleType.OUTLINE,
      icon: IconProp.Play,
      onClick: () => {
        setIsTesting(true);
      },
    });
    buttons.push({
      title: "Use the VMware Agent",
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
        setIsEditing(true);
      },
    });
  }

  if (canEdit && !isProbe) {
    buttons.push({
      title: "Collect With a Probe",
      buttonStyle: ButtonStyleType.NORMAL,
      icon: IconProp.Refresh,
      onClick: () => {
        setIsSwitchingToProbe(true);
      },
    });
  }

  const formFields: ReturnType<typeof getVMwareConnectionFormFields> =
    getVMwareConnectionFormFields({
      probes: probes,
      isBillingEnabled: BILLING_ENABLED,
      translator: translator,
      vmwareVCenterId: props.modelId,
    });

  const closeAndReload: () => void = (): void => {
    setIsEditing(false);
    setIsSwitchingToProbe(false);
    setIsLoading(true);
    load()
      .catch((err: Error) => {
        setError(API.getFriendlyErrorMessage(err));
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <Fragment>
      <Card
        title="Data Collection"
        description={
          isProbe
            ? "A OneUptime probe logs in to vCenter with the read-only account saved here and collects the same data the VMware agent would. No agent runs for this vCenter."
            : "The VMware agent you run sends this vCenter's data. Collect it with a probe instead, and no agent or machine of its own is needed."
        }
        buttons={buttons}
      >
        {isProbe ? (
          <Detail<VMwareVCenter>
            id="vmware-data-collection"
            item={vcenter}
            showDetailsInNumberOfColumns={2}
            fields={[
              {
                key: "vcenterUrl",
                title: "vCenter Address",
                fieldType: FieldType.Text,
              },
              {
                key: "vcenterUsername",
                title: "User Name",
                fieldType: FieldType.Text,
              },
              {
                key: "isVCenterPasswordSet",
                title: "Password",
                fieldType: FieldType.Element,
                getElement: (item: VMwareVCenter): ReactElement => {
                  if (!item.isVCenterPasswordSet) {
                    return (
                      <span className="text-red-700">
                        {translator.translateText("Not saved")}
                      </span>
                    );
                  }

                  return (
                    <span>
                      {item.vcenterCredentialsUpdatedAt
                        ? translator.translateTemplate("Saved {{time}}", {
                            time: OneUptimeDate.fromNow(
                              item.vcenterCredentialsUpdatedAt,
                            ),
                          })
                        : translator.translateText("Saved")}
                    </span>
                  );
                },
              },
              {
                key: "collectionProbe",
                title: "Probe",
                fieldType: FieldType.Element,
                getElement: (item: VMwareVCenter): ReactElement => {
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
                key: "trustedCertificateFingerprint",
                title: "Trusted Certificate",
                fieldType: FieldType.Element,
                getElement: (item: VMwareVCenter): ReactElement => {
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
                key: "collectionIntervalInMinutes",
                title: "Collected Every",
                fieldType: FieldType.Element,
                getElement: (item: VMwareVCenter): ReactElement => {
                  return (
                    <span>
                      {translator.translatePlural(
                        { one: "{{count}} minute", other: "{{count}} minutes" },
                        item.collectionIntervalInMinutes || 2,
                      )}
                    </span>
                  );
                },
              },
            ]}
          />
        ) : (
          <></>
        )}
      </Card>

      {isEditing || isSwitchingToProbe ? (
        <ModelFormModal<VMwareVCenter>
          modelType={VMwareVCenter}
          modelIdToEdit={props.modelId}
          name={isSwitchingToProbe ? "Collect With a Probe" : "Edit Connection"}
          title={
            isSwitchingToProbe ? "Collect With a Probe" : "Edit Connection"
          }
          description={
            isSwitchingToProbe
              ? "Enter vCenter's address and a read-only account, and pick the probe that reaches it. Stop the VMware agent once the first collection succeeds, or every metric arrives twice."
              : "Changing the address, the probe or the trusted certificate needs the password again: a saved password is only sent where it was entered for."
          }
          modalWidth={ModalWidth.Medium}
          submitButtonText="Save Changes"
          onClose={() => {
            setIsEditing(false);
            setIsSwitchingToProbe(false);
          }}
          onSuccess={closeAndReload}
          onBeforeUpdate={async (
            item: VMwareVCenter,
            miscDataProps: JSONObject,
          ): Promise<VMwareVCenter> => {
            void miscDataProps;

            if (isSwitchingToProbe) {
              item.collectionMethod = VMwareCollectionMethod.Probe;
            }

            return item;
          }}
          formProps={{
            name: isSwitchingToProbe
              ? "Collect With a Probe"
              : "Edit Connection",
            modelType: VMwareVCenter,
            id: "vmware-vcenter-connection-form",
            steps: VMWARE_CONNECTION_EDIT_FORM_STEPS,
            fields: formFields,
            formType: FormType.Update,
          }}
        />
      ) : (
        <></>
      )}

      {isTesting ? (
        <Modal
          title="Test Connection"
          description="The probe logs in with the saved settings and password, reads what the account can see, and logs out."
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setIsTesting(false);
          }}
          closeButtonText="Close"
        >
          <VMwareConnectionTestPanel
            input={{
              vcenterUrl: vcenter.vcenterUrl || "",
              vcenterUsername: vcenter.vcenterUsername || "",
              vcenterPassword: "",
              probeId: vcenter.collectionProbeId?.toString() || "",
              trustedCertificateFingerprint:
                vcenter.trustedCertificateFingerprint || "",
              vmwareVCenterId: props.modelId,
            }}
            onTrustCertificate={(fingerprint: string) => {
              setIsSaving(true);
              setSaveError("");
              ModelAPI.updateById({
                modelType: VMwareVCenter,
                id: props.modelId,
                data: { trustedCertificateFingerprint: fingerprint },
              })
                .then(() => {
                  setIsTesting(false);
                  closeAndReload();
                })
                .catch((err: Error) => {
                  setSaveError(API.getFriendlyErrorMessage(err));
                })
                .finally(() => {
                  setIsSaving(false);
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
        </Modal>
      ) : (
        <></>
      )}

      {isConfirmingAgent ? (
        <ConfirmModal
          title="Use the VMware Agent"
          description="The probe stops collecting this vCenter and OneUptime forgets its saved password. Its data then comes from the VMware agent you run - install and start it first, so nothing is missed."
          submitButtonText="Use the VMware Agent"
          isLoading={isSaving}
          error={saveError || undefined}
          onClose={() => {
            setIsConfirmingAgent(false);
          }}
          onSubmit={() => {
            setIsSaving(true);
            setSaveError("");
            ModelAPI.updateById({
              modelType: VMwareVCenter,
              id: props.modelId,
              data: { collectionMethod: VMwareCollectionMethod.Agent },
            })
              .then(() => {
                setIsConfirmingAgent(false);
                closeAndReload();
              })
              .catch((err: Error) => {
                setSaveError(API.getFriendlyErrorMessage(err));
              })
              .finally(() => {
                setIsSaving(false);
              });
          }}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default VMwareDataCollectionCard;
