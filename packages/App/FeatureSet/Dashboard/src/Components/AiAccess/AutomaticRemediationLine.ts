import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The project's "Fix new incidents automatically" and "Fix new alerts
 * automatically" switches in one sentence, under the fixes of an AI agent
 * page - a Kubernetes cluster's, or any resource's (a Docker host, a host,
 * a cloud account, ...) - and under the question of a cloud account's Let
 * AI fix problems dialog: a cluster or resource set to fix things fixes
 * nothing new while the project's switch is off. Both are off by default,
 * for new projects too, and they are turned on - with their rules - on
 * each signal type's AI settings page, not on the agent page: they are the
 * project's choice, not the resource's.
 *
 * One whole sentence for each pair of switches, in the words the switches
 * themselves use, so a locale words each one its own way; and a "Turn on"
 * link for each switch that is off, to the page that holds it.
 *
 * Import-clean (Common's translation helpers only), so the suites read it
 * without a browser, and every page draws the same words
 * (AutomaticRemediationNote draws them).
 */

export interface AutomaticRemediationSettings {
  incidents: boolean;
  alerts: boolean;
}

export const AUTOMATIC_REMEDIATION_SENTENCES: {
  both: string;
  incidentsOnly: string;
  alertsOnly: string;
  neither: string;
} = {
  both: translationKey(
    "This project fixes new incidents and alerts automatically.",
  ),
  incidentsOnly: translationKey(
    "This project fixes new incidents automatically, but not new alerts.",
  ),
  alertsOnly: translationKey(
    "This project fixes new alerts automatically, but not new incidents.",
  ),
  neither: translationKey(
    "This project doesn't fix new incidents or alerts automatically.",
  ),
};

// The English sentence (a translation key) for these switches.
export function getAutomaticRemediationSentence(
  settings: AutomaticRemediationSettings,
): string {
  if (settings.incidents && settings.alerts) {
    return AUTOMATIC_REMEDIATION_SENTENCES.both;
  }

  if (settings.incidents) {
    return AUTOMATIC_REMEDIATION_SENTENCES.incidentsOnly;
  }

  if (settings.alerts) {
    return AUTOMATIC_REMEDIATION_SENTENCES.alertsOnly;
  }

  return AUTOMATIC_REMEDIATION_SENTENCES.neither;
}

// The sentence in the reader's language.
export function getAutomaticRemediationLine(
  settings: AutomaticRemediationSettings,
): string {
  const sentence: string = getAutomaticRemediationSentence(settings);

  return translateText(sentence) || sentence;
}

/*
 * The link to each switch while it is off: it opens the signal's AI
 * settings page, where the switch is turned on.
 */
export const AUTOMATIC_REMEDIATION_SETTINGS_LINKS: {
  incidents: string;
  alerts: string;
} = {
  incidents: translationKey("Turn on for incidents"),
  alerts: translationKey("Turn on for alerts"),
};

/*
 * The switches as a status object carries them (a cluster's or a
 * resource's), or null when it carries none that can be read - a server
 * older than the line, or one that could not read the project's settings:
 * the page then draws no line rather than a guess.
 */
export function readAutomaticRemediation(
  value: unknown,
): AutomaticRemediationSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const settings: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof settings["incidents"] !== "boolean" ||
    typeof settings["alerts"] !== "boolean"
  ) {
    return null;
  }

  return {
    incidents: settings["incidents"],
    alerts: settings["alerts"],
  };
}

// Whether the line should point anywhere: a switch is off.
export function isAnyAutomaticRemediationOff(
  settings: AutomaticRemediationSettings,
): boolean {
  return !settings.incidents || !settings.alerts;
}

/*
 * Whether an AI agent page draws the line under its fixes: only while the
 * cluster's or resource's own fixes are on. With them off, the project's
 * switches change nothing there yet, and the page's one next step is the
 * hint that turns the fixes on.
 */
export function shouldShowAutomaticRemediationLine(data: {
  settings: AutomaticRemediationSettings | null;
  areFixesOn: boolean;
}): boolean {
  return Boolean(data.settings) && data.areFixesOn;
}
