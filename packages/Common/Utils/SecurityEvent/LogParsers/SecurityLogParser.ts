import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import CloudTrailLogParser from "./CloudTrailLogParser";
import KubernetesAuditLogParser from "./KubernetesAuditLogParser";
import { SecurityLogLine } from "./SecurityLogLine";
import SshLogParser, { SSH_AUTHENTICATION_METHODS } from "./SshLogParser";
import SudoLogParser from "./SudoLogParser";
import WebAttackLogParser, { WEB_ATTACK_MARKERS } from "./WebAttackLogParser";

/*
 * Reads one log line for the security records OneUptime recognizes
 * (SecurityLogFormat) and returns the security events it holds: none for
 * almost every line, one for a sign-in or an audit record, and several for
 * a CloudTrail file of records.
 *
 * The parsers are tried from the most specific shape to the least: a JSON
 * audit or CloudTrail record, then SSH and sudo lines, and last an attack
 * string in a request. A line is one kind of record, so the first parser
 * that reads it wins.
 */

type LogLineParser = (line: SecurityLogLine) => Array<NormalizedSecurityEvent>;

const PARSERS: ReadonlyArray<LogLineParser> = [
  (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
    return KubernetesAuditLogParser.parse(line);
  },
  (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
    return CloudTrailLogParser.parse(line);
  },
  (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
    return SshLogParser.parse(line);
  },
  (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
    return SudoLogParser.parse(line);
  },
  (line: SecurityLogLine): Array<NormalizedSecurityEvent> => {
    return WebAttackLogParser.parse(line);
  },
];

/*
 * A shape of line that is only worth reading when it holds more: an audit
 * record that is a change or a refusal, a CloudTrail record that is a
 * change, an error or a sign-in.
 */
export interface SecurityLogPrefilterGroup {
  // The line holds this...
  requires: string;
  // ...and one of these...
  anyOf: ReadonlyArray<string>;
  // ...and none of these - unless it holds one of `unlessAnyOf` too.
  noneOf?: ReadonlyArray<string> | undefined;
  unlessAnyOf?: ReadonlyArray<string> | undefined;
}

export interface SecurityLogPrefilter {
  // A line that holds any of these is read.
  anyOf: ReadonlyArray<string>;
  // So is one that matches a group.
  groups: ReadonlyArray<SecurityLogPrefilterGroup>;
}

/*
 * The words that decide which log lines the log scan asks the database for,
 * matched without case. Only those lines ever leave the database, and the
 * parsers above then decide; so every line a parser turns into an event
 * holds these words (a test holds them to that), and most lines that hold
 * them are worth reading. The control plane's own requests are held back
 * here as in KubernetesAuditLogParser: they are most of an audit log.
 */
export const SECURITY_LOG_PREFILTER: SecurityLogPrefilter = {
  anyOf: [
    // SSH: "Failed <method> for", "Accepted <method> for", "Invalid user".
    ...SSH_AUTHENTICATION_METHODS.map((method: string): string => {
      return `failed ${method}`;
    }),
    ...SSH_AUTHENTICATION_METHODS.map((method: string): string => {
      return `accepted ${method}`;
    }),
    "invalid user ",
    // sudo
    "; command=",
    // Attack strings in requests.
    ...WEB_ATTACK_MARKERS.flatMap(
      (group: { markers: ReadonlyArray<string> }): Array<string> => {
        return [...group.markers];
      },
    ),
  ],
  groups: [
    // Kubernetes audit: refusals and shells into pods, from anyone.
    {
      requires: "audit.k8s.io/",
      anyOf: [
        '"code":401',
        '"code":403',
        '"subresource":"exec"',
        '"subresource":"attach"',
        '"subresource":"portforward"',
      ],
    },
    // Kubernetes audit: what changes who may do what, by anyone but the control plane.
    {
      requires: "audit.k8s.io/",
      anyOf: [
        '"resource":"secrets"',
        '"resource":"pods"',
        '"resource":"roles"',
        '"resource":"rolebindings"',
        '"resource":"clusterroles"',
        '"resource":"clusterrolebindings"',
        '"resource":"serviceaccounts"',
        '"resource":"mutatingwebhookconfigurations"',
        '"resource":"validatingwebhookconfigurations"',
        '"resource":"customresourcedefinitions"',
        '"resource":"networkpolicies"',
        '"resource":"namespaces"',
        '"resource":"nodes"',
      ],
      noneOf: [
        '"username":"system:node:',
        '"username":"system:kube-',
        '"username":"system:apiserver"',
        '"username":"system:serviceaccount:kube-system:',
      ],
      unlessAnyOf: [
        '"privileged":true',
        '"hostpid":true',
        '"hostnetwork":true',
        '"hostipc":true',
      ],
    },
    // CloudTrail: errors, console sign-ins, the root user and changes.
    {
      requires: '"eventsource"',
      anyOf: [
        '"errorcode"',
        '"consolelogin"',
        '"type":"root"',
        '"type": "root"',
        '"readonly":false',
        '"readonly": false',
        '"readonly":"false"',
        '"readonly": "false"',
      ],
    },
  ],
};

function holdsAny(lowerText: string, words: ReadonlyArray<string>): boolean {
  return words.some((word: string): boolean => {
    return lowerText.indexOf(word) !== -1;
  });
}

/*
 * The prefilter, read in JavaScript the way the database reads it: what
 * the tests hold the parsers to, and what a scan of lines that did not
 * come from the database (a test, a preview) uses.
 */
export function matchesSecurityLogPrefilter(body: string): boolean {
  const lower: string = (body || "").toLowerCase();

  if (holdsAny(lower, SECURITY_LOG_PREFILTER.anyOf)) {
    return true;
  }

  return SECURITY_LOG_PREFILTER.groups.some(
    (group: SecurityLogPrefilterGroup): boolean => {
      if (lower.indexOf(group.requires) === -1) {
        return false;
      }

      if (!holdsAny(lower, group.anyOf)) {
        return false;
      }

      if (group.noneOf && holdsAny(lower, group.noneOf)) {
        return Boolean(group.unlessAnyOf && holdsAny(lower, group.unlessAnyOf));
      }

      return true;
    },
  );
}

export default class SecurityLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    if (!line.body) {
      return [];
    }

    for (const parser of PARSERS) {
      const events: Array<NormalizedSecurityEvent> = parser(line);

      if (events.length > 0) {
        return events;
      }
    }

    return [];
  }
}
