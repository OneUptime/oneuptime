import Route from "Common/Types/API/Route";
import {
  CloudHostMachineJSON,
  CloudVmHostJSON,
} from "Common/Types/Cloud/CloudHostLink";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { getCloudResourceTypeText } from "Common/Types/Cloud/CloudResourceCatalog";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AppLink from "../AppLink/AppLink";
import {
  fetchCloudMachineOfHost,
  fetchHostOfCloudResource,
} from "./CloudHostLinkReads";

/*
 * A HOST AND THE CLOUD VM IT IS, EACH ON THE OTHER'S PAGE (#11013).
 *
 * When OneUptime's host collector runs on a cloud VM, the two are one
 * machine (CloudHostLinks): a VM's Overview says which host it is, and the
 * host's Overview which VM, each a link to the other's page. Nothing is
 * drawn while it is read, for a machine that is not both, or when the read
 * fails: this is one more thing to know about a machine, never what its
 * page stands on.
 */

export const VM_HOST_TITLE: string = translationKey("Host");
export const VM_HOST_DESCRIPTION: string = translationKey(
  "OneUptime's host collector runs on this instance: its processes, logs and memory readings are on the host's page.",
);
export const VM_HOST_SENTENCE: string = translationKey(
  "This instance is the host {{host}}.",
);

// The host's card, titled by the cloud it is in, as "On OpenStack" is.
export const HOST_MACHINE_TITLES: Readonly<Record<CloudProvider, string>> = {
  [CloudProvider.AWS]: translationKey("On AWS"),
  [CloudProvider.GCP]: translationKey("On Google Cloud"),
  [CloudProvider.Azure]: translationKey("On Azure"),
};
export const HOST_MACHINE_DESCRIPTION: string = translationKey(
  "This host is a VM its cloud connection lists: what it costs and how its size fits what it uses are on its page there.",
);
export const HOST_MACHINE_SENTENCE: string = translationKey(
  "This host is the {{type}} {{instance}} in {{account}}.",
);

const LINK_CLASS_NAME: string =
  "font-medium text-indigo-600 hover:text-indigo-700";

function MachineLine(props: {
  testId: string;
  children: ReactElement;
}): ReactElement {
  return (
    <div
      className="flex items-start gap-2 text-sm text-gray-700"
      data-testid={props.testId}
    >
      <Icon
        icon={IconProp.Server}
        className="mt-0.5 h-4 w-4 flex-none text-gray-500"
      />
      <span className="min-w-0 break-words">{props.children}</span>
    </div>
  );
}

// The host a VM is, on the VM's Overview; nothing for a VM that is no host.
export const CloudVmHostCard: FunctionComponent<{
  cloudResourceId: ObjectID;
}> = (props: { cloudResourceId: ObjectID }): ReactElement => {
  const [host, setHost] = useState<CloudVmHostJSON | null>(null);

  useEffect(() => {
    let ignore: boolean = false;

    setHost(null);

    fetchHostOfCloudResource(props.cloudResourceId)
      .then((found: CloudVmHostJSON | null): void => {
        if (!ignore) {
          setHost(found);
        }
      })
      .catch((): void => {
        // One more thing to know, never what the page stands on.
      });

    return (): void => {
      ignore = true;
    };
  }, [props.cloudResourceId.toString()]);

  if (!host) {
    return <></>;
  }

  return (
    <div className="mt-6" data-testid="cloud-vm-host">
      <Card title={VM_HOST_TITLE} description={VM_HOST_DESCRIPTION}>
        <MachineLine testId="cloud-vm-host-line">
          <TranslatedSentence
            template={VM_HOST_SENTENCE}
            slots={{
              host: (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOST_VIEW] as Route,
                    { modelId: new ObjectID(host.hostId) },
                  )}
                  className={LINK_CLASS_NAME}
                  dataTestId="cloud-vm-host-link"
                >
                  <bdi>{host.name || host.hostIdentifier}</bdi>
                </AppLink>
              ),
            }}
          />
        </MachineLine>
      </Card>
    </div>
  );
};

// The VM a host is, on the host's Overview; nothing for a host that is no VM.
export const HostCloudMachineCard: FunctionComponent<{
  hostId: ObjectID;
}> = (props: { hostId: ObjectID }): ReactElement => {
  const translator: Translator = useTranslator();
  const [machine, setMachine] = useState<CloudHostMachineJSON | null>(null);

  useEffect(() => {
    let ignore: boolean = false;

    setMachine(null);

    fetchCloudMachineOfHost(props.hostId)
      .then((found: CloudHostMachineJSON | null): void => {
        if (!ignore) {
          setMachine(found);
        }
      })
      .catch((): void => {
        // One more thing to know, never what the page stands on.
      });

    return (): void => {
      ignore = true;
    };
  }, [props.hostId.toString()]);

  const title: string | undefined = machine
    ? HOST_MACHINE_TITLES[machine.provider as CloudProvider]
    : undefined;

  if (!machine || !title) {
    return <></>;
  }

  return (
    <div className="mb-6" data-testid="host-cloud-machine">
      <Card title={title} description={HOST_MACHINE_DESCRIPTION}>
        <MachineLine testId="host-cloud-machine-line">
          <TranslatedSentence
            template={HOST_MACHINE_SENTENCE}
            slots={{
              // The cloud's own product name, as the cloud writes it.
              type: (
                <span>
                  {getCloudResourceTypeText(
                    machine.provider,
                    machine.type,
                    translator,
                  )}
                </span>
              ),
              instance: (
                <AppLink
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route,
                    { modelId: new ObjectID(machine.cloudResourceId) },
                  )}
                  className={`${LINK_CLASS_NAME} font-mono`}
                  dataTestId="host-cloud-machine-link"
                >
                  <bdi>{machine.instanceId}</bdi>
                </AppLink>
              ),
              account: (
                <bdi className="font-mono" data-testid="host-cloud-account">
                  {machine.accountId}
                </bdi>
              ),
            }}
          />
        </MachineLine>
      </Card>
    </div>
  );
};
