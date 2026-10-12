import {
  PACKET_CAPTURE_DOCS_PATH,
  PACKET_CAPTURE_TURN_ON_ANCHOR,
  PacketCaptureReadiness,
  PacketCaptureReadinessCopy,
  ReadinessCopy,
  TURN_ON_SETTINGS,
} from "./PacketCaptureViewModel";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { DOCS_URL } from "Common/UI/Config";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  readiness: Exclude<PacketCaptureReadiness, PacketCaptureReadiness.Ready>;
}

/*
 * Why a probe cannot capture yet, and what turns it on. Captures are the
 * probe operator's decision, so this does not offer a switch: it says what
 * to set where the probe runs, and links to the page that shows it for
 * Docker, Docker Compose and Kubernetes.
 */
const PacketCaptureReadinessNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: ReadinessCopy = PacketCaptureReadinessCopy[props.readiness];

  const docsUrl: URL = URL.fromString(
    `${DOCS_URL.toString()}${PACKET_CAPTURE_DOCS_PATH}#${PACKET_CAPTURE_TURN_ON_ANCHOR}`,
  );

  return (
    <div
      className="flex gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4"
      data-testid="packet-capture-readiness"
      data-readiness={props.readiness}
    >
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500">
        <Icon icon={IconProp.SignalSlash} className="h-4 w-4" />
      </div>
      <div className="min-w-0 space-y-2">
        <div className="text-sm font-semibold text-gray-900">
          {translator.translateText(copy.title)}
        </div>
        <div className="text-sm text-gray-600">
          {translator.translateText(copy.body)}
        </div>
        {copy.showsTurnOnSettings ? (
          <ul
            className="space-y-1.5"
            data-testid="packet-capture-turn-on-settings"
          >
            {TURN_ON_SETTINGS.map(
              (setting: { code: string; description: string }) => {
                return (
                  <li
                    key={setting.code}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-gray-600"
                  >
                    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-gray-800 ring-1 ring-gray-200">
                      {setting.code}
                    </code>
                    <span>{translator.translateText(setting.description)}</span>
                  </li>
                );
              },
            )}
          </ul>
        ) : (
          <></>
        )}
        <div>
          <Link
            to={docsUrl}
            openInNewTab={true}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            {translator.translateText("How to turn on packet capture")}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PacketCaptureReadinessNotice;
