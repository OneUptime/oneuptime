import { getHiddenAddressRulesRoute } from "../HiddenClientAddressRoute";
import { OPEN_SCRUB_RULES } from "../HiddenClientAddressCopy";
import { writeRetrohuntSentence } from "../Retrohunt/DetectionRuleRetrohuntPanel";
import { RUN_ON_PAST_EVENTS } from "../Retrohunt/RetrohuntCopy";
import { RetrohuntSentence } from "../Retrohunt/RetrohuntModel";
import {
  UNCOUNTED_DIALOG_DESCRIPTION,
  UNCOUNTED_TEST_IDS,
} from "./DetectionRuleUncountedCopy";
import {
  UncountedDetail,
  getUncountedDetail,
} from "./DetectionRuleUncountedModel";
import AppLink from "../../AppLink/AppLink";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { DetectionRuleUncounted } from "Common/Types/SecurityEvent/DetectionRuleUncounted";
import Icon from "Common/UI/Components/Icon/Icon";
import Modal from "Common/UI/Components/Modal/Modal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The rule's name, as its row shows it.
  ruleName: string;
  uncounted: DetectionRuleUncounted;
  onClose: () => void;
  // Opens Run on Past Events on the rule, for the whole picture.
  onRunOnPastEvents: () => void;
}

/*
 * WHAT A RULE COULD NOT COUNT, AND WHY (#10547): the dialog the line under
 * a rule's name opens on Detection Rules. Run on Past Events' own sentences
 * for what it left out of the last day's matches - and how many a scrub
 * rule hid, with Open Scrub Rules to the rule that hid them - then, for a
 * rule that counted none of it, that it cannot fire, and why such events
 * are left out. Run on Past Events, its button, shows the rest.
 */
const DetectionRuleUncountedModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const detail: UncountedDetail = getUncountedDetail(props.uncounted);
  const scrubRulesRoute: Route | null = getHiddenAddressRulesRoute(
    detail.scrubRulesSignal,
  );

  return (
    <Modal
      title={props.ruleName}
      isTitleTranslated={true}
      description={UNCOUNTED_DIALOG_DESCRIPTION}
      onClose={props.onClose}
      closeButtonText="Close"
      submitButtonText={RUN_ON_PAST_EVENTS}
      submitButtonStyleType={ButtonStyleType.NORMAL}
      onSubmit={props.onRunOnPastEvents}
    >
      <div className="space-y-3" data-testid={UNCOUNTED_TEST_IDS.dialog}>
        <div className="flex items-start gap-2 text-sm text-gray-700">
          <Icon
            icon={IconProp.Info}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
          />
          <p>
            {detail.lines
              .map((sentence: RetrohuntSentence): string => {
                return writeRetrohuntSentence(translator, sentence);
              })
              .join(" ")}
            {scrubRulesRoute ? (
              <>
                {" "}
                <AppLink
                  className="font-medium text-indigo-600 underline hover:text-indigo-500"
                  to={scrubRulesRoute}
                  dataTestId={UNCOUNTED_TEST_IDS.scrubRulesLink}
                >
                  {translator.translateText(OPEN_SCRUB_RULES) ||
                    OPEN_SCRUB_RULES}
                </AppLink>
              </>
            ) : (
              <></>
            )}
          </p>
        </div>
        {detail.afterLines.map((line: string): ReactElement => {
          return (
            <p key={line} className="text-sm text-gray-600">
              {translator.translateText(line)}
            </p>
          );
        })}
      </div>
    </Modal>
  );
};

export default DetectionRuleUncountedModal;
