import React, { FunctionComponent, ReactElement } from "react";
import Protocol from "Common/Types/API/Protocol";
import {
  HostCollectorOsType,
  getHostCollectorOsType,
} from "Common/Types/HostCollector/HostCollector";
import {
  HostCollectorServiceCommands,
  getHostCollectorInstallCommandLanguage,
  getHostCollectorServiceCommands,
  getHostCollectorUninstallCommand,
} from "Common/Utils/HostCollector/HostCollectorInstallCommand";
import Card from "Common/UI/Components/Card/Card";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { codeBlock, getSetupGuideOneUptimeUrl } from "../SetupGuide/SetupGuide";
import SetupGuideMarkdown from "../SetupGuide/SetupGuideMarkdown";

/*
 * Checking on the collector OneUptime manages from a shell on the host: its
 * service, its log, a restart, and taking it off again - in the commands of
 * the host's own system.
 */

export interface ComponentProps {
  osType: string | null | undefined;
}

interface OnHostItem {
  title: string;
  description: string;
  code?: string | undefined;
}

const HostCollectorOnHostCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const osType: HostCollectorOsType =
    getHostCollectorOsType(props.osType) || HostCollectorOsType.Linux;
  const commands: HostCollectorServiceCommands =
    getHostCollectorServiceCommands(osType);
  const language: string = getHostCollectorInstallCommandLanguage(osType);

  const items: Array<OnHostItem> = [
    {
      title: "Check the service",
      description: "Whether the collector's service runs.",
      code: commands.status,
    },
    {
      title: "Read its log",
      description:
        "What the supervisor and the collector said last, such as why a config did not start.",
      code: commands.logs,
    },
    {
      title: "Restart it",
      description: "It asks OneUptime for its config again as it starts.",
      code: commands.restart,
    },
    {
      title: "Update it, or change its labels",
      description:
        "Run the command from Add Host on the Hosts page again, with the labels you want: the host keeps its place in OneUptime and gets the collector release this OneUptime installs.",
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
    },
  ];

  return (
    <Card
      title="On the host"
      description="Check on the collector, or take it off the host, from a shell on the host."
    >
      <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
        <ul className="space-y-6" data-testid="host-collector-on-host">
          {items.map((item: OnHostItem): ReactElement => {
            return (
              <li key={item.title} className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">
                  {translator.translateText(item.title)}
                </h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  {translator.translateText(item.description)}
                </p>
                {item.code ? (
                  <div className="mt-2">
                    <SetupGuideMarkdown text={codeBlock(language, item.code)} />
                  </div>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
};

export default HostCollectorOnHostCard;
