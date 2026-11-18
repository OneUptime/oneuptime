import AttentionItemList, {
  ATTENTION_ITEM_TEST_ID,
  ATTENTION_OWNERS_TEST_ID,
  MAX_OWNER_NAMES,
} from "./AttentionItemList";
import { getIssuesRoute } from "./IssuesCopy";
import { isStoreWaitingForFirstRead } from "./StoreStatusPill";
import { DataAttentionItem } from "Common/Types/DataObservability/DataObservabilityAttention";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * NEEDS ATTENTION: THE STATE OF THE DATA, FIRST.
 *
 * What is broken, late or drifting now, worst first - the most urgent of
 * them, each drawn as the Issues page draws it (AttentionItemList) - and,
 * when anything does, All Issues, which lists every one with filters
 * (#6549). With nothing to say, it says what was looked at and found well.
 */

export const NEEDS_ATTENTION_TEST_ID: string =
  "data-observability-needs-attention";

// The rows' own test ids and limits, where the Overview's tests have always read them.
export { ATTENTION_ITEM_TEST_ID, ATTENTION_OWNERS_TEST_ID, MAX_OWNER_NAMES };

export interface ComponentProps {
  items: Array<DataAttentionItem>;
  // How many there are in all: more than are listed, on a busy project.
  totalCount: number;
  stores: Array<DataObservabilityStoreSummary>;
}

const OverviewNeedsAttention: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const description: string | undefined =
    props.totalCount === 0
      ? translator.translateText("Nothing is broken or late right now.")
      : props.totalCount > props.items.length
        ? translator.translateTemplate(
            "The {{shown}} most urgent of {{count}}, worst first: what failed, then what is late.",
            {
              shown: translator.formatNumber(props.items.length),
              count: translator.formatNumber(props.totalCount),
            },
          )
        : translator.translateText(
            "Worst first: what failed, then what is late.",
          );

  return (
    <div data-testid={NEEDS_ATTENTION_TEST_ID}>
      <Card
        title="Needs Attention"
        description={description}
        buttons={
          props.totalCount > 0
            ? [
                {
                  title: "All Issues",
                  buttonStyle: ButtonStyleType.NORMAL,
                  icon: IconProp.List,
                  onClick: () => {
                    Navigation.navigate(getIssuesRoute());
                  },
                },
              ]
            : []
        }
      >
        {props.items.length === 0 ? (
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
            </div>
            <p className="text-sm text-gray-600">
              {/*
               * "Every database was read" is not so while one just connected
               * waits for its first read: it says when its tables are watched.
               */}
              {props.stores.some(isStoreWaitingForFirstRead)
                ? translator.translateText(
                    "A database just connected is read for the first time within a few minutes, and its tables are watched from then on.",
                  )
                : translator.translateText(
                    "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does.",
                  )}
            </p>
          </div>
        ) : (
          <AttentionItemList items={props.items} stores={props.stores} />
        )}
      </Card>
    </div>
  );
};

export default OverviewNeedsAttention;
