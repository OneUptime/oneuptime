import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import SloOverviewEmptyState from "../Slo/SloOverviewEmptyState";
import { USED_BY_CARD_WORDS, UsedByCardWords } from "./UsedByWords";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { UsedByRecordKind } from "Common/Types/UsedBy/UsedBy";
import Link from "Common/UI/Components/Link/Link";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Nothing refers to the record: say so, and what to do next, with the page
 * it is done on - "Nothing uses this schedule yet. Add it to an on-call
 * policy's escalation rule." and Go to on-call policies.
 */
const UsedByEmpty: FunctionComponent<{
  recordKind: UsedByRecordKind;
}> = (props: { recordKind: UsedByRecordKind }): ReactElement => {
  const translator: Translator = useTranslator();
  const words: UsedByCardWords = USED_BY_CARD_WORDS[props.recordKind];

  return (
    <SloOverviewEmptyState
      dataTestId="used-by-empty"
      icon={IconProp.Link}
      title={words.emptyTitle}
      description={words.emptyDescription}
      actions={
        words.emptyActionTitle && words.emptyActionPage ? (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[words.emptyActionPage] as Route,
            )}
            className="text-sm font-medium text-indigo-700 hover:underline"
            dataTestId="used-by-empty-action"
          >
            {translator.translateText(words.emptyActionTitle)}
          </Link>
        ) : undefined
      }
    />
  );
};

export default UsedByEmpty;
