import AiResourceType from "../ResourceAiAgent/AiResourceType";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";

/*
 * THE NAME OF AN AI REMEDIATION ROUND, AND HOW IT READS.
 *
 * A round OneUptime AI runs on a cluster or a resource is named by the
 * server - 'AI remediation for cluster "prod-eu-west-1"', 'AI remediation
 * for Docker host "web-1" (round 2)' - and the name is stored with the
 * round (AutoRemediationSuggestion.ruleNameSnapshot), where the feed, the
 * Slack and Microsoft Teams messages and the model read it in English. A
 * cluster delete nulls the round's cluster (ON DELETE SET NULL), and the
 * name is then the only thing left that says the round was a cluster's
 * (parseClusterRoundNameSnapshot).
 *
 * The Remediation step showed that English name under the fix's title on
 * every page, in every language. It now words the round in the reader's
 * language from the facts the name carries - what it ran on, its name,
 * which round it is (describeRemediationRoundName) - and shows the name as
 * written only for one it cannot read.
 */

export const CLUSTER_ROUND_NAME_PREFIX: string = "AI remediation for cluster";

/*
 * What a round's resource is called in its name, by its type: "Docker
 * host", but "host" and "database server" for the generic nouns. A
 * translation key each, so the Remediation step says them in the reader's
 * language; RemediationRoundName.test holds them to the server's
 * describeResourceNoun.
 */
export const REMEDIATION_ROUND_RESOURCE_NOUNS: Readonly<
  Record<AiResourceType, string>
> = {
  [AiResourceType.DockerHost]: translationKey("Docker host"),
  [AiResourceType.PodmanHost]: translationKey("Podman host"),
  [AiResourceType.DockerSwarmCluster]: translationKey("Docker Swarm cluster"),
  [AiResourceType.ProxmoxCluster]: translationKey("Proxmox cluster"),
  [AiResourceType.VMwareVCenter]: translationKey("VMware vCenter"),
  [AiResourceType.CephCluster]: translationKey("Ceph cluster"),
  [AiResourceType.DatabaseServer]: translationKey("database server"),
  [AiResourceType.Host]: translationKey("host"),
  [AiResourceType.AwsAccount]: translationKey("AWS account"),
  [AiResourceType.AzureSubscription]: translationKey("Azure subscription"),
  [AiResourceType.GoogleCloudProject]: translationKey("Google Cloud project"),
};

// A round's name for a type that has no noun of its own.
const RESOURCE_NOUN: string = "resource";

export function getRemediationRoundResourceNoun(
  resourceType: AiResourceType | string | null | undefined,
): string {
  return Object.prototype.hasOwnProperty.call(
    REMEDIATION_ROUND_RESOURCE_NOUNS,
    resourceType || "",
  )
    ? REMEDIATION_ROUND_RESOURCE_NOUNS[resourceType as AiResourceType]
    : RESOURCE_NOUN;
}

// " (round 2)" after a name, for every round after the first.
function getRoundSuffix(round: number): string {
  return round > 1 ? ` (round ${round})` : "";
}

/*
 * The name a cluster-level round carries. Server-written, and parsed back
 * by parseClusterRoundNameSnapshot.
 */
export function getClusterRoundNameSnapshot(
  clusterName: string,
  round: number,
): string {
  return `${CLUSTER_ROUND_NAME_PREFIX} "${clusterName}"${getRoundSuffix(round)}`;
}

const CLUSTER_ROUND_NAME_PATTERN: RegExp =
  /^AI remediation for cluster "(.*)"(?: \(round (\d+)\))?$/;

/*
 * The cluster name inside a cluster round's name snapshot, or null when the
 * snapshot is not one. A rule can in principle be NAMED like a cluster
 * round, so callers only trust this on a row that has neither a rule nor a
 * cluster link left, where it is the best evidence there is.
 */
export function parseClusterRoundNameSnapshot(
  name: unknown,
): { clusterName: string } | null {
  const parsed: ParsedRoundName | null = parseClusterRoundName(name);

  return parsed ? { clusterName: parsed.name } : null;
}

/*
 * The name a resource-level round carries: 'AI remediation for Docker host
 * "web-1"', 'AI remediation for host "web-2" (round 2)'. Server-written.
 * Never "for cluster": parseClusterRoundNameSnapshot must not read a
 * resource round as a deleted cluster's.
 */
export function getResourceRoundNameSnapshot(
  resourceType: AiResourceType,
  resourceName: string,
  round: number,
): string {
  return `AI remediation for ${getRemediationRoundResourceNoun(resourceType)} "${resourceName}"${getRoundSuffix(round)}`;
}

const RESOURCE_ROUND_NAME_SUFFIX: RegExp = /" \(round (\d+)\)$/;

/*
 * The round a resource round's server-written name carries (see
 * getResourceRoundNameSnapshot): N for '... "web-1" (round N)', 1 for
 * anything else. The suffix always follows the closing quote, so a
 * resource named 'web (round 2)' is never read as a round 2.
 */
