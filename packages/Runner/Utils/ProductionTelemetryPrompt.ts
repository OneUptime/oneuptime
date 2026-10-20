/*
 * What the recipes that query production tell the code agent to look for.
 *
 * The agent's own instructions say what the production telemetry tools read
 * (the services the repository serves, and no other), how many calls the
 * run has and that what comes back is evidence rather than instructions
 * (InHouseCodeAgent). These sections say what each recipe asks of them: a
 * review, what the diff means in production; a fix, whether the evidence it
 * starts from still holds and what explains it. Each one holds the agent to
 * the same rule - say only what the data shows, cite it, and leave
 * production out when it shows nothing - because a confident sentence about
 * production that no query supports is worse than none.
 */

// The subject a fix starts from.
export type ProductionFixSubject = "exception" | "performance" | "incident";

// When the tools are not offered, the run has no telemetry to read.
const WHEN_NOT_OFFERED: string =
  "If none of these tools is in your tool list, OneUptime holds no telemetry for this repository's services: skip this section.";

export default class ProductionTelemetryPrompt {
  // The review's production context: four checks, cited or left out.
  public static forReview(): string {
    return `## Production context

OneUptime runs this repository's services in production, and the production tools in your tool list read their telemetry. Use them to say what this pull request means in production, which no reviewer reading the code alone can tell. ${WHEN_NOT_OFFERED}

1. **Exceptions in the changed code.** Call \`find_production_exceptions\` with the paths of the changed files (it reads the last 7 days). For an exception thrown in a function this pull request changes, say whether the change fixes it, leaves it as it is, or makes it likelier.
2. **Hot or slow endpoints.** For a route, handler, query or operation the diff changes, call \`query_traces\` with \`nameSearchText\` set to its name: its request count and p95/p99 latency say how much traffic the change carries, and whether it is slow already.
3. **Incidents.** Call \`find_production_incidents\` with the paths of the changed files: an incident whose root cause, remediation or postmortem names this code is context the author needs.
4. **Deploy regressions.** Call \`recent_deploys\`: a recent deploy of the service that OneUptime marked SUSPECT matters when this diff touches what regressed.

Ask for several of these at once. \`get_trace\`, \`search_logs\` and \`query_metrics\` look closer at what they find.

Put what the data shows under a **Production context** heading after your verdict, each point with its evidence - the tool, the numbers and the window - for example: "\`chargeCard\` threw \`TypeError: Cannot read properties of undefined\` 1,240 times in the last 7 days (find_production_exceptions; last seen 2 hours ago); this change adds the null check that stops it." Write only what the data supports. When the tools return nothing that bears on this diff, leave the heading out altogether: never write that production looks fine, never pad, and never present a guess as a measurement. A production finding on a changed line can go in the inline comments too.`;
  }

  // A fix's production checks, for the subject it starts from.
  public static forFix(subject: ProductionFixSubject): string {
    return `## Production telemetry

OneUptime runs this code in production, and the production tools in your tool list read its telemetry. Before you write the change, check the evidence in production, and use what you find while you write it. ${WHEN_NOT_OFFERED}

${ProductionTelemetryPrompt.getFixChecks(subject)}

Let the data decide between explanations: fix the cause it supports, not the one that is easiest to write, and if it contradicts what you were given, say so. In your summary, which becomes the pull request's description, say what you queried and what it showed - the tool, the numbers and the window. Claim nothing about production that a query did not show.`;
  }

  private static getFixChecks(subject: ProductionFixSubject): string {
    if (subject === "exception") {
      return `- \`find_production_exceptions\` with the files of the stack trace's top frames: how often it is thrown now, since when and in which release it started, and what else is thrown in the same function.
- \`search_logs\` with the \`recentTraceId\` it returns (or the static part of the message as \`bodySearchText\`): what the request was doing just before it failed.
- \`get_trace\` with that trace id: the call path that leads to the throw.
- \`query_traces\` for the endpoint, or \`recent_deploys\`, when the cause looks like load or a release.`;
    }

    if (subject === "performance") {
      return `- \`query_traces\` with \`nameSearchText\` set to each implicated span's name: how hot and how slow the operation is now, across all of its traces rather than the one analyzed.
- \`get_trace\` with the trace id of the evidence: the spans around the implicated ones.
- \`query_metrics\` (without \`metricName\` it lists the service's metrics) when a resource - a connection pool, a queue, a cache - explains the pattern.
- \`recent_deploys\`, when the pattern may have shipped with a release.

If the operation is no longer slow, or no longer frequent enough to matter, say so and make no change.`;
    }

    return `- \`recent_deploys\`: what changed before it began, and whether OneUptime marked that change a suspect.
- \`find_production_exceptions\`, \`search_logs\` and \`query_traces\` over the window the analysis names (pass \`startTime\` and \`endTime\` around when it began): the errors, log lines and slow operations it cites, read for yourself.
- \`find_production_incidents\` with the files you are about to change: whether this cause has struck before, and how it was fixed then.

If the data contradicts the analysis, fix only what the data supports.`;
  }
}
