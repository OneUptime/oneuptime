import OneUptimeDate from "Common/Types/Date";
import { ComplianceSettingFramework } from "Common/Types/DataSecurity/ComplianceSettingFramework";
import {
  DataSecurityComplianceTurnedOff,
  DataSecurityResourceComplianceFramework,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import type { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A RESOURCE'S COMPLIANCE PAGE DRAWS (#9555), worked out without React
 * so a plain test pins it: which frameworks come first, which fold away,
 * where each switch stands, and the words for where a database's switches
 * are set.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does. Each is looked
 * up where it is drawn.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * One switch: a framework, or one of its requirements. A resource's rows can
 * hold a Kubernetes cluster's own frameworks too (#9627), keyed the same way.
 */
export interface ComplianceSwitchKey {
  framework: ComplianceSettingFramework;
  requirement?: string | null | undefined;
}

export function getComplianceSwitchKey(key: ComplianceSwitchKey): string {
  return `${key.framework}|${(key.requirement || "").trim()}`;
}

export interface ResourceFrameworkSections {
  // In scope and on: tiles to pick, first.
  applying: Array<DataSecurityResourceComplianceFramework>;
  // Turned off for the resource, with a switch to turn each on again.
  turnedOff: Array<DataSecurityResourceComplianceFramework>;
  // On, but no data here puts it in scope.
  notInScope: Array<DataSecurityResourceComplianceFramework>;
}

/*
 * The frameworks, in the catalog's order, as the page sorts them: those the
 * resource's data puts in scope and that are on; those turned off for it;
 * and those no store of it holds data for.
 */
export function splitResourceFrameworks(
  frameworks: ReadonlyArray<DataSecurityResourceComplianceFramework>,
): ResourceFrameworkSections {
  const sections: ResourceFrameworkSections = {
    applying: [],
    turnedOff: [],
    notInScope: [],
  };

  for (const framework of frameworks) {
    if (framework.isTurnedOff) {
      sections.turnedOff.push(framework);
    } else if (framework.storesInScope > 0) {
      sections.applying.push(framework);
    } else {
      sections.notInScope.push(framework);
    }
  }

  return sections;
}

/*
 * Where a switch stands: a framework is on unless the resource turned it
 * off, a requirement unless the resource turned it off.
 */
export function getAppliesSwitchState(
  framework: DataSecurityResourceComplianceFramework,
  key: ComplianceSwitchKey,
): boolean {
  if (framework.isTurnedOff) {
    return false;
  }

  const requirement: string = (key.requirement || "").trim();

  if (!requirement) {
    return true;
  }

  return !framework.turnedOffRequirements.includes(requirement);
}

/*
 * WHY IT IS TURNED OFF, BY WHOM AND WHEN (#9629). Turning a framework or a
 * requirement off asks for a short reason, which is optional, shown beside
 * it and kept in the audit log with the change itself.
 */

// The longest reason a setting keeps: its column's (ColumnLength.LongText).
export const COMPLIANCE_REASON_MAX_LENGTH: number = 500;

export const TURNED_OFF_BY_ON: string = translationKey(
  "Turned off by {{name}} on {{date}}",
);

export const TURNED_OFF_ON: string = translationKey("Turned off on {{date}}");

export const TURNED_OFF: string = translationKey("Turned off");

export const REASON_QUESTION: string = translationKey(
  "Why does this not apply here?",
);

export const REASON_HINT: string = translationKey(
  "Optional. Shown beside it, and kept in the audit log.",
);

export const REASON_SAVE_FAILED: string = translationKey(
  "The reason was not saved.",
);

/*
 * What is turned off of a framework for one requirement, or for the whole
 * framework (no requirement): the entries of the resources that turned it
 * off, the latest first.
 */
export function getTurnedOffEntries(
  framework: {
    turnedOff?: Array<DataSecurityComplianceTurnedOff> | undefined;
  },
  requirement?: string | null | undefined,
): Array<DataSecurityComplianceTurnedOff> {
  const wanted: string = (requirement || "").trim();

  return (framework.turnedOff || []).filter(
    (entry: DataSecurityComplianceTurnedOff): boolean => {
      return (entry.requirement || "").trim() === wanted;
    },
  );
}

// The one entry of a switch where a resource's compliance is set.
export function findTurnedOffEntry(
  framework: {
    turnedOff?: Array<DataSecurityComplianceTurnedOff> | undefined;
  },
  key: ComplianceSwitchKey,
): DataSecurityComplianceTurnedOff | undefined {
  return getTurnedOffEntries(framework, key.requirement)[0];
}

/*
 * Who turned it off and when, in the reader's words: "Turned off by Jane
 * Doe on 12 Nov 2026", "Turned off on 12 Nov 2026" for an API key, or
 * "Turned off" when nobody knows - a setting from before they were kept.
 */
export function getTurnedOffLine(
  entry: Pick<DataSecurityComplianceTurnedOff, "turnedOffAt" | "turnedOffBy">,
  translator: Translator,
): string {
  if (!entry.turnedOffAt) {
    return translator.translateText(TURNED_OFF) || TURNED_OFF;
  }

  const date: string = OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    entry.turnedOffAt,
    true,
  );

  return entry.turnedOffBy
    ? translator.translateTemplate(TURNED_OFF_BY_ON, {
        name: entry.turnedOffBy,
        date,
      })
    : translator.translateTemplate(TURNED_OFF_ON, { date });
}

// A reason as it is typed: no longer than its column holds. It is trimmed when saved.
export function readReasonInput(value: string): string {
  return value.slice(0, COMPLIANCE_REASON_MAX_LENGTH);
}

// Where a database's switches are, when it runs on a cluster or a container host.
export const SET_ON_OWNER_SENTENCES: Readonly<
  Partial<Record<DataStoreResourceKind, string>>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "Turned on and off for the Kubernetes cluster this database runs on.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "Turned on and off for the Docker host this database runs on.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "Turned on and off for the Podman host this database runs on.",
  ),
};

// The notice above a database's frameworks, naming its cluster or host.
export const OWNER_NOTICE_TEMPLATES: Readonly<
  Partial<Record<DataStoreResourceKind, string>>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "This database runs on the Kubernetes cluster {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "This database runs on the Docker host {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "This database runs on the Podman host {{name}}, whose Compliance page turns frameworks on and off for every database on it.",
  ),
};
