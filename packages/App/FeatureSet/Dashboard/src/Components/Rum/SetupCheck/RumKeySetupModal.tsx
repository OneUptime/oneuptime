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
import {
  RumClient,
  getRumIngestionKeyType,
  resolveRumClient,
} from "../RumSetupGuide";
import { PICK_ANOTHER_KEY } from "../../Telemetry/IngestRefusalWords";
import { getRumKeySwapGuide } from "./RumKeySwapGuide";

/*
 * "Pick another key" (issue #6378): what a RUM application sends is refused
 * because its key is turned off or expired, so the fix is to send with
 * another. Not the application's whole setup guide - it is set up - but the
 * steps a new key takes (RumKeySwapGuide): pick one that is not refused, or
 * create one; put it where the refused one is, the line shown with the new
 * key in it; deploy. A Browser key for a browser app, a Server key for a
 * mobile one. Opened from the setup check and from the empty Exceptions and
 * Logs.
 */

export const PICK_ANOTHER_KEY_DESCRIPTION: string = translationKey(
  "The key this app sends with is turned off or has expired, so everything sent with it is refused. Put another key in its place.",
);

export interface ComponentProps {
  // "browser" or "mobile", as ingest records it: which key type, which line.
  clientType?: string | undefined;
  onClose: () => void;
}

const RumKeySetupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const client: RumClient = resolveRumClient(props.clientType);

  return (
    <Modal
      title={PICK_ANOTHER_KEY}
      description={PICK_ANOTHER_KEY_DESCRIPTION}
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Done"
    >
      <div data-testid="rum-pick-key-setup" data-client={client}>
        <SetupGuideCard
          isBare={true}
          title={PICK_ANOTHER_KEY}
          description={PICK_ANOTHER_KEY_DESCRIPTION}
          icon={IconProp.Key}
          // A key made here replaces the refused one, and says so by its name.
          newKeyName={translationKey("RUM replacement key")}
          getKeyTypeFilter={(): TelemetryIngestionKeyType => {
            return getRumIngestionKeyType(client);
          }}
          getContent={(context: SetupGuideRenderContext): SetupGuideContent => {
            // Every word is a key each locale words: laid out the reader's way.
            return {
              ...getRumKeySwapGuide({
                client,
                oneuptimeUrl: context.oneuptimeUrl,
                apiKey: context.apiKey,
              }),
              language: translator.language,
            };
          }}
        />
      </div>
    </Modal>
  );
};

export default RumKeySetupModal;
