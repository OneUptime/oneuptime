import {
  EXPOSURE_CARD_PLACE,
  EXPOSURE_TEST_IDS,
  NOT_ASSESSED_TITLE,
  WAS_IT_A_BREACH,
} from "./ExposureAssessmentCopy";
import { answerChecklistItem, say } from "./ExposureAssessmentModel";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { ExposureChecklistItem } from "Common/Types/DataSecurity/ExposureChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import Link from "Common/UI/Components/Link/Link";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE TASK OF THE CLOSE A DATA EXPOSURE CHECKLIST, ANSWERED (#10954): under
 * the task on the case's Tasks page, the line the Was It a Breach? card
 * answers it with - "Reads were not logged. Treat the data as read.",
 * "GDPR Article 33 may apply first: due ...", "2 secrets to rotate." - in
 * one quiet line, and a link that lands on the card on the case's
 * Overview. A case not assessed yet says so, with the same link: the card
 * is where it is assessed.
 */

export interface ComponentProps {
  caseId: ObjectID;
  item: ExposureChecklistItem;
  answer: DataSecurityExposureAssessmentResponse;
}

// The case's Overview, landing on the Was It a Breach? card.
export function getExposureCardRoute(caseId: ObjectID): Route {
  return getRouteToPageAnchor(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
      { modelId: caseId },
    ),
    EXPOSURE_CARD_PLACE,
  );
}

const ExposureTaskAnswer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const words: string = props.answer.view
    ? answerChecklistItem({
        item: props.item,
        view: props.answer.view,
        assessment: props.answer.assessment,
        translator,
        isOnTasksPage: true,
      })
    : say(translator, NOT_ASSESSED_TITLE);

  return (
    <div
      className="mt-0.5 flex items-start gap-1.5 text-xs leading-5 text-gray-600"
      data-testid={EXPOSURE_TEST_IDS.taskAnswer}
      data-item={props.item}
    >
      <Icon
        icon={IconProp.Scale}
        className="mt-0.5 h-3.5 w-3.5 flex-none text-gray-400"
      />
      <p className="min-w-0 break-words">
        {words}
        <span aria-hidden="true" className="px-1 text-gray-400">
          <InlineSeparator markOnly />
        </span>
        <Link
          to={getExposureCardRoute(props.caseId)}
          className="whitespace-nowrap font-medium text-indigo-600 hover:underline"
          dataTestId={`${EXPOSURE_TEST_IDS.taskAnswer}-link`}
        >
          {say(translator, WAS_IT_A_BREACH)}
        </Link>
      </p>
    </div>
  );
};

export default ExposureTaskAnswer;
