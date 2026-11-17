import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  getChannelName,
  OWNER_FIX_WORDS,
} from "../Monitor/Overview/WhoIsToldWords";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import {
  getNumberLocale,
  withDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import ObjectID from "Common/Types/ObjectID";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  SetupHealthCheck,
  SetupHealthCounts,
  SetupHealthFinding,
  SetupHealthFix,
  SetupHealthLevel,
  SetupHealthRecord,
  SetupHealthRecordKind,
} from "Common/Types/SetupHealth/SetupHealth";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { toHeadline } from "Common/UI/Components/Table/EmptyTableMessage";
import {
  composedValue,
  PluralTemplate,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * SETUP HEALTH IN THE READER'S WORDS (Types/SetupHealth/SetupHealth, #6812).
 *
 * The server says each finding as data and as a template
 * (SetupHealthFinding.words, from SETUP_HEALTH_WORDS): the page looks the
 * template up in the reader's language and sets the project's own names
 * into it as written - a channel, a time and an amount in the reader's
 * words. The fixes, the levels and the page's own words are here.
 */

// Each level, as a card of the page: its title and what it holds.
export const LEVEL_WORDS: Readonly<
  Record<SetupHealthLevel, { title: string; description: string }>
> = {
  [SetupHealthLevel.PagesWillNotArrive]: {
    title: translationKey("Pages Will Not Arrive"),
    description: translationKey(
      "Something is set up to tell people, and it won't. Fix these first.",
    ),
  },
  [SetupHealthLevel.WorthFixing]: {
    title: translationKey("Worth Fixing"),
    description: translationKey("Gaps people rarely mean to leave."),
  },
  [SetupHealthLevel.Suggestion]: {
    title: translationKey("Suggestions"),
    description: translationKey("Worth a look, and often fine as they are."),
  },
};

export const SETUP_HEALTH_WORDS_PAGE: Readonly<{
  description: string;
  nothingToFix: string;
  nothingToFixDescription: string;
  couldNotLoad: string;
  dismissed: string;
  dismissedDescription: string;
  dismiss: string;
  restore: string;
  dismissTitle: string;
  dismissDescription: string;
  dismissPlaceholder: string;
  dismissReasonLabel: string;
  askServerAdmin: string;
  openServerSetup: string;
  showMore: PluralTemplate;
  showFewer: string;
  dismissedBy: string;
  dismissedByWithReason: string;
  someone: string;
}> = {
  // Said under the page's title.
  description: translationKey(
    "What would stop the right people from being told when something breaks, and the fix for each.",
  ),
  nothingToFix: translationKey("Nothing to fix."),
  nothingToFixDescription: translationKey(
    "OneUptime checked your monitors, on-call setup, status pages and notifications: nothing would stop people from being told.",
  ),
  couldNotLoad: translationKey("Couldn't check the setup. {{error}}"),
  dismissed: translationKey("Dismissed"),
  dismissedDescription: translationKey(
    "Findings your team hid on purpose. Restore one to see it again.",
  ),
  dismiss: translationKey("Dismiss"),
  restore: translationKey("Restore"),
  dismissTitle: translationKey("Dismiss Finding"),
  dismissDescription: translationKey(
    "It is hidden for everyone in this project until somebody restores it.",
  ),
  dismissPlaceholder: translationKey("We don't page for this on purpose."),
  dismissReasonLabel: translationKey("Why"),
  askServerAdmin: translationKey(
    "Ask your server's admin to set it up in the Admin Dashboard.",
  ),
  openServerSetup: translationKey("Open Server Setup"),
  showMore: {
    one: "Show {{count}} more",
    other: "Show {{count}} more",
  },
  showFewer: translationKey("Show fewer"),
  dismissedBy: translationKey("Dismissed by {{name}}."),
  dismissedByWithReason: translationKey("Dismissed by {{name}}: {{reason}}"),
  someone: translationKey("Someone"),
};

/*
 * The records a finding reaches beyond its own (SetupHealthFinding.related):
 * the monitors whose pages a policy, a switched-off channel or the server
 * would carry, the policies that page a person, the status page a domain
 * opens. Shown under the sentence, so a reader sees what the break stops.
 */
export const SETUP_HEALTH_AFFECTS: string = translationKey("Affects");

// How many of those are named before "+3 more".
export const RELATED_RECORDS_SHOWN: number = 3;

export const RELATED_RECORDS_MORE: PluralTemplate = {
  one: "+{{count}} more",
  other: "+{{count}} more",
};

/*
 * THE VERDICT THE PAGE OPENS WITH: is anything in the setup wrong, and how
 * badly - the worst level with findings, said in one line with how many,
 * and what that means for the reader. Pure, so every combination of counts
 * can be tested without a renderer; looked up where it is drawn.
 */
export enum SetupHealthVerdictKind {
  // Something set up to tell people will not: fix these first.
  PagesWillNotArrive = "pages_will_not_arrive",
  // Nothing of that, but gaps people rarely mean to leave.
  WorthFixing = "worth_fixing",
  // Nothing to fix: at most suggestions, often fine as they are.
  NothingToFix = "nothing_to_fix",
}

/*
 * A fixed sentence, or one that depends on a count. A fixed one is never a
 * plural: a language whose "one" form also covers 21 (Russian) would read
 * an English "one" sentence that cannot be right.
 */
export type SetupHealthVerdictText =
  | { text: string }
  | { plural: PluralTemplate; count: number };

export interface SetupHealthVerdict {
  kind: SetupHealthVerdictKind;
  headline: SetupHealthVerdictText;
  summary: SetupHealthVerdictText;
}

export const SETUP_HEALTH_VERDICT_WORDS: Readonly<{
  pagesWillNotArriveHeadline: PluralTemplate;
  pagesWillNotArriveSummary: string;
  worthFixingHeadline: PluralTemplate;
  worthFixingSummary: string;
}> = {
  pagesWillNotArriveHeadline: {
    one: "{{count}} problem would stop people from being told",
    other: "{{count}} problems would stop people from being told",
  },
  pagesWillNotArriveSummary: translationKey(
    "Until they are fixed, some pages won't reach the people they are meant for.",
  ),
  worthFixingHeadline: {
    one: "{{count}} thing in your setup is worth fixing",
    other: "{{count}} things in your setup are worth fixing",
  },
  worthFixingSummary: translationKey(
    "Fix each one from here, or dismiss it if your team leaves it that way on purpose.",
  ),
};

export function getSetupHealthVerdict(
  counts: Pick<SetupHealthCounts, "pagesWillNotArrive" | "worthFixing">,
): SetupHealthVerdict {
  if (counts.pagesWillNotArrive > 0) {
    return {
      kind: SetupHealthVerdictKind.PagesWillNotArrive,
      headline: {
        plural: SETUP_HEALTH_VERDICT_WORDS.pagesWillNotArriveHeadline,
        count: counts.pagesWillNotArrive,
      },
      summary: { text: SETUP_HEALTH_VERDICT_WORDS.pagesWillNotArriveSummary },
    };
  }

  if (counts.worthFixing > 0) {
    return {
      kind: SetupHealthVerdictKind.WorthFixing,
      headline: {
        plural: SETUP_HEALTH_VERDICT_WORDS.worthFixingHeadline,
        count: counts.worthFixing,
      },
      summary: { text: SETUP_HEALTH_VERDICT_WORDS.worthFixingSummary },
    };
  }

  return {
    kind: SetupHealthVerdictKind.NothingToFix,
    headline: { text: SETUP_HEALTH_WORDS_PAGE.nothingToFix },
    summary: { text: SETUP_HEALTH_WORDS_PAGE.nothingToFixDescription },
  };
}

// A verdict's line in the reader's words; a headline without its full stop.
export function translateSetupHealthVerdictText(
  translator: Translator,
  text: SetupHealthVerdictText,
  options?: { isHeadline?: boolean | undefined },
): string {
  const words: string =
    "plural" in text
      ? translator.translatePlural(text.plural, text.count)
      : translator.translateText(text.text) || text.text;

  return options?.isHeadline ? toHeadline(words) : words;
}

const FIX_WORDS: Readonly<Record<SetupHealthFix, string>> = {
  [SetupHealthFix.MonitorCriteria]: translationKey("Open Criteria"),
  [SetupHealthFix.MonitorProbes]: translationKey("Open Probes"),
  [SetupHealthFix.MonitorOverview]: translationKey("Open Monitor"),
  [SetupHealthFix.CreateMonitor]: translationKey("Create Monitor"),
  [SetupHealthFix.IncidentOnCallRules]: translationKey("Set Up Paging"),
  [SetupHealthFix.AlertOnCallRules]: translationKey("Set Up Paging"),
  [SetupHealthFix.OnCallGuidedSetup]: translationKey("Set Up Paging"),
  [SetupHealthFix.OnCallPolicy]: translationKey("Open On-Call Policy"),
  [SetupHealthFix.OnCallSchedule]: translationKey("Open On-Call Schedule"),
  [SetupHealthFix.OnCallReadiness]: translationKey("Open Readiness"),
  [SetupHealthFix.ProjectNotificationSettings]: translationKey(
    "Open Notification Channels",
  ),
  [SetupHealthFix.ProjectBilling]: translationKey("Open Billing"),
  [SetupHealthFix.ServerSettings]: translationKey("Open Server Setup"),
  [SetupHealthFix.StatusPageResources]: translationKey("Add Monitors"),
  [SetupHealthFix.StatusPageDomains]: translationKey("Open Custom Domains"),
  [SetupHealthFix.ProjectOwners]: translationKey("Open Teams"),
  [SetupHealthFix.WorkspaceNotificationRules]: translationKey(
    "Add Notification Rule",
  ),
  [SetupHealthFix.TelemetryIngestionKey]: translationKey("Open Ingestion Key"),
  // An owner no Created email reaches (#9371): the card's own links' words.
  [SetupHealthFix.TeamMembers]: OWNER_FIX_WORDS.team,
  [SetupHealthFix.NetworkDeviceOwners]: OWNER_FIX_WORDS.networkDevice,
  [SetupHealthFix.IncidentOwnerRules]: OWNER_FIX_WORDS.ownerRules,
  [SetupHealthFix.AlertOwnerRules]: OWNER_FIX_WORDS.ownerRules,
};

/*
 * The page of the Dashboard each fix opens. The server's settings are the
 * Admin Dashboard's (SetupHealthView links them for the server's admins);
 * a chat workspace's rules are its own page of Incidents.
 */
const FIX_PAGES: Readonly<Partial<Record<SetupHealthFix, PageMap>>> = {
  [SetupHealthFix.MonitorCriteria]: PageMap.MONITOR_VIEW_CRITERIA,
  [SetupHealthFix.MonitorProbes]: PageMap.MONITOR_VIEW_PROBES,
  [SetupHealthFix.MonitorOverview]: PageMap.MONITOR_VIEW,
  [SetupHealthFix.CreateMonitor]: PageMap.MONITOR_CREATE,
  [SetupHealthFix.IncidentOnCallRules]:
    PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
  [SetupHealthFix.AlertOnCallRules]: PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
  [SetupHealthFix.OnCallGuidedSetup]: PageMap.ON_CALL_DUTY_GUIDED_SETUP,
  [SetupHealthFix.OnCallPolicy]: PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION,
  [SetupHealthFix.OnCallSchedule]: PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS,
  [SetupHealthFix.OnCallReadiness]: PageMap.ON_CALL_DUTY_READINESS,
  [SetupHealthFix.ProjectNotificationSettings]:
    PageMap.SETTINGS_NOTIFICATION_SETTINGS,
  [SetupHealthFix.ProjectBilling]: PageMap.SETTINGS_BILLING,
  [SetupHealthFix.StatusPageResources]: PageMap.STATUS_PAGE_VIEW_RESOURCES,
  [SetupHealthFix.StatusPageDomains]: PageMap.STATUS_PAGE_VIEW_DOMAINS,
  [SetupHealthFix.ProjectOwners]: PageMap.TEAMS,
  [SetupHealthFix.TelemetryIngestionKey]:
    PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
  // Where the card puts an owner no Created email reaches right (#9371).
  [SetupHealthFix.TeamMembers]: PageMap.TEAM_VIEW_MEMBERS,
  [SetupHealthFix.NetworkDeviceOwners]: PageMap.NETWORK_DEVICE_VIEW_OWNERS,
  [SetupHealthFix.IncidentOwnerRules]: PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
  [SetupHealthFix.AlertOwnerRules]: PageMap.ALERTS_SETTINGS_OWNER_RULES,
};

const WORKSPACE_RULE_PAGES: Readonly<Record<WorkspaceType, PageMap>> = {
  [WorkspaceType.Slack]: PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK,
  [WorkspaceType.MicrosoftTeams]:
    PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
  [WorkspaceType.Mattermost]: PageMap.INCIDENTS_WORKSPACE_CONNECTION_MATTERMOST,
};

export interface SetupHealthFixLink {
  route: Route;
  text: string;
}

// Where a finding is put right, and the link's words; null for the server's.
export function getSetupHealthFixLink(data: {
  finding: SetupHealthFinding;
  translator: Translator;
}): SetupHealthFixLink | null {
  const fix: SetupHealthFix = data.finding.fix;

  const pageMap: PageMap | undefined =
    fix === SetupHealthFix.WorkspaceNotificationRules
      ? WORKSPACE_RULE_PAGES[data.finding.subject as WorkspaceType]
      : FIX_PAGES[fix];

  if (!pageMap) {
    return null;
  }

  const route: Route = RouteMap[pageMap] as Route;
  const text: string = FIX_WORDS[fix];

  return {
    route: data.finding.fixRecordId
      ? RouteUtil.populateRouteParams(route, {
          modelId: new ObjectID(data.finding.fixRecordId),
        })
      : RouteUtil.populateRouteParams(route),
    text: data.translator.translateText(text) || text,
  };
}

// The words of the fix of the server's findings, for its admins.
export const SERVER_FIX_WORDS: string =
  FIX_WORDS[SetupHealthFix.ServerSettings];

// The page of each kind of record a finding reaches, where it has one.
const RECORD_PAGES: Readonly<Partial<Record<SetupHealthRecordKind, PageMap>>> =
  {
    [SetupHealthRecordKind.Monitor]: PageMap.MONITOR_VIEW,
    [SetupHealthRecordKind.OnCallDutyPolicy]: PageMap.ON_CALL_DUTY_POLICY_VIEW,
    [SetupHealthRecordKind.OnCallDutyPolicySchedule]:
      PageMap.ON_CALL_DUTY_SCHEDULE_VIEW,
    [SetupHealthRecordKind.StatusPage]: PageMap.STATUS_PAGE_VIEW,
    [SetupHealthRecordKind.TelemetryIngestionKey]:
      PageMap.SETTINGS_TELEMETRY_INGESTION_KEY_VIEW,
    [SetupHealthRecordKind.Team]: PageMap.TEAM_VIEW,
  };

// Where a record a finding reaches is opened; null for one with no page.
export function getSetupHealthRecordRoute(
  record: Pick<SetupHealthRecord, "kind" | "id">,
): Route | null {
  const pageMap: PageMap | undefined = RECORD_PAGES[record.kind];

  if (!pageMap || !record.id) {
    return null;
  }

  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: new ObjectID(record.id),
  });
}

