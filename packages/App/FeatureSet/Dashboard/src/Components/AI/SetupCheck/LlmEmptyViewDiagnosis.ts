import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  LlmEmptyViewFinding,
  LlmEmptyViewFindingKey,
  diagnoseEmptyLlmView,
} from "Common/Types/Telemetry/LlmSetupCheckApi";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
} from "Common/UI/Components/Table/TableEmptyState";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import { getLlmPageRoute } from "../../LlmConversations/LlmConversationRoutes";
import { LLM_CONNECT_WAY_QUERY_PARAM } from "../Connect/LlmConnectWays";
import {
  ACTION_TITLES,
  LlmEmptyView,
  LlmEmptyViewAction,
  LlmEmptyViewWords,
  NOTHING_TITLE,
  getLlmEmptyViewWords,
  getWidenTitle,
} from "./LlmSetupCheckWords";
import { LlmSetupCheckState } from "./useLlmSetupCheck";

/*
 * WHAT AN EMPTY CONVERSATIONS OR CALLS VIEW SAYS: one finding from the
 * project's setup check, and the one next step it calls for.
 *
 * Before, the empty Conversations view described the product - where
 * conversations come from in general - and a project whose OpenAI and
 * Azure OpenAI accounts were connected and working still did not learn
 * that those accounts bring usage and cost, never a conversation, and that
 * none of its apps had sent an AI call. Now it says that, for this project:
 * the calls are just outside the time range, an app calls OpenAI with
 * nothing recording it, a company AI tool is quiet or broken, the provider
 * accounts or coding assistants bring usage only - or, when nothing has
 * arrived at all, how AI comes in.
 *
 * Pure (a state in, words and actions out), so both views and the tests
 * share it.
 */

export interface LlmEmptyViewState {
  findingKey: LlmEmptyViewFindingKey | "checking";
  title: string;
  description: string;
  actions: Array<TableEmptyStateAction>;
}

// While the check reads: the view's own empty heading, and a word on why.
export const CHECKING_TITLE: Record<LlmEmptyView, string> = NOTHING_TITLE;

export const CHECKING_SENTENCE: string = translationKey(
  "Checking what your AI is sending…",
);

// Where "Send your app's AI calls" goes: Connect, on Your apps.
export function getSendCallsRoute(): Route {
  return new Route(
    getLlmPageRoute(PageMap.LLM_CONNECT).toString(),
  ).addQueryParams({ [LLM_CONNECT_WAY_QUERY_PARAM]: "apps" });
}

export function getProviderUsageRoute(): Route {
  return new Route(getLlmPageRoute(PageMap.LLM_USAGE).toString()).addQueryParams(
    { source: "providers" },
  );
}

const ACTION_ICONS: Record<LlmEmptyViewAction, IconProp> = {
  "send-calls": IconProp.Code,
  "widen-range": IconProp.Calendar,
  "open-connect": IconProp.Link,
  "see-usage": IconProp.ChartBar,
  "see-provider-usage": IconProp.CreditCard,
};

export function getLlmEmptyViewState(data: {
  view: LlmEmptyView;
  check: LlmSetupCheckState;
  translator: Translator;
  serviceName: (serviceId: string) => string;
  now: Date;
  // Called with the range to show; absent when the view has none.
  onWiden?:
    | ((widenTo: { range: TimeRange; startTime?: Date | undefined }) => void)
    | undefined;
}): LlmEmptyViewState {
  if (data.check.kind === "loading" || data.check.kind === "idle") {
    return {
      findingKey: "checking",
      title: CHECKING_TITLE[data.view],
      description:
        data.translator.translateText(CHECKING_SENTENCE) || CHECKING_SENTENCE,
      actions: [],
    };
  }

  const finding: LlmEmptyViewFinding = diagnoseEmptyLlmView(
    data.check.kind === "loaded" ? data.check.check : null,
    { hasWindow: Boolean(data.onWiden) },
  );

  const words: LlmEmptyViewWords = getLlmEmptyViewWords({
    finding,
    view: data.view,
    translator: data.translator,
    serviceName: data.serviceName,
    now: data.now,
  });

  const toAction: (
    action: LlmEmptyViewAction,
    style: TableEmptyStateActionStyle,
  ) => TableEmptyStateAction | null = (
    action: LlmEmptyViewAction,
    style: TableEmptyStateActionStyle,
  ): TableEmptyStateAction | null => {
    const base: { icon: IconProp; style: TableEmptyStateActionStyle } = {
      icon: ACTION_ICONS[action],
      style: style,
    };

    switch (action) {
      case "widen-range": {
        if (!data.onWiden || !words.widenTo) {
          return null;
        }

        const widenTo: { range: TimeRange; startTime?: Date | undefined } =
          words.widenTo;

        return {
          ...base,
          title: getWidenTitle(widenTo, data.translator),
          dataTestId: "llm-empty-widen-range",
          onClick: () => {
            data.onWiden!(widenTo);
          },
        };
      }
      case "send-calls":
        return {
          ...base,
          title: ACTION_TITLES["send-calls"],
          dataTestId: "llm-empty-send-calls",
          onClick: () => {
            Navigation.navigate(getSendCallsRoute());
          },
        };
      case "open-connect":
        return {
          ...base,
          title: ACTION_TITLES["open-connect"],
          dataTestId: "llm-empty-open-connect",
          onClick: () => {
            Navigation.navigate(getLlmPageRoute(PageMap.LLM_CONNECT));
          },
        };
      case "see-usage":
        return {
          ...base,
          title: ACTION_TITLES["see-usage"],
          dataTestId: "llm-empty-see-usage",
          onClick: () => {
            Navigation.navigate(getLlmPageRoute(PageMap.LLM_USAGE));
          },
        };
      case "see-provider-usage":
        return {
          ...base,
          title: ACTION_TITLES["see-provider-usage"],
          dataTestId: "llm-empty-see-provider-usage",
          onClick: () => {
            Navigation.navigate(getProviderUsageRoute());
          },
        };
      default:
        return null;
    }
  };

  const actions: Array<TableEmptyStateAction> = [];
  const primary: TableEmptyStateAction | null = toAction(
    words.primary,
    TableEmptyStateActionStyle.Button,
  );

  if (primary) {
    actions.push(primary);
  }

  /*
   * A widen button that has nothing to widen (a view with no time range)
   * gives way to the secondary action as the main one.
   */
  if (words.secondary) {
    const secondary: TableEmptyStateAction | null = toAction(
      words.secondary,
      primary
        ? TableEmptyStateActionStyle.Link
        : TableEmptyStateActionStyle.Button,
    );

    if (secondary) {
      actions.push(secondary);
    }
  }

  return {
    findingKey: finding.key,
    title: words.title,
    description: words.description,
    actions: actions,
  };
}
