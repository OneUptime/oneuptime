import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCollectionMethod from "Common/Types/OpenStack/OpenStackCollectionMethod";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { BasicFormHandle, FormProps } from "Common/UI/Components/Forms/BasicForm";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { BILLING_ENABLED } from "Common/UI/Config";
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
import ProbeUtil from "../../Utils/Probe";
import {
  OPENSTACK_CONNECTION_EDIT_FORM_STEPS,
  OPENSTACK_CONNECT_FORM_STEPS,
  getOpenStackConnectFormFields,
  getOpenStackConnectionFormFields,
} from "./OpenStackConnectionFormFields";
import {
  getOpenStackSwitchToProbeStart,
  keepOpenStackCredentialKind,
} from "./OpenStackProbeCollectionView";

/*
 * The forms that connect a cloud through a probe: Connect Cloud on the clouds list, which makes
 * a new cloud, and Collect With a Probe and Edit Connection on a cloud's Settings page, which
 * change a saved one. Two forms, because only the one that makes a cloud asks what it is called:
 * a saved cloud's name, description and labels are edited in its Details card.
 *
 * They hold the form, because "Use these regions" on the connection test fills in another field
 * than the one the test is drawn under, and only the form can reach that. And they open once
 * the probes are known, because a form reads its default probe as it opens.
 */

interface OpenStackConnectionFormState {
  // Null until they are read.
  probes: Array<Probe> | null;
  formRef: MutableRefObject<FormProps<FormValues<OpenStackCloud>>>;
  onUseRegions: (regions: Array<string>) => void;
}

function useOpenStackConnectionForm(): OpenStackConnectionFormState {
  const [probes, setProbes] = useState<Array<Probe> | null>(null);

  const formRef: MutableRefObject<FormProps<FormValues<OpenStackCloud>>> =
    useRef<FormProps<FormValues<OpenStackCloud>>>(null) as MutableRefObject<
      FormProps<FormValues<OpenStackCloud>>
    >;

  useEffect(() => {
    ProbeUtil.getAllProbes()
      .then((allProbes: Array<Probe>) => {
        setProbes(allProbes);
      })
      .catch(() => {
        // The picker then offers none, and says how to add one.
        setProbes([]);
      });
  }, []);

  return {
    probes: probes,
    formRef: formRef,
    onUseRegions: (regions: Array<string>): void => {
      (formRef.current as unknown as BasicFormHandle | null)?.setFieldValue(
        "collectionRegions",
        regions,
      );
    },
  };
}

export interface OpenStackConnectCloudModalProps {
  onClose: () => void;
  onSuccess: (cloud: OpenStackCloud) => void;
}

// Connect Cloud: a new cloud, collected by a probe.
export const OpenStackConnectCloudModal: FunctionComponent<
  OpenStackConnectCloudModalProps
> = (props: OpenStackConnectCloudModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const form: OpenStackConnectionFormState = useOpenStackConnectionForm();

  if (!form.probes) {
    return (
      <Modal
        title="Connect Cloud"
        modalWidth={ModalWidth.Medium}
        onClose={props.onClose}
      >
        <ComponentLoader />
      </Modal>
    );
  }

  return (
    <ModelFormModal<OpenStackCloud>
      modelType={OpenStackCloud}
      name="Connect Cloud"
      title="Connect Cloud"
      description="Enter Keystone's address, a read-only credential and a probe that reaches the cloud. No agent to install."
      modalWidth={ModalWidth.Medium}
      submitButtonText="Connect Cloud"
      formRef={form.formRef}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onBeforeCreate={async (
        item: OpenStackCloud,
        miscDataProps: JSONObject,
      ): Promise<OpenStackCloud> => {
        void miscDataProps;
        // A cloud connected here is collected by a probe: no agent to run.
        item.collectionMethod = OpenStackCollectionMethod.Probe;
        return keepOpenStackCredentialKind(item);
      }}
      formProps={{
        name: "Connect Cloud",
        modelType: OpenStackCloud,
        id: "openstack-cloud-connect-form",
        steps: OPENSTACK_CONNECT_FORM_STEPS,
        fields: getOpenStackConnectFormFields({
          probes: form.probes,
          isBillingEnabled: BILLING_ENABLED,
          translator: translator,
          onUseRegions: form.onUseRegions,
        }),
        formType: FormType.Create,
      }}
    />
  );
};

export enum OpenStackConnectionFormMode {
  SwitchToProbe = "SwitchToProbe",
  Edit = "Edit",
}

export interface OpenStackConnectionFormModalProps {
  mode: OpenStackConnectionFormMode;
  modelId: ObjectID;
  // What a switch starts from: how that cloud was last logged in to, if it ever was.
  savedCloud?:
    | Pick<OpenStackCloud, "credentialKind" | "collectionProbeId">
    | null
    | undefined;
  onClose: () => void;
  onSuccess: () => void;
}

// Collect With a Probe and Edit Connection: how a saved cloud is reached and logged in to.
const OpenStackConnectionFormModal: FunctionComponent<
  OpenStackConnectionFormModalProps
> = (props: OpenStackConnectionFormModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const form: OpenStackConnectionFormState = useOpenStackConnectionForm();

  const isSwitch: boolean =
    props.mode === OpenStackConnectionFormMode.SwitchToProbe;
  const title: string = isSwitch ? "Collect With a Probe" : "Edit Connection";

  if (!form.probes) {
    return (
      <Modal
        title={title}
        modalWidth={ModalWidth.Medium}
        onClose={props.onClose}
      >
        <ComponentLoader />
      </Modal>
    );
  }

  return (
    <ModelFormModal<OpenStackCloud>
      modelType={OpenStackCloud}
      modelIdToEdit={props.modelId}
      name={title}
      title={title}
      description={
        isSwitch
          ? "Enter Keystone's address, a read-only credential and a probe that reaches the cloud. Stop the OpenStack agent after the first collection, or every metric arrives twice."
          : "Changing the address or the probe, or trusting another certificate, needs the secret again: a saved credential is only sent where it was entered for."
      }
      modalWidth={ModalWidth.Medium}
      submitButtonText="Save Changes"
      formRef={form.formRef}
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onBeforeUpdate={async (
        item: OpenStackCloud,
        miscDataProps: JSONObject,
      ): Promise<OpenStackCloud> => {
        void miscDataProps;

        if (isSwitch) {
          item.collectionMethod = OpenStackCollectionMethod.Probe;
        }

        return keepOpenStackCredentialKind(item);
      }}
      formProps={{
        name: title,
        modelType: OpenStackCloud,
        id: "openstack-cloud-connection-form",
        steps: OPENSTACK_CONNECTION_EDIT_FORM_STEPS,
        fields: getOpenStackConnectionFormFields({
          probes: form.probes,
          isBillingEnabled: BILLING_ENABLED,
          translator: translator,
          openStackCloudId: props.modelId,
          isSecretRequired: isSwitch,
          onUseRegions: form.onUseRegions,
        }),
        formType: FormType.Update,
        draftValues: isSwitch
          ? getOpenStackSwitchToProbeStart({
              cloud: props.savedCloud || null,
              probes: form.probes,
              isBillingEnabled: BILLING_ENABLED,
            })
          : undefined,
      }}
    />
  );
};

export default OpenStackConnectionFormModal;
