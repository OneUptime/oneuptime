import React, { FunctionComponent, ReactElement, useState } from "react";
import Protocol from "Common/Types/API/Protocol";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import {
  HostCollectorOsType,
  getHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorServiceCommands,
  getHostCollectorServiceCommands,
  getHostCollectorUninstallCommand,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getSetupGuideOneUptimeUrl } from "../SetupGuide/SetupGuide";
import CopyableCommand from "../SetupGuide/CopyableCommand";
import AddHostGuide from "./AddHostGuide";

/*
 * Checking on the collector OneUptime manages from a shell on the host: its
 * service, its log, a restart, the install command again (a newer release,
 * other labels) and taking it off again - in the commands of the host's own
 * system, one compact line each, with a copy button.
 */

export interface ComponentProps {
  osType: string | null | undefined;
  // The host: the install command's last step waits for its new collector.
  hostId?: ObjectID | undefined;
  hostName?: string | undefined;
  // Its collector was installed again (the install command ran): read it again.
  onHostConnected?: (() => void) | undefined;
}

interface OnHostItem {
  // English translation keys.
  title: string;
  description: string;
  code?: string | undefined;
  // Drawn under the description, in place of a command.
  action?: ReactElement | undefined;
  testId: string;
}

export const ON_HOST_UPDATE_DESCRIPTION: string = translationKey(
  "Run the install command again with the labels you want. The host keeps its place in OneUptime and gets the collector release that comes with this OneUptime.",
);

const HostCollectorOnHostCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isInstallCommandOpen, setIsInstallCommandOpen] =
    useState<boolean>(false);

  const osType: HostCollectorOsType =
    getHostCollectorOsType(props.osType) || HostCollectorOsType.Linux;
  const commands: HostCollectorServiceCommands =
    getHostCollectorServiceCommands(osType);

  const items: Array<OnHostItem> = [
    {
      title: "Check the service",
      description: "Whether the collector's service runs.",
      code: commands.status,
      testId: "status",
    },
    {
      title: "Read its log",
      description:
        "What the supervisor and the collector said last, such as why a config did not start.",
      code: commands.logs,
      testId: "logs",
    },
    {
      title: "Restart it",
      description: "It asks OneUptime for its config again as it starts.",
      code: commands.restart,
      testId: "restart",
    },
    {
      title: "Update it, or change its labels",
      description: ON_HOST_UPDATE_DESCRIPTION,
      action: (
        <div className="[&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
          <Button
            title="Show the install command"
            icon={IconProp.Terminal}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="host-collector-show-install-command"
            onClick={() => {
              setIsInstallCommandOpen(true);
            }}
          />
        </div>
      ),
      testId: "update",
    },
    {
      title: "Uninstall",
      description:
        "Removes the collector and everything the command installed. The host stays in OneUptime with its history.",
      code: getHostCollectorUninstallCommand({
        osType: osType,
        oneuptimeUrl: getSetupGuideOneUptimeUrl({
          host: HOST,
          isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
        }),
      }),
      testId: "uninstall",
    },
  ];

  return (
    <Card
      title="On the host"
      description="Check on the collector, or take it off the host, from a shell on the host."
    >
      <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
        <ul
          className="divide-y divide-gray-100"
          data-testid="host-collector-on-host"
        >
          {items.map((item: OnHostItem): ReactElement => {
            return (
              <li
                key={item.testId}
                className="min-w-0 py-4 first:pt-0 last:pb-0"
                data-testid={`host-collector-on-host-${item.testId}`}
              >
                <h3 className="text-sm font-medium text-gray-900">
                  {translator.translateText(item.title)}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {translator.translateText(item.description)}
                </p>
                {item.code ? (
                  <div className="mt-2">
                    <CopyableCommand command={item.code} />
                  </div>
                ) : (
                  <></>
                )}
                {item.action ? (
                  <div className="mt-2">{item.action}</div>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {isInstallCommandOpen ? (
        <Modal
          title="Run the install command again"
          description={
            props.hostName
              ? translator.translateTemplate(
                  "Run it on {{host}} to update its collector or change its labels. The host keeps its place and its history in OneUptime.",
                  { host: props.hostName },
                )
              : translator.translateText(
                  "Run it on the host to update its collector or change its labels. The host keeps its place and its history in OneUptime.",
                )
          }
          modalWidth={ModalWidth.Large}
          onClose={() => {
            setIsInstallCommandOpen(false);
          }}
          closeButtonText="Done"
        >
          <div data-testid="host-collector-install-command-modal">
            <AddHostGuide
              isBare={true}
              osType={getHostCollectorOsType(props.osType)}
              hostId={props.hostId}
              onHostConnected={() => {
                props.onHostConnected?.();
              }}
            />
          </div>
        </Modal>
      ) : (
        <></>
      )}
    </Card>
  );
};

export default HostCollectorOnHostCard;
