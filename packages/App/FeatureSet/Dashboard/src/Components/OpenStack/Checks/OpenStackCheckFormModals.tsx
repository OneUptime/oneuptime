import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackCloudCheck from "Common/Models/DatabaseModels/OpenStackCloudCheck";
import Probe from "Common/Models/DatabaseModels/Probe";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { BILLING_ENABLED } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProbeUtil from "../../../Utils/Probe";
import {
  OpenStackCheckFormOptions,
  getOpenStackApiCheckFormFields,
  getOpenStackLifecycleCheckFormFields,
  keepOpenStackCheckCredentialKind,
} from "./OpenStackCheckFormFields";
import {
  OPENSTACK_LIFECYCLE_CHECK_FORM_DESCRIPTION,
  isOpenStackCheckConnectionNeeded,
} from "./OpenStackChecksView";

/*
 * The forms a cloud's Checks page opens. A cloud has no check's row until someone turns one on, so
 * each is a create for the first time and an update after that, and each opens once the probes are
 * known, because a form reads its default probe as it opens.
 */

export interface OpenStackCheckFormModalProps {
  openStackCloudId: ObjectID;
  cloud: Pick<OpenStackCloud, "collectionMethod" | "authUrl">;
  // Null until a check has been turned on here.
  saved: OpenStackCloudCheck | null;
  onClose: () => void;
  onSuccess: () => void;
}

function useOpenStackCheckProbes(): Array<Probe> | null {
  const [probes, setProbes] = useState<Array<Probe> | null>(null);

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

  return probes;
}

function getFormOptions(data: {
  cloud: OpenStackCheckFormModalProps["cloud"];
  saved: OpenStackCloudCheck | null;
  probes: Array<Probe>;
  translator: Translator;
}): OpenStackCheckFormOptions {
  return {
    probes: data.probes,
    isBillingEnabled: BILLING_ENABLED,
    translator: data.translator,
    isConnectionNeeded: isOpenStackCheckConnectionNeeded({
      cloud: data.cloud,
      check: data.saved,
    }),
    isCredentialSaved: data.saved?.isCredentialSet === true,
  };
}

// A dropdown hands its choice back as it was offered, and the column is a number.
function readInterval(item: OpenStackCloudCheck): OpenStackCloudCheck {
  if (item.apiCheckIntervalInMinutes !== undefined) {
    item.apiCheckIntervalInMinutes = Number(item.apiCheckIntervalInMinutes);
  }

  if (item.lifecycleCheckIntervalInMinutes !== undefined) {
    item.lifecycleCheckIntervalInMinutes = Number(
      item.lifecycleCheckIntervalInMinutes,
    );
  }

  return item;
}

const API_FORM_DESCRIPTION: string =
  "A probe outside the cloud checks it from where your users are. These checks only read.";

// Turn On API Checks and Edit API Checks.
export const OpenStackApiCheckFormModal: FunctionComponent<
  OpenStackCheckFormModalProps
