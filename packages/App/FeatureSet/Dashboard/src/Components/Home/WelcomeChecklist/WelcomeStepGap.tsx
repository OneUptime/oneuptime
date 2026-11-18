import { WELCOME_GAP_COPY } from "./WelcomeChecklistCatalog";
import { FindingSentence } from "../../SetupHealth/SetupHealthFindingParts";
import {
  SetupHealthFixLink,
  getSetupHealthFixLink,
} from "../../SetupHealth/SetupHealthWords";
import Route from "Common/Types/API/Route";
import { WelcomeStepGap } from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHY A STEP IS NOT DONE ALTHOUGH ITS RECORD EXISTS, ON HOME (#6938).
 *
 * The server says what is missing (WelcomeStepGap): a Setup health finding
 * about the step's record, or an invitation nobody accepted. Home says it
 * in one line under the step - the finding's own sentence, with the
 * project's names in bold, as Setup Health and the record's page say it
 * (FindingSentence) - and the step opens the page that fixes it: the
 * finding's fix, such as the status page's Monitors or the policy's
 * escalation rules. A gap with no page of its own (an invitation, or a fix
 * that is the server's) leaves the step opening where it always did.
 */

export interface ComponentProps {
  gap: WelcomeStepGap;
}

// The sentence that names what is missing, in the reader's words.
export const WelcomeStepGapSentence: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.gap.finding) {
    return <FindingSentence finding={props.gap.finding} />;
  }

  return (
    <>{translator.translateText(WELCOME_GAP_COPY.invitationNotAccepted)}</>
  );
};

/*
 * What a step with a gap does: the page that fixes its finding and the
 * fix's own words ("Add Monitors"), as Setup Health's button says them, or
 * null for the step's own page - an invitation, or a fix that is the
 * server's.
 */
export const getWelcomeStepGapFix: (data: {
  gap: WelcomeStepGap | null;
  translator: Translator;
}) => SetupHealthFixLink | null = (data: {
  gap: WelcomeStepGap | null;
  translator: Translator;
}): SetupHealthFixLink | null => {
  if (!data.gap || !data.gap.finding) {
    return null;
  }

  return getSetupHealthFixLink({
    finding: data.gap.finding,
    translator: data.translator,
  });
};

// Where a step with a gap leads: its fix's page, or null for its own.
export const getWelcomeStepGapRoute: (data: {
  gap: WelcomeStepGap | null;
  translator: Translator;
}) => Route | null = (data: {
  gap: WelcomeStepGap | null;
  translator: Translator;
}): Route | null => {
  const fix: SetupHealthFixLink | null = getWelcomeStepGapFix(data);

  return fix ? fix.route : null;
};
