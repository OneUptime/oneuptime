import {
  RETROHUNT_TEST_IDS,
  RUN_ON_PAST_EVENTS,
  RUN_ON_PAST_EVENTS_DESCRIPTION,
} from "./RetrohuntCopy";
import { buildRetrohuntRequest } from "./RetrohuntModel";
import DetectionRuleRetrohuntPanel from "./DetectionRuleRetrohuntPanel";
import { JSONObject } from "Common/Types/JSON";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  ruleId: string;
  ruleName: string;
  onClose: () => void;
}

/*
 * A saved rule's Run on Past Events, from its row: the rule as saved, with
 * its exceptions, over past events. Read only - it has Close and nothing
 * to submit.
 */
const DetectionRuleRetrohuntModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Modal
      title={RUN_ON_PAST_EVENTS}
      description={
        <span>
          <span className="block font-medium text-gray-700">
            <IsolatedText text={props.ruleName} />
          </span>
          <span className="block">
            {translator.translateText(RUN_ON_PAST_EVENTS_DESCRIPTION)}
          </span>
        </span>
      }
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Close"
    >
      <div data-testid={RETROHUNT_TEST_IDS.modal}>
        <DetectionRuleRetrohuntPanel
          getRequest={(periodInHours: number): JSONObject => {
            return buildRetrohuntRequest(
              { detectionRuleId: props.ruleId },
              periodInHours,
            );
          }}
        />
      </div>
    </Modal>
  );
};

export default DetectionRuleRetrohuntModal;