> = (props: OpenStackCheckFormModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const probes: Array<Probe> | null = useOpenStackCheckProbes();
  const isOn: boolean = props.saved?.isApiCheckEnabled === true;
  const title: string = isOn ? "Edit API Checks" : "Turn On API Checks";

  if (!probes) {
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

  const fields: ReturnType<typeof getOpenStackApiCheckFormFields> =
    getOpenStackApiCheckFormFields(
      getFormOptions({
        cloud: props.cloud,
        saved: props.saved,
        probes: probes,
        translator: translator,
      }),
    );

  if (props.saved?.id) {
    return (
      <ModelFormModal<OpenStackCloudCheck>
        modelType={OpenStackCloudCheck}
        modelIdToEdit={props.saved.id}
        name={title}
        title={title}
        description={API_FORM_DESCRIPTION}
        modalWidth={ModalWidth.Medium}
        submitButtonText={isOn ? "Save Changes" : "Turn On API Checks"}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
        onBeforeUpdate={async (
          item: OpenStackCloudCheck,
          miscDataProps: JSONObject,
        ): Promise<OpenStackCloudCheck> => {
          void miscDataProps;
          item.isApiCheckEnabled = true;
          return readInterval(keepOpenStackCheckCredentialKind(item));
        }}
        formProps={{
          name: title,
          modelType: OpenStackCloudCheck,
          id: "openstack-api-check-form",
          fields: fields,
          formType: FormType.Update,
        }}
      />
    );
  }

  return (
    <ModelFormModal<OpenStackCloudCheck>
      modelType={OpenStackCloudCheck}
      name={title}
      title={title}
      description={API_FORM_DESCRIPTION}
      modalWidth={ModalWidth.Medium}
      submitButtonText="Turn On API Checks"
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onBeforeCreate={async (
        item: OpenStackCloudCheck,
        miscDataProps: JSONObject,
      ): Promise<OpenStackCloudCheck> => {
        void miscDataProps;
        item.openStackCloudId = props.openStackCloudId;
        item.isApiCheckEnabled = true;
        return readInterval(keepOpenStackCheckCredentialKind(item));
      }}
      formProps={{
        name: title,
        modelType: OpenStackCloudCheck,
        id: "openstack-api-check-form",
        fields: fields,
        formType: FormType.Create,
      }}
    />
  );
};

// Turn On the Lifecycle Check and Edit Lifecycle Check.
export const OpenStackLifecycleCheckFormModal: FunctionComponent<
  OpenStackCheckFormModalProps
> = (props: OpenStackCheckFormModalProps): ReactElement => {
  const translator: Translator = useTranslator();
  const probes: Array<Probe> | null = useOpenStackCheckProbes();
  const isOn: boolean = props.saved?.isLifecycleCheckEnabled === true;
  const title: string = isOn
    ? "Edit Lifecycle Check"
    : "Turn On the Lifecycle Check";

  if (!probes) {
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

  const fields: ReturnType<typeof getOpenStackLifecycleCheckFormFields> =
    getOpenStackLifecycleCheckFormFields(
      getFormOptions({
        cloud: props.cloud,
        saved: props.saved,
        probes: probes,
        translator: translator,
      }),
    );

  if (props.saved?.id) {
    return (
      <ModelFormModal<OpenStackCloudCheck>
        modelType={OpenStackCloudCheck}
        modelIdToEdit={props.saved.id}
        name={title}
        title={title}
        description={OPENSTACK_LIFECYCLE_CHECK_FORM_DESCRIPTION}
        modalWidth={ModalWidth.Medium}
        submitButtonText={isOn ? "Save Changes" : "Turn On the Lifecycle Check"}
        onClose={props.onClose}
        onSuccess={props.onSuccess}
        onBeforeUpdate={async (
          item: OpenStackCloudCheck,
          miscDataProps: JSONObject,
        ): Promise<OpenStackCloudCheck> => {
          void miscDataProps;
          item.isLifecycleCheckEnabled = true;
          return readInterval(keepOpenStackCheckCredentialKind(item));
        }}
        formProps={{
          name: title,
          modelType: OpenStackCloudCheck,
          id: "openstack-lifecycle-check-form",
          fields: fields,
          formType: FormType.Update,
        }}
      />
    );
  }

  return (
    <ModelFormModal<OpenStackCloudCheck>
      modelType={OpenStackCloudCheck}
      name={title}
      title={title}
      description={OPENSTACK_LIFECYCLE_CHECK_FORM_DESCRIPTION}
      modalWidth={ModalWidth.Medium}
      submitButtonText="Turn On the Lifecycle Check"
      onClose={props.onClose}
      onSuccess={props.onSuccess}
      onBeforeCreate={async (
        item: OpenStackCloudCheck,
        miscDataProps: JSONObject,
      ): Promise<OpenStackCloudCheck> => {
        void miscDataProps;
        item.openStackCloudId = props.openStackCloudId;
        item.isLifecycleCheckEnabled = true;
        return readInterval(keepOpenStackCheckCredentialKind(item));
      }}
      formProps={{
        name: title,
        modelType: OpenStackCloudCheck,
        id: "openstack-lifecycle-check-form",
        fields: fields,
        formType: FormType.Create,
      }}
    />
  );
};