export interface SetupHealthSentenceValues {
  /*
   * The project's own names, set in as written: a monitor's, a policy's, a
   * person's. The page draws them in bold, so the record stands out of the
   * sentence it is named in.
   */
  names: Record<string, string>;
  // The rest, in the sentence's own language: a channel, a time, an amount.
  values: TemplateValues;
}

/*
 * ONE FINDING'S SENTENCE, ITS VALUES: the names set in as written, and the
 * channel, the time and the amount in the sentence's own language.
 */
export function getSetupHealthSentenceValues(
  finding: SetupHealthFinding,
): SetupHealthSentenceValues {
  const values: TemplateValues = {};

  if (finding.check === SetupHealthCheck.ChannelOff) {
    values["channel"] = composedValue((sentence: Translator): string => {
      return getChannelName(finding.subject as OnCallPageChannel, sentence);
    });
  }

  if (
    finding.record.kind === SetupHealthRecordKind.User &&
    !finding.record.name
  ) {
    values["name"] = composedValue((sentence: Translator): string => {
      return (
        sentence.translateText(SETUP_HEALTH_WORDS_PAGE.someone) ||
        SETUP_HEALTH_WORDS_PAGE.someone
      );
    });
  }

  if (finding.startsAt) {
    const startsAt: Date = OneUptimeDate.fromString(finding.startsAt);

    values["time"] = composedValue((sentence: Translator): string => {
      return withDateDisplayLanguage(sentence.language, (): string => {
        return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          startsAt,
        );
      });
    });
  }

  if (finding.balanceInUSDCents !== undefined) {
    const cents: number = finding.balanceInUSDCents;

    values["balance"] = composedValue((sentence: Translator): string => {
      return new Intl.NumberFormat(getNumberLocale(sentence.language), {
        style: "currency",
        currency: "USD",
      }).format(Math.max(0, cents) / 100);
    });
  }

  const names: Record<string, string> = {};

  for (const [key, value] of Object.entries(finding.values)) {
    if (!(key in values)) {
      names[key] = value;
    }
  }

  return { names: names, values: values };
}

