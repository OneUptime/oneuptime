/*
 * Replica names → the workload they are copies of.
 *
 * Fleets are what make an infrastructure view unreadable: a deployment with
 * twelve replicas is one thing to a person and twelve boxes to a naive map.
 * Most orchestrators name replicas mechanically, so the workload name can be
 * read back off the replica name:
 *
 *   Deployment pod   checkout-6d4f8b9c7d-x2k9p    → checkout
 *   DaemonSet / Job  node-exporter-x2k9p          → node-exporter
 *   StatefulSet      postgres-2                   → postgres
 *   numbered host    web-03                       → web
 *
 * Kubernetes generates both the ReplicaSet hash and the pod suffix from an
 * alphabet with no vowels and no 0/1/3, which is what keeps the first two
 * shapes from matching ordinary hyphenated words ("build-server",
 * "api-gateway"). The result is only ever used to group siblings that share
 * it, never to rename anything.
 */

const K8S_ALPHABET: string = "[bcdfghjklmnpqrstvwxz2456789]";

const DEPLOYMENT_REPLICA_REGEX: RegExp = new RegExp(
  `^(.+)-${K8S_ALPHABET}{6,10}-${K8S_ALPHABET}{5}$`,
);
const GENERATED_SUFFIX_REGEX: RegExp = new RegExp(`^(.+)-${K8S_ALPHABET}{5}$`);
const NUMBERED_REGEX: RegExp = /^(.+?)-?(\d{1,4})$/;
const DIGIT_REGEX: RegExp = /\d/;
const ENDS_WITH_LETTER_REGEX: RegExp = /[a-z]$/i;

/*
 * A generated five-character suffix is only trustworthy when it contains a
 * digit: "worker-plant" is a name, "worker-x2k9p" is a replica.
 */
function hasDigit(value: string): boolean {
  return DIGIT_REGEX.test(value);
}

export function workloadNameForReplica(name: string): string | null {
  const trimmed: string = (name || "").trim();
  if (!trimmed) {
    return null;
  }

  const deployment: RegExpMatchArray | null = trimmed.match(
    DEPLOYMENT_REPLICA_REGEX,
  );
  if (deployment && deployment[1]) {
    return deployment[1];
  }

  const generated: RegExpMatchArray | null = trimmed.match(
    GENERATED_SUFFIX_REGEX,
  );
  if (generated && generated[1] && hasDigit(trimmed.slice(-5))) {
    return generated[1];
  }

  /*
   * The remaining name must end in a letter: "ip-10-0-1-23" is an address
   * spelled as a hostname, not replica 23 of a workload called "ip-10-0-1".
   */
  const numbered: RegExpMatchArray | null = trimmed.match(NUMBERED_REGEX);
  const base: string = numbered?.[1]?.replace(/[-_.]+$/, "") || "";
  if (base && ENDS_WITH_LETTER_REGEX.test(base)) {
    return base;
  }

  return null;
}
