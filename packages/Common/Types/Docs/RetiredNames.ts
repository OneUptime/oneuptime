import GlossaryTerm from "./GlossaryTerm";

/*
 * THE NAMES ONEUPTIME NO LONGER USES (#6817: one name per thing).
 *
 * Where one thing had two or three names, one was kept and the others
 * retired. A retired name may not come back in what people read - the
 * Dashboard's words, permission names, emails, every string the server and
 * the front ends write, the English docs, the website - and
 * App/Tests/Dashboard/RetiredNamesGuard holds them to that.
 *
 * It stays where people who learned it look for it, and nowhere else:
 *
 *   - a Search (Cmd/Ctrl+K) keyword of the page or product it names
 *     (NavigationItems.tsx, PageSearchIndex.ts);
 *   - an "Also called" name of its glossary term (introduction/glossary.md);
 *   - a word docs search forgives (DOCS_SEARCH_SYNONYMS), where a word of it
 *     would not find the page by itself;
 *   - an address or an API name, which never change: /on-call-duty,
 *     OnCallDutyPolicy, a model's apiSingularName (Common/Utils/ModelApiName),
 *     a stored value a rule keeps matching on;
 *   - a name another app keeps: the Slack app's shortcuts, as its manifest
 *     (Workspace/Slack/app-manifest.json) names them, which every installed
 *     app keeps until it is updated.
 *
 * To retire a name, add it here with what it is called now, give its
 * glossary term the old name under "Also called", and make Search find the
 * page by it. RetiredNamesFindable checks all three.
 */
export interface RetiredName {
  // The retired name, as people knew it.
  name: string;
  // The one name it goes by now.
  nowCalled: string;
  // The glossary term that lists it under "Also called".
  glossaryTerm: GlossaryTerm;
  /*
   * How to spot it in a sentence. A name that is also ordinary English is
   * narrowed to where it was a name: "On-Call Duty" in title case or as the
   * policy it named, never the duty that "rotates through these users";
   * "On Call" before another capitalised word, never "whoever is on call".
   */
  pattern: RegExp;
  // A sentence that uses it, when the name alone is not one (RetiredNamesGuard).
  example?: string | undefined;
  // The pull request of #6817 that retired it, for the reader of a failure.
  retiredIn: string;
}

export const RETIRED_NAMES: ReadonlyArray<RetiredName> = [
  {
    name: "On-Call Duty",
    nowCalled: "On-Call",
    glossaryTerm: GlossaryTerm.OnCallPolicy,
    // Also the policies and schedules it named, written in lower case.
    pattern:
      /\bOn[- ]Call Duty\b|\b[Oo]n[- ]call[- ]duty (?:polic(?:y|ies)|schedules?)\b/,
    retiredIn: "#6817 part 1",
  },
  {
    name: "On Call",
    nowCalled: "On-Call",
    glossaryTerm: GlossaryTerm.OnCallPolicy,
    // "On Call Policy", "User On Call Time", a heading of its own; never "whoever is on call".
    pattern: /\bOn Call (?!Duty\b)(?=[A-Z])|^On Call$/,
    example: "User On Call Time",
    retiredIn: "#6817 part 1",
  },
  {
    name: "On-Call Policy Schedule",
    nowCalled: "On-Call Schedule",
    glossaryTerm: GlossaryTerm.OnCallSchedule,
    pattern: /\bon-call policy schedules?\b/i,
    retiredIn: "#6817 part 1",
  },
  {
    name: "Personal On-Call Rules",
    nowCalled: "How to Reach Me",
    glossaryTerm: GlossaryTerm.HowToReachMe,
    pattern: /\bpersonal on-call rules?\b/i,
    retiredIn: "#6817 part 1",
  },
  {
    name: "Project Settings > Notifications > Notification Settings",
    nowCalled: "Project Settings > Notifications > Notification Channels",
    glossaryTerm: GlossaryTerm.NotificationSettings,
    // The project's page; User Settings' page keeps the name.
    pattern:
      /Project Settings\**\s*(?:→|>|›)\s*\**Notifications\**\s*(?:→|>|›)\s*\**Notification Settings/,
    retiredIn: "#6817 part 1",
  },
  {
    name: "Performance Profiles",
    nowCalled: "Profiles",
    glossaryTerm: GlossaryTerm.Profiles,
    pattern: /\bPerformance Profiles?\b/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Profiler",
    nowCalled: "Profiles",
    glossaryTerm: GlossaryTerm.Profiles,
    /*
     * The page's title. Never "a profiler", the tool that sends profiles,
     * nor one's own name: React's <Profiler>, the OpenTelemetry eBPF
     * Profiler, Pyroscope.Profiler.Native.so.
     */
    pattern: /(?<!<|\w\.|eBPF )\bProfiler\b(?!>|\.\w)/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Continuous Profiling",
    nowCalled: "Profiles",
    glossaryTerm: GlossaryTerm.Profiles,
    pattern: /\bContinuous Profiling\b/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Exception Tracking",
    nowCalled: "Exceptions",
    glossaryTerm: GlossaryTerm.Exception,
    pattern: /\bException Tracking\b/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Monitor Criteria",
    nowCalled: "Criteria",
    glossaryTerm: GlossaryTerm.Criteria,
    // Also "Monitoring Criteria"; the API's monitor steps keep their name.
    pattern: /\bMonitor(?:ing)? Criteria\b/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Telemetry Ingestion Key",
    nowCalled: "Ingestion Key",
    glossaryTerm: GlossaryTerm.IngestionKey,
    pattern: /\bTelemetry Ingestion Keys?\b/,
    retiredIn: "#6817 part 2",
  },
  {
    name: "Service Catalog",
    nowCalled: "Services",
    glossaryTerm: GlossaryTerm.Service,
    pattern: /\bService Catalog\b/,
    retiredIn: "#6817 part 3",
  },
  {
    name: "Telemetry Service",
    nowCalled: "Service",
    glossaryTerm: GlossaryTerm.Service,
    pattern: /\bTelemetry Services?\b/,
    retiredIn: "#6817 part 3",
  },
  {
    name: "Scheduled Maintenance Event",
    nowCalled: "Maintenance Event",
    glossaryTerm: GlossaryTerm.ScheduledMaintenance,
    // One record: the product keeps its name, Scheduled Maintenance.
    pattern: /\bScheduled Maintenance Events?\b/,
    retiredIn: "#6817 part 3",
  },
  {
    name: "Scheduled Event",
    nowCalled: "Maintenance Event",
    glossaryTerm: GlossaryTerm.ScheduledMaintenance,
    pattern: /\bScheduled Events?\b/,
    retiredIn: "#6817 part 3",
  },
  {
    name: "Event State",
    nowCalled: "Maintenance State",
    glossaryTerm: GlossaryTerm.ScheduledMaintenance,
    pattern: /\bEvent States?\b/,
    retiredIn: "#6817 part 3",
  },
];

// The retired names a text uses, by name.
export function findRetiredNames(text: string): Array<RetiredName> {
  return RETIRED_NAMES.filter((retired: RetiredName): boolean => {
    return retired.pattern.test(text);
  });
}
