import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Link from "Common/UI/Components/Link/Link";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { getRouteToPageAnchor } from "Common/UI/Utils/PageAnchor";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AI_RULES_FIX_NOTHING_COPY,
  AI_RULES_FIX_NOTHING_TEST_IDS,
  AiRuleFixCounts,
  AiRulesFixNothingLaneKind,
  isAiRulesFixingNothing,
} from "./AiRulesFixNothing";

/*
 * "Every AI rule says Don't fix, so nothing is fixed": the line a lane's
 * fix switch says while it is on and its rules fix nothing
 * (AiRulesFixNothing), with the way to the rules - More settings opened at
 * the AI rules card, on the same page.
 */

/*
 * How many of a lane's enabled rules there are, and how many of them fix.
 * Read as the reader, by the lane's trigger; a read that fails says
 * nothing (null).
 */
export async function readAiRuleFixCounts(
  triggerEntityType: string,
): Promise<AiRuleFixCounts | null> {
  try {
    const [enabled, fixing]: [number, number] = await Promise.all([
      ModelAPI.count<AutoRemediationRule>({
        modelType: AutoRemediationRule,
        query: {
          triggerEntityType: triggerEntityType,
          isEnabled: true,
        } as unknown as Query<AutoRemediationRule>,
      }),
      ModelAPI.count<AutoRemediationRule>({
        modelType: AutoRemediationRule,
        query: {
          triggerEntityType: triggerEntityType,
          isEnabled: true,
          fixes: true,
        } as unknown as Query<AutoRemediationRule>,
      }),
    ]);

    return { enabled, fixing };
  } catch {
    return null;
  }
}

/*
 * Whether the lane's rules fix nothing, read when the page opens and again
 * on refresh() - which the page calls each time its rules table reads its
 * rules, so a rule added, changed or turned off is heard at once. Only the
 * newest read counts.
 */
export function useAiRulesFixNothing(triggerEntityType: string): {
  isFixingNothing: boolean;
  refresh: () => void;
} {
  const [counts, setCounts] = useState<AiRuleFixCounts | null>(null);
  const readNumber: MutableRefObject<number> = useRef<number>(0);

  const refresh: () => void = useCallback((): void => {
    readNumber.current += 1;
    const thisRead: number = readNumber.current;

    void readAiRuleFixCounts(triggerEntityType).then(
      (next: AiRuleFixCounts | null): void => {
        if (thisRead === readNumber.current) {
          setCounts(next);
        }
      },
    );
  }, [triggerEntityType]);

  useEffect(() => {
    refresh();

    return () => {
      // A read that lands after the page is gone changes nothing.
      readNumber.current += 1;
    };
  }, [refresh]);

  return { isFixingNothing: isAiRulesFixingNothing(counts), refresh };
}

/*
 * A settings page's warning for its fix switch: the line under the switch
 * while it is on and the lane's rules fix nothing, nothing for any other
 * switch or state; and refresh(), for the page to call each time its rules
 * table reads its rules.
 */
export function useAiRulesFixNothingSwitchWarning(data: {
  triggerEntityType: string;
  // The switch that says it fixes: "Fix new incidents automatically".
  switchColumn: string;
  kind: AiRulesFixNothingLaneKind;
  rulesAnchor: string;
}): {
  getWarning: (column: string, isOn: boolean) => ReactNode;
  refresh: () => void;
} {
  const { isFixingNothing, refresh } = useAiRulesFixNothing(
    data.triggerEntityType,
  );

  const getWarning: (column: string, isOn: boolean) => ReactNode = (
    column: string,
    isOn: boolean,
  ): ReactNode => {
    if (column !== data.switchColumn || !isOn || !isFixingNothing) {
      return undefined;
    }

    return (
      <AiRulesFixNothingWarning
        kind={data.kind}
        rulesAnchor={data.rulesAnchor}
      />
    );
  };

  return { getWarning, refresh };
}

export interface ComponentProps {
  kind: AiRulesFixNothingLaneKind;
  // The rules card's place on this page (its id, and More settings' key).
  rulesAnchor: string;
}

const AiRulesFixNothingWarning: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rulesRoute: Route = getRouteToPageAnchor(
    Navigation.getCurrentRoute(),
    props.rulesAnchor,
  );

  return (
    <span data-testid={AI_RULES_FIX_NOTHING_TEST_IDS.warning}>
      {translator.translateText(AI_RULES_FIX_NOTHING_COPY.sentence[props.kind])}{" "}
      <Link
        to={rulesRoute}
        className="font-medium underline underline-offset-2"
        dataTestId={AI_RULES_FIX_NOTHING_TEST_IDS.link}
      >
        {translator.translateText(AI_RULES_FIX_NOTHING_COPY.link)}
      </Link>
    </span>
  );
};

export default AiRulesFixNothingWarning;
