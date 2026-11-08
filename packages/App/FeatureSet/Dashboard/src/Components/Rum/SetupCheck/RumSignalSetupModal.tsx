import IconProp from "Common/Types/Icon/IconProp";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import SetupGuideCard, {
  SetupGuideRenderContext,
} from "../../SetupGuide/SetupGuideCard";
import { SetupGuideContent } from "../../SetupGuide/SetupGuide";
import { getRumSignalSetupGuide } from "../RumSignalSetupGuide";
import {
  RumPanelSignal,
  SET_UP_EXCEPTIONS,
  SET_UP_LOGS,
} from "./RumSignalWords";

/*
 * "Set up exceptions" / "Set up logs" (issue #5770): the few lines that
 * send a browser application's uncaught errors, or its log records, as a
 * bare setup guide in a dialog - its code filled in with this install's
 * URL and, for logs, the Browser key picked in its first step. Opened from
 * an empty Exceptions or Logs chart, the empty Logs page and the setup
 * check. A mobile app is sent to the Mobile Setup docs instead: what it
 * needs depends on its SDK.
 */

export const EXCEPTIONS_SETUP_DESCRIPTION: string = translationKey(
  "Report the errors {{application}} throws, so they appear under Exceptions.",
);
export const LOGS_SETUP_DESCRIPTION: string = translationKey(
  "Send log records from {{application}}, so they appear on its Logs page.",
);

export interface ComponentProps {
  signal: RumPanelSignal;
  // The application's service.name.
  appName: string;
  onClose: () => void;
}

const RumSignalSetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isExceptions: boolean = props.signal === "exceptions";

  const title: string = isExceptions ? SET_UP_EXCEPTIONS : SET_UP_LOGS;
  const description: string = translator.translateTemplate(
    isExceptions ? EXCEPTIONS_SETUP_DESCRIPTION : LOGS_SETUP_DESCRIPTION,
    { application: props.appName },
  );

  return (
    <Modal
      title={title}
      description={description}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid={`rum-${props.signal}-setup`}>
        <SetupGuideCard
          isBare={true}
          title={title}
          description={description}
          icon={isExceptions ? IconProp.Bug : IconProp.Logs}
          newKeyName={translationKey("RUM key")}
          // The log exporter ships in the page: Browser keys only.
          getKeyTypeFilter={(): TelemetryIngestionKeyType => {
            return TelemetryIngestionKeyType.Browser;
          }}
          getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
            return getRumSignalSetupGuide({
              signal: props.signal,
              oneuptimeUrl: context.oneuptimeUrl,
              apiKey: context.apiKey,
            });
          }}
        />
      </div>
    </Modal>
  );
};

export default RumSignalSetupModal;
