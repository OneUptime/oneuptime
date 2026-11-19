import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ON_CALL_SETUP } from "./OnCall/OnCallSetup";
import { STATUS_PAGE_SETUP } from "./StatusPage/StatusPageSetup";
import { TELEMETRY_SETUP } from "./Telemetry/TelemetrySetup";
import { WEBSITE_DOWN_SETUP } from "./WebsiteDown/WebsiteDownSetup";
import Route from "Common/Types/API/Route";
import {
  AIChatToolAction,
  AIChatToolActionStatus,
} from "Common/Types/AI/AIChatTypes";
import {
  ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
  ADD_TO_ON_CALL_POLICY_TOOL_NAME,
  PUBLISH_STATUS_PAGE_TOOL_NAME,
  SET_HOW_TO_REACH_ME_TOOL_NAME,
  SET_UP_PAGING_TOOL_NAME,
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
  getAISetupPlanParts,
  isAISetupAction,
} from "Common/Types/AI/AISetupActions";
import { JSONObject } from "Common/Types/JSON";
import {
  GuidedSetupEntryPoint,
  withGuidedSetupEntryPoint,
} from "Common/UI/Utils/GuidedSetupEvents";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE GUIDED SETUPS AND ASK AI LINK TO EACH OTHER (#7245).
 *
 * The same job can be done two ways: a guided setup, step by step, or Ask
 * AI, from one sentence on one approval card (#6829). Each now offers the
 * other where a person picks one:
 *
 *   - "Describe it instead", on a guided setup while its first step is
 *     open and nothing is done yet: Ask AI opens with the setup's goal
 *     written in its box, built from what the step knows already (the
 *     address typed, the page's name), unsent - the person edits it and
 *     sends it (getDescribeItPrompt).
 *   - "Open in guided setup", on an Ask AI setup plan's card: the guided
 *     setup that does the plan's job, its first step filled in from the
 *     plan where the setup reads its address (the address to check, the
 *     status page's name). The plan's card stays as it was, to approve
 *     later (getGuidedSetupForPlan).
 *
 * React-free, so its tests read the links without a page.
 */

// What a guided setup's first step reads from its address, when it is opened with it.
export const GUIDED_SETUP_ADDRESS_QUERY: string = "address";
export const GUIDED_SETUP_API_QUERY: string = "api";
export const GUIDED_SETUP_NAME_QUERY: string = "name";

// The longest prefill read from an address: an address or a page's name, never a page of text.
export const GUIDED_SETUP_PREFILL_MAX_LENGTH: number = 500;

// The link's words, and the card's.
export const ASK_AI_GUIDED_SETUP_COPY: {
  describeItInstead: string;
  openInGuidedSetup: string;
} = {
  describeItInstead: translationKey("Describe it instead"),
  openInGuidedSetup: translationKey("Open in guided setup"),
};

/*
 * The goal each guided setup sets up, as the person would say it to Ask AI:
 * the setup's own job, in their words. A template names what the step knows
 * already; without it, the sentence says it plainly.
 */
export const DESCRIBE_IT_PROMPTS: {
  websiteDown: string;
  websiteDownAddress: string;
  websiteDownApi: string;
  onCall: string;
  statusPage: string;
  statusPageNamed: string;
  telemetry: string;
} = {
  websiteDown: translationKey(
    "Monitor my website and page me when it is down.",
  ),
  websiteDownAddress: translationKey(
    "Monitor {{address}} and page me when it is down.",
  ),
  websiteDownApi: translationKey(
    "Monitor the API at {{address}} and page me when it is down.",
  ),
  onCall: translationKey("Page me for every new incident and alert."),
  statusPage: translationKey("Publish a status page that shows my monitors."),
  statusPageNamed: translationKey(
    "Publish a status page called {{name}} that shows my monitors.",
  ),
  telemetry: translationKey(
    "Help me send my service's logs, metrics and traces to OneUptime, and alert me when it has errors.",
  ),
};

// What a guided setup's first step knows, for its sentence.
export interface DescribeItFacts {
  // The address typed in the website setup's first step.
  address?: string | undefined;
  isApi?: boolean | undefined;
  // The status page's name in the status page setup's first step.
  name?: string | undefined;
}

// The sentence Ask AI opens with for a guided setup, in the reader's language.
export function getDescribeItPrompt(data: {
  setup: string;
  facts?: DescribeItFacts | undefined;
  translator: Translator;
}): string {
  const facts: DescribeItFacts = data.facts || {};
  const say: (key: string, values?: Record<string, string>) => string = (
    key: string,
    values?: Record<string, string>,
  ): string => {
    return values
      ? data.translator.translateTemplate(key, values)
      : data.translator.translateText(key) || key;
  };
  const address: string = (facts.address || "").trim();
  const name: string = (facts.name || "").trim();

  switch (data.setup) {
    case WEBSITE_DOWN_SETUP:
      if (!address) {
        return say(DESCRIBE_IT_PROMPTS.websiteDown);
      }

      return say(
        facts.isApi
          ? DESCRIBE_IT_PROMPTS.websiteDownApi
          : DESCRIBE_IT_PROMPTS.websiteDownAddress,
        { address: address },
      );
    case ON_CALL_SETUP:
      return say(DESCRIBE_IT_PROMPTS.onCall);
    case STATUS_PAGE_SETUP:
      return name
        ? say(DESCRIBE_IT_PROMPTS.statusPageNamed, { name: name })
        : say(DESCRIBE_IT_PROMPTS.statusPage);
    case TELEMETRY_SETUP:
      return say(DESCRIBE_IT_PROMPTS.telemetry);
    default:
      return "";
  }
}

// ask_ai/setup_described_instead: which setup the person left for Ask AI.
export function getDescribedInsteadEvent(setup: string): JSONObject {
  return { setup: setup };
}

/*
 * A plan's guided setup: the one that does the plan's job, and what its
 * first step is filled in with.
 */
export interface GuidedSetupForPlan {
  // The setup's key in its events (GuidedSetupFrame's setup).
  setup: string;
  page: PageMap;
  // What its first step reads from its address.
  query: Record<string, string>;
}

/*
 * Which guided setup does a plan's job, first to last: the one the plan's
 * main part is - a website monitor's setup also decides who is paged, so a
 * plan with one opens it whatever else it holds; then a status page's;
 * then a service's monitors'; then paging's. A plan that only invites
 * people has none.
 */
const SETUP_OF_PART: ReadonlyArray<{ tools: Array<string>; setup: string }> = [
  { tools: [SET_UP_WEBSITE_MONITORING_TOOL_NAME], setup: WEBSITE_DOWN_SETUP },
  {
    tools: [
      PUBLISH_STATUS_PAGE_TOOL_NAME,
      ADD_MONITORS_TO_STATUS_PAGE_TOOL_NAME,
    ],
    setup: STATUS_PAGE_SETUP,
  },
  { tools: [SET_UP_SERVICE_MONITOR_TOOL_NAME], setup: TELEMETRY_SETUP },
  {
    tools: [
      SET_UP_PAGING_TOOL_NAME,
      ADD_TO_ON_CALL_POLICY_TOOL_NAME,
      SET_HOW_TO_REACH_ME_TOOL_NAME,
    ],
    setup: ON_CALL_SETUP,
  },
];

const PAGE_OF_SETUP: Readonly<Record<string, PageMap>> = {
  [WEBSITE_DOWN_SETUP]: PageMap.MONITOR_GUIDED_SETUP,
  [STATUS_PAGE_SETUP]: PageMap.STATUS_PAGES_GUIDED_SETUP,
  [TELEMETRY_SETUP]: PageMap.SERVICES_GUIDED_SETUP,
  [ON_CALL_SETUP]: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
};

function readText(args: JSONObject | undefined, key: string): string {
  const value: unknown = args?.[key];

  return typeof value === "string"
    ? value.trim().substring(0, GUIDED_SETUP_PREFILL_MAX_LENGTH)
    : "";
}

// The actions a plan's card waits on: its setup actions, pending.
function pendingSetupActions(
  actions: ReadonlyArray<AIChatToolAction>,
): Array<AIChatToolAction> {
  return actions.filter((action: AIChatToolAction): boolean => {
    return (
      action.status === AIChatToolActionStatus.Pending &&
      action.requiresApproval &&
      isAISetupAction(action.toolName)
    );
  });
}

export function getGuidedSetupForPlan(
  actions: ReadonlyArray<AIChatToolAction>,
): GuidedSetupForPlan | null {
  const pending: Array<AIChatToolAction> = pendingSetupActions(actions);

  for (const part of SETUP_OF_PART) {
    const action: AIChatToolAction | undefined = pending.find(
      (candidate: AIChatToolAction): boolean => {
        return part.tools.includes(candidate.toolName);
      },
    );

    if (!action) {
      continue;
    }

    const query: Record<string, string> = {};

    if (part.setup === WEBSITE_DOWN_SETUP) {
      const address: string = readText(action.arguments, "address");

      if (address) {
        query[GUIDED_SETUP_ADDRESS_QUERY] = address;
      }

      if (action.arguments?.["isApi"] === true) {
        query[GUIDED_SETUP_API_QUERY] = "true";
      }
    }

    if (part.setup === STATUS_PAGE_SETUP) {
      const name: string =
        action.toolName === PUBLISH_STATUS_PAGE_TOOL_NAME
          ? readText(action.arguments, "name")
          : readText(action.arguments, "statusPage");

      if (name) {
        query[GUIDED_SETUP_NAME_QUERY] = name;
      }
    }

    return {
      setup: part.setup,
      page: PAGE_OF_SETUP[part.setup]!,
      query: query,
    };
  }

  return null;
}

/*
 * The guided setup's address in this project, opened from Ask AI
 * (?from=ask_ai, so its started event says so) with what its first step
 * reads.
 */
export function getGuidedSetupRoute(link: GuidedSetupForPlan): Route {
  const base: string = withGuidedSetupEntryPoint(
    RouteUtil.populateRouteParams(RouteMap[link.page] as Route).toString(),
    GuidedSetupEntryPoint.AskAi,
  );
  const query: string = Object.entries(link.query)
    .map(([key, value]: [string, string]): string => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");

  return new Route(query ? `${base}&${query}` : base);
}

// ask_ai/setup_opened_in_guided_setup: the setup it opened, and the plan's parts.
export function getOpenedInGuidedSetupEvent(data: {
  link: GuidedSetupForPlan;
  actions: ReadonlyArray<AIChatToolAction>;
}): JSONObject {
  return {
    setup: data.link.setup,
    parts: getAISetupPlanParts(
      pendingSetupActions(data.actions).map(
        (action: AIChatToolAction): string => {
          return action.toolName;
        },
      ),
    ).join("."),
  };
}

/*
 * What a guided setup's first step is opened with, from its address: the
 * text of a query, trimmed and no longer than an address or a name - never
 * what a link could stuff into the page.
 */
export function readGuidedSetupPrefill(
  value: string | null | undefined,
): string {
  return (value || "").trim().substring(0, GUIDED_SETUP_PREFILL_MAX_LENGTH);
}
