import {
  translatableTerm,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The project's "Fix new incidents automatically" and "Fix new alerts
 * automatically" switches in one line, under the fixes of an AI agent page
 * - a Kubernetes cluster's, or any resource's (a Docker host, a host, a
 * cloud account, ...): a cluster or resource set to fix things fixes
 * nothing new while the project's switch is off. Both are off by default,
 * for new projects too, and they are turned on - with their rules - on each
 * signal type's AI settings page, not on the agent page: they are the
 * project's choice, not the resource's.
 *
 * Import-clean (Common's translation helpers only), so the suites read it
 * without a browser, and both agent pages draw the same words.
 */

export interface AutomaticRemediationSettings {
  incidents: boolean;
  alerts: boolean;
}

const SWITCH_ON: string = translationKey("On");
const SWITCH_OFF: string = translationKey("Off");

export const AUTOMATIC_REMEDIATION_LINE: string = translationKey(
  "Automatic fixes for new incidents in this project: {{incidents}} · alerts: {{alerts}}",
);

export function getAutomaticRemediationLine(
  settings: AutomaticRemediationSettings,
): string {
  return translateTemplate(AUTOMATIC_REMEDIATION_LINE, {
    incidents: translatableTerm(settings.incidents ? SWITCH_ON : SWITCH_OFF),
    alerts: translatableTerm(settings.alerts ? SWITCH_ON : SWITCH_OFF),
  });
}

// Where each switch is turned on, linked from the line while it is off.
export const AUTOMATIC_REMEDIATION_SETTINGS_LINKS: {
  incidents: string;
  alerts: string;
} = {
  incidents: translationKey("Incident AI settings"),
  alerts: translationKey("Alert AI settings"),
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
