import AutoRemediationTriggerEntity from "../AutoRemediation/AutoRemediationTriggerEntity";

/*
 * "Fix new incidents automatically" and "Fix new alerts automatically"
 * (Incidents or Alerts → AI → Settings), and the two pull-request switches
 * that sit under each of them:
 *
 *   Fix new incidents automatically              enableAutomaticIncidentRemediation
 *     Open a fix pull request when an
 *     investigation finds a code change          enableAutomaticIncidentCodeFixes
 *     Open a pull request that adds
 *     missing telemetry                          enableIncidentInstrumentationFixTasks
 *
 * and the same three for alerts.
 *
 * A pull request is one of the ways OneUptime AI fixes an incident, so its
 * switch is part of fixing: "it should actually be a child of 'Fix new
 * alerts automatically'" - the maintainer. That is one rule, read here by
 * the server and the dashboard alike:
 *
 * - A pull request opens on its own only while its own switch AND the fix
 *   switch above it are on (getAutomaticFixPullRequestBlocker). The server
 *   asks this when an investigation ends (FixFromIncidentTaskTrigger,
 *   InstrumentationTaskTrigger).
 * - The dashboard offers the two switches only while fixing is on, and
 *   turning fixing on turns both on - turning it off, both off - in the same
 *   save as the fix switch, so a refused save leaves all three as they were
 *   (ModelSwitchRow's childSwitches, from AUTOMATIC_FIX_SWITCH_COLUMNS).
 * - The server stores what an API or Terraform write sets, as it always
 *   has: it turns nothing on or off by itself. A pull-request switch written
 *   on under a fix switch that is off is kept, and does nothing until fixing
 *   is turned on. To turn fixing on with its pull requests through the API,
 *   write the three columns in one request.
 *
 * Enable AI is still checked first, by each trigger: with it off nothing
 * opens. "Open Fix PR from this analysis" on the investigation panel needs
 * neither switch - a person asked for that pull request.
 */

export type AutomaticFixSwitchColumn =
  | "enableAutomaticIncidentRemediation"
  | "enableAutomaticAlertRemediation";

export type AutomaticFixPullRequestColumn =
  | "enableAutomaticIncidentCodeFixes"
  | "enableIncidentInstrumentationFixTasks"
  | "enableAutomaticAlertCodeFixes"
  | "enableAlertInstrumentationFixTasks";

// The two kinds of pull request OneUptime AI opens on its own.
export enum AutomaticFixPullRequest {
  // A fix, when an investigation is confident the cause is in the code.
  CodeFix = "CodeFix",
  // Logs, traces or metrics, when an investigation ends without a cause.
  MissingTelemetry = "MissingTelemetry",
}

// In the order the settings page draws them under the fix switch.
export const AUTOMATIC_FIX_PULL_REQUESTS: ReadonlyArray<AutomaticFixPullRequest> =
  [AutomaticFixPullRequest.CodeFix, AutomaticFixPullRequest.MissingTelemetry];

export interface AutomaticFixSwitchColumns {
  // Fix new incidents (or alerts) automatically.
  fix: AutomaticFixSwitchColumn;
  // The switch of each kind of pull request under it.
  pullRequests: Record<AutomaticFixPullRequest, AutomaticFixPullRequestColumn>;
}

export const AUTOMATIC_FIX_SWITCH_COLUMNS: Record<
  AutoRemediationTriggerEntity,
  AutomaticFixSwitchColumns
> = {
  [AutoRemediationTriggerEntity.Incident]: {
    fix: "enableAutomaticIncidentRemediation",
    pullRequests: {
      [AutomaticFixPullRequest.CodeFix]: "enableAutomaticIncidentCodeFixes",
      [AutomaticFixPullRequest.MissingTelemetry]:
        "enableIncidentInstrumentationFixTasks",
    },
  },
  [AutoRemediationTriggerEntity.Alert]: {
    fix: "enableAutomaticAlertRemediation",
    pullRequests: {
      [AutomaticFixPullRequest.CodeFix]: "enableAutomaticAlertCodeFixes",
      [AutomaticFixPullRequest.MissingTelemetry]:
        "enableAlertInstrumentationFixTasks",
    },
  },
};

