import {
  NETWORK_EVENT_ALERT_TEMPLATE_COPY,
  NetworkEventAlertTemplateCopy,
} from "./NetworkEventAlertTemplateCopy";
import {
  getNetworkEventAlertRoute,
  getNetworkEventMonitorCreateRoute,
} from "../../Utils/NetworkEventMonitorPrefill";
import AppLink from "../AppLink/AppLink";
import IconProp from "Common/Types/Icon/IconProp";
import NetworkEventAlertTemplates, {
  NetworkEventAlertTemplate,
  NetworkEventAlertTemplateId,
} from "Common/Types/NetworkEvent/NetworkEventAlertTemplates";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * BEING TOLD WHEN SOMETHING HAPPENS ON THE NETWORK.
 *
 * The alerts most networks want, one card each: what happens, and when the
 * alert closes again. A card opens Create Monitor filled in - a Logs
 * monitor counting that event, one alert per device and per thing on it -
 * where anything can be changed before saving.
 *
 * From one device's page the monitors are for that device alone, and the
 * dialog says so.
 *
 * Creating is permission-gated by the caller, the way the monitor table
 * gates its own create button: a viewer is not offered a form they cannot
 * submit.
 */

export interface ComponentProps {
  onClose: () => void;
  canCreate: boolean;
  // Set on one device's page: the monitors are for this device only.
  device?: { id: string; name: string } | undefined;
}

export const NetworkEventAlertCard: FunctionComponent<{
  template: NetworkEventAlertTemplate;
  canCreate: boolean;
  networkDeviceId?: string | undefined;
}> = (props: {
  template: NetworkEventAlertTemplate;
  canCreate: boolean;
  networkDeviceId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: NetworkEventAlertTemplateCopy =
    NETWORK_EVENT_ALERT_TEMPLATE_COPY[
      props.template.id as NetworkEventAlertTemplateId
    ];

  return (
    <div
      className="flex flex-col rounded-lg bg-white p-4 ring-1 ring-gray-200"
      data-testid="network-event-alert-template"
      data-template-id={props.template.id}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${copy.iconTileClassName}`}
          aria-hidden="true"
        >
          <Icon icon={copy.icon} className={`h-5 w-5 ${copy.iconClassName}`} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            {translator.translateText(copy.title)}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            {translator.translateText(copy.description)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-1 items-end">
        {props.canCreate ? (
          <AppLink
            to={getNetworkEventAlertRoute(
              props.template.id,
              props.networkDeviceId,
            )}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <span>{translator.translateText("Create alert") || ""}</span>
            <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
          </AppLink>
        ) : (
          <div className="text-xs text-gray-500">
            {translator.translateText(
              "You need permission to create monitors to set this up.",
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const NetworkEventAlertsModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const deviceName: string = props.device?.name?.trim() || "";

  return (
    <Modal
      title={
        deviceName
          ? translator.translateTemplate(
              "Get told when something happens on {{device}}",
              { device: deviceName },
            )
          : props.device
            ? "Get told when something happens on this device"
            : "Get told when something happens on your network"
      }
      description={
        props.device
          ? "Pick an alert to start from. It watches this device only, and you can change anything before you save it."
          : "Pick an alert to start from. It watches every device that sends its syslog or traps to a probe, and you can change anything before you save it."
      }
      onClose={props.onClose}
      closeButtonText="Close"
      modalWidth={ModalWidth.Large}
      leftFooterElement={
        props.canCreate ? (
          <AppLink
            to={getNetworkEventMonitorCreateRoute()}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            {translator.translateText("Start from scratch") || ""}
          </AppLink>
        ) : undefined
      }
    >
      <div
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
        data-testid="network-event-alert-templates"
      >
        {NetworkEventAlertTemplates.getFeatured().map(
          (template: NetworkEventAlertTemplate): ReactElement => {
            return (
              <NetworkEventAlertCard
                key={template.id}
                template={template}
                canCreate={props.canCreate}
                networkDeviceId={props.device?.id}
              />
            );
          },
        )}
      </div>
    </Modal>
  );
};

export default NetworkEventAlertsModal;