export function parseResourceRoundNumber(
  ruleNameSnapshot: string | undefined | null,
): number {
  const match: RegExpExecArray | null = RESOURCE_ROUND_NAME_SUFFIX.exec(
    ruleNameSnapshot || "",
  );

  const round: number = match ? parseInt(match[1]!, 10) : 1;

  return Number.isFinite(round) && round > 1 ? round : 1;
}

// What a round's name says: what it ran on, by name, and which round.
export interface ParsedRoundName {
  name: string;
  round: number;
}

function toRound(text: string | undefined): number {
  const round: number = text ? parseInt(text, 10) : 1;

  return Number.isFinite(round) && round > 1 ? round : 1;
}

function parseClusterRoundName(name: unknown): ParsedRoundName | null {
  if (typeof name !== "string") {
    return null;
  }

  const match: RegExpMatchArray | null = name.match(CLUSTER_ROUND_NAME_PATTERN);

  return match ? { name: match[1] || "", round: toRound(match[2]) } : null;
}

/*
 * A resource round's name read back, for a round of `resourceType`: its
 * resource's name and its round, or null when the name is not that
 * type's round name (a rule's own name, or a type's noun changed since).
 */
export function parseResourceRoundName(
  name: unknown,
  resourceType: AiResourceType | string | null | undefined,
): ParsedRoundName | null {
  if (typeof name !== "string") {
    return null;
  }

  const prefix: string = `AI remediation for ${getRemediationRoundResourceNoun(resourceType)} "`;

  if (!name.startsWith(prefix)) {
    return null;
  }

  const rest: string = name.slice(prefix.length);
  const suffix: RegExpExecArray | null = RESOURCE_ROUND_NAME_SUFFIX.exec(
    `"${rest}`,
  );

  if (suffix && suffix.index > 0) {
    return {
      name: rest.slice(0, suffix.index - 1),
      round: toRound(suffix[1]),
    };
  }

  return rest.endsWith('"') ? { name: rest.slice(0, -1), round: 1 } : null;
}

/*
 * How a round reads on the Remediation step, in the reader's language: the
 * same words as its name, with the cluster's or resource's name as data
 * and its kind in the reader's words.
 */
export const REMEDIATION_ROUND_SENTENCES: {
  cluster: string;
  clusterRound: string;
  resource: string;
  resourceRound: string;
} = {
  cluster: translationKey('AI remediation for cluster "{{name}}"'),
  clusterRound: translationKey(
    'AI remediation for cluster "{{name}}" (round {{round}})',
  ),
  resource: translationKey('AI remediation for {{kind}} "{{name}}"'),
  resourceRound: translationKey(
    'AI remediation for {{kind}} "{{name}}" (round {{round}})',
  ),
};

let englishTranslator: Translator | null = null;

const getEnglishTranslator: () => Translator = (): Translator => {
  if (!englishTranslator) {
    englishTranslator = createTranslator(undefined, DEFAULT_LANGUAGE);
  }

  return englishTranslator;
};

/*
 * A cluster's or a resource's round, as the Remediation step names it in
 * the translator's language (English, as the server writes it, when none
 * is given); its values set apart for a page that draws it. Null for a
 * name that is not that round's - a rule's own name - which the step
 * shows as written.
 */
export function describeRemediationRoundName(
  data: {
    ruleNameSnapshot: string | null | undefined;
    // A cluster's round: the round has a cluster, or had one.
    isClusterRound: boolean;
    // A resource's round: its type.
    resourceType?: AiResourceType | string | null | undefined;
  },
  translator: Translator = getEnglishTranslator(),
): string | null {
  const options: { setsValuesApart: boolean } = { setsValuesApart: true };

  if (data.isClusterRound) {
    const parsed: ParsedRoundName | null = parseClusterRoundName(
      data.ruleNameSnapshot,
    );

    if (!parsed) {
      return null;
    }

    return parsed.round > 1
      ? translator.translateTemplate(
          REMEDIATION_ROUND_SENTENCES.clusterRound,
          { name: parsed.name, round: translator.formatNumber(parsed.round) },
          options,
        )
      : translator.translateTemplate(
          REMEDIATION_ROUND_SENTENCES.cluster,
          { name: parsed.name },
          options,
        );
  }

  const parsed: ParsedRoundName | null = parseResourceRoundName(
    data.ruleNameSnapshot,
    data.resourceType,
  );

  if (!parsed) {
    return null;
  }

  const kind: ReturnType<typeof translatableTerm> = translatableTerm(
    getRemediationRoundResourceNoun(data.resourceType),
    { inSentence: true },
  );

  return parsed.round > 1
    ? translator.translateTemplate(
        REMEDIATION_ROUND_SENTENCES.resourceRound,
        {
          kind,
          name: parsed.name,
          round: translator.formatNumber(parsed.round),
        },
        options,
      )
    : translator.translateTemplate(
        REMEDIATION_ROUND_SENTENCES.resource,
        { kind, name: parsed.name },
        options,
      );
}