/*
 * The signal an investigation was about: an incident or an alert. Exactly
 * one must be given; anything else is no signal at all, so nothing opens.
 */
export const getAutomaticFixSignal: (subject: {
  incidentId?: unknown;
  alertId?: unknown;
}) => AutoRemediationTriggerEntity | null = (subject: {
  incidentId?: unknown;
  alertId?: unknown;
}): AutoRemediationTriggerEntity | null => {
  const hasIncident: boolean = Boolean(subject.incidentId);
  const hasAlert: boolean = Boolean(subject.alertId);

  if (hasIncident === hasAlert) {
    return null;
  }

  return hasIncident
    ? AutoRemediationTriggerEntity.Incident
    : AutoRemediationTriggerEntity.Alert;
};

// The pull-request switches under a signal's fix switch, in drawn order.
export const getAutomaticFixPullRequestColumns: (
  signal: AutoRemediationTriggerEntity,
) => Array<AutomaticFixPullRequestColumn> = (
  signal: AutoRemediationTriggerEntity,
): Array<AutomaticFixPullRequestColumn> => {
  return AUTOMATIC_FIX_PULL_REQUESTS.map(
    (pullRequest: AutomaticFixPullRequest): AutomaticFixPullRequestColumn => {
      return AUTOMATIC_FIX_SWITCH_COLUMNS[signal].pullRequests[pullRequest];
    },
  );
};

// The switches as a project row holds them; a column that was not read is off.
export type AutomaticFixSwitchValues = Partial<
  Record<
    AutomaticFixSwitchColumn | AutomaticFixPullRequestColumn,
    boolean | null | undefined
  >
>;

// Why a pull request may not open on its own.
export enum AutomaticFixPullRequestBlocker {
  // Fix new incidents (or alerts) automatically is off.
  FixOff = "FixOff",
  // Fixing is on, but this kind of pull request's own switch is off.
  PullRequestOff = "PullRequestOff",
}

/*
 * Whether this kind of pull request may open on its own for the signal, and
 * if not, the switch that stops it: the fix switch first, since with it off
 * the pull-request switches are not even offered. Strictly === true: every
 * one of these columns is NOT NULL DEFAULT false, so a value that was not
 * read (or a legacy null) never opens a pull request.
 */
export const getAutomaticFixPullRequestBlocker: (data: {
  project: AutomaticFixSwitchValues;
  signal: AutoRemediationTriggerEntity;
  pullRequest: AutomaticFixPullRequest;
}) => AutomaticFixPullRequestBlocker | null = (data: {
  project: AutomaticFixSwitchValues;
  signal: AutoRemediationTriggerEntity;
  pullRequest: AutomaticFixPullRequest;
}): AutomaticFixPullRequestBlocker | null => {
  const columns: AutomaticFixSwitchColumns =
    AUTOMATIC_FIX_SWITCH_COLUMNS[data.signal];

  if (data.project[columns.fix] !== true) {
    return AutomaticFixPullRequestBlocker.FixOff;
  }

  if (data.project[columns.pullRequests[data.pullRequest]] !== true) {
    return AutomaticFixPullRequestBlocker.PullRequestOff;
  }

  return null;
};

/*
 * The columns a server read needs to decide: the fix switch and the pull
 * request's own switch (a ProjectService select).
 */
export const getAutomaticFixPullRequestSelect: (
  signal: AutoRemediationTriggerEntity,
  pullRequest: AutomaticFixPullRequest,
) => Partial<
  Record<AutomaticFixSwitchColumn | AutomaticFixPullRequestColumn, true>
> = (
  signal: AutoRemediationTriggerEntity,
  pullRequest: AutomaticFixPullRequest,
): Partial<
  Record<AutomaticFixSwitchColumn | AutomaticFixPullRequestColumn, true>
> => {
  const columns: AutomaticFixSwitchColumns =
    AUTOMATIC_FIX_SWITCH_COLUMNS[signal];

  return {
    [columns.fix]: true,
    [columns.pullRequests[pullRequest]]: true,
  };
};
