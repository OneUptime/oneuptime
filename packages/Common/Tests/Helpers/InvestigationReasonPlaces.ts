import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { InvestigationNotStartedCode } from "../../Types/AI/InvestigationNotStartedReason";

/*
 * WHERE EACH REASON SENDS ITS READER (issue #6738).
 *
 * When OneUptime AI does not investigate an incident or alert, the server
 * records a reason with a code and an English next step
 * (InvestigationEligibility), for API readers and older Dashboards. The
 * Dashboard's AI card words the same code itself (InvestigationNotStartedWords)
 * and links to the settings page (InvestigationNotStarted's
 * getSettingsAction). The two must send the reader to the same setting, by
 * the same name, on the same page: the server once said "AI provider" for
 * a setting the Dashboard calls LLM Providers, and nobody could find it.
 *
 * This is the one table both sides are held to:
 *
 *   - `names`: what both next steps name, as the Dashboard draws it - the
 *     setting, or the step when there is no setting to change.
 *   - `page`: the page the card's settings link opens - exactly that page,
 *     and null exactly when the card offers no link - whose path the
 *     server's English writes out instead (it has no link). null for a
 *     fault someone has to look at, or a record created already resolved.
 *   - `alsoPages`: the pages a step names by name besides the link's page,
 *     whose paths the server's English writes out too: the AI Logs, when
 *     nothing was recorded at all.
 *
 * Read by Tests/Server/Utils/AI/InvestigationReasonCardParity (the server's
 * English beside the card's) and Tests/App/Dashboard/InvestigationNotStarted
 * (the card's link). Not a test file itself (jest only collects *.test.ts).
 */

export type InvestigationReasonKind = "incident" | "alert";

export interface InvestigationReasonPlace {
  names: ReadonlyArray<string>;
  page: PageMap | null;
  alsoPages?: ReadonlyArray<PageMap> | undefined;
}

/*
 * Each page's path, as the Dashboard's menus draw it: Project Settings'
 * AI section, and each record's own AI section.
 */
export const INVESTIGATION_REASON_PAGE_PATHS: ReadonlyMap<PageMap, string> =
  new Map<PageMap, string>([
    [PageMap.SETTINGS_AI_FEATURES, "Project Settings → AI → AI Features"],
    [PageMap.SETTINGS_AI_CREDITS, "Project Settings → AI → AI Credits"],
    [
      PageMap.SETTINGS_AI_LLM_PROVIDERS,
      "Project Settings → AI → LLM Providers",
    ],
    [PageMap.INCIDENTS_SETTINGS_AI, "Incidents → AI → Settings"],
    [PageMap.ALERTS_SETTINGS_AI, "Alerts → AI → Settings"],
    [PageMap.INCIDENTS_AI_LOGS, "Incidents → AI → Logs"],
    [PageMap.ALERTS_AI_LOGS, "Alerts → AI → Logs"],
  ]);

// The page every record's own AI settings are on, by its kind.
export function getRecordAiSettingsPage(
  kind: InvestigationReasonKind,
): PageMap {
  return kind === "alert"
    ? PageMap.ALERTS_SETTINGS_AI
    : PageMap.INCIDENTS_SETTINGS_AI;
}

// The page of what OneUptime AI did for a record's kind: its AI Logs.
export function getRecordAiLogsPage(kind: InvestigationReasonKind): PageMap {
  return kind === "alert" ? PageMap.ALERTS_AI_LOGS : PageMap.INCIDENTS_AI_LOGS;
}

// Every page a reason's server English writes out, the link's page first.
export function getInvestigationReasonPagesNamed(
  place: InvestigationReasonPlace,
): Array<PageMap> {
  return [...(place.page ? [place.page] : []), ...(place.alsoPages || [])];
}

// The path of a page of the table, or a test failure for any other page.
export function getInvestigationReasonPagePath(page: PageMap): string {
  const pagePath: string | undefined =
    INVESTIGATION_REASON_PAGE_PATHS.get(page);

  if (!pagePath) {
    throw new Error(`No path for ${page} in INVESTIGATION_REASON_PAGE_PATHS.`);
  }

  return pagePath;
}

/*
 * Where a reason sends its reader. `paused`: a daily token limit of 0,
 * which waiting until midnight does not lift.
 */
export function getInvestigationReasonPlace(
  code: InvestigationNotStartedCode,
  kind: InvestigationReasonKind,
  options: { paused?: boolean | undefined } = {},
): InvestigationReasonPlace {
  const ownSettings: PageMap = getRecordAiSettingsPage(kind);
  const tokenLimitName: string = `Daily ${kind === "alert" ? "Alert" : "Incident"} AI Token Limit`;
  const places: Record<InvestigationNotStartedCode, InvestigationReasonPlace> =
    {
      ai_disabled: { names: ["Enable AI"], page: PageMap.SETTINGS_AI_FEATURES },
      automatic_investigation_disabled: {
        names: [`Investigate new ${kind}s`],
        page: ownSettings,
      },
      provider_missing: {
        names: ["LLM provider"],
        page: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      },
      insufficient_ai_balance: {
        names: ["AI credits"],
        page: PageMap.SETTINGS_AI_CREDITS,
      },
      // The project's own limits, under More settings on AI Features.
      project_daily_limit_reached: {
        names: ["limit", "More settings", "midnight UTC"],
        page: PageMap.SETTINGS_AI_FEATURES,
      },
      severity_below_threshold: {
        names: ["minimum severity for AI investigation"],
        page: ownSettings,
      },
      monitor_cooldown: {
        names: ["re-investigation cooldown"],
        page: ownSettings,
      },
      no_investigation_rule_matched: {
        names: ["AI rule"],
        page: ownSettings,
      },
      // Nothing to change: it was over before it was recorded.
      created_resolved: { names: ["ask OneUptime AI below"], page: null },
      // The wait that let it resolve is set on the AI rules.
      resolved_before_investigation: {
        names: ["ask OneUptime AI below", "AI rules", "More settings"],
        page: ownSettings,
      },
      daily_budget_exhausted: {
        names: options.paused
          ? [tokenLimitName, "above 0", "More settings"]
          : [tokenLimitName, "More settings", "midnight UTC"],
        page: ownSettings,
      },
      // Faults: someone has to look, and no setting would have changed them.
      budget_check_failed: {
        names: ["project administrator", "AI settings"],
        page: null,
      },
      enqueue_failed: {
        names: ["project administrator", "server logs"],
        page: null,
      },
      eligibility_check_failed: {
        names: ["project administrator", "AI settings"],
        page: null,
      },
      /*
       * Nothing was recorded: the card links to the record's AI settings,
       * and its step names the AI Logs, which say what happened to new
       * records.
       */
      no_run_recorded: {
        names: ["AI Logs"],
        page: ownSettings,
        alsoPages: [getRecordAiLogsPage(kind)],
      },
    };

  return places[code];
}