/*
 * ONE FINDING, AS ONE SENTENCE IN THE READER'S LANGUAGE, as text: for the
 * dismiss dialog and anything else that cannot draw the names in bold.
 */
export function getSetupHealthSentence(
  finding: SetupHealthFinding,
  translator: Translator,
): string {
  const sentence: SetupHealthSentenceValues =
    getSetupHealthSentenceValues(finding);

  return translator.translateTemplate(finding.words, {
    ...sentence.names,
    ...sentence.values,
  });
}

// The checks whose findings are about records many of: folded past a few.
export const FINDINGS_SHOWN_PER_CHECK: number = 3;

/*
 * The findings of one level, in groups of one check (and subject) each, in
 * the server's order: a check that is broken for many monitors is one
 * group, shown a few at a time.
 */
export function groupSetupHealthFindings(
  findings: ReadonlyArray<SetupHealthFinding>,
): Array<{ key: string; findings: Array<SetupHealthFinding> }> {
  const groups: Array<{ key: string; findings: Array<SetupHealthFinding> }> =
    [];

  for (const finding of findings) {
    const key: string = `${finding.check}|${finding.subject}`;
    const group:
      | { key: string; findings: Array<SetupHealthFinding> }
      | undefined = groups.find(
      (item: { key: string; findings: Array<SetupHealthFinding> }): boolean => {
        return item.key === key;
      },
    );

    if (group) {
      group.findings.push(finding);
    } else {
      groups.push({ key: key, findings: [finding] });
    }
  }

  return groups;
}
