import SecurityLogFormat from "Common/Types/SecurityEvent/SecurityLogFormat";
import SecurityEventDestinationScope from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words the Connections page shows for things defined in Common/Types -
 * the log formats "Your logs" recognizes, what a SIEM can be sent and the
 * Google SecOps form's fields - marked here so the extractor puts them in
 * the locale files (it does not read Common/Types/SecurityEvent). The
 * English is the same text the definitions carry, word for word; a test
 * holds the two together (App/Tests/Dashboard/SecurityConnectionsCopy).
 */

export interface SecurityConnectionsText {
  title: string;
  description: string;
}

export const SECURITY_LOG_FORMAT_TEXTS: Record<
  SecurityLogFormat,
  SecurityConnectionsText
> = {
  [SecurityLogFormat.SshSignIn]: {
    title: translationKey("SSH sign-ins"),
    description: translationKey(
      "Failed and successful SSH sign-ins from a server's auth log, journal or syslog.",
    ),
  },
  [SecurityLogFormat.Sudo]: {
    title: translationKey("sudo"),
    description: translationKey(
      "Commands run as another user, wrong sudo passwords and people not allowed to use sudo.",
    ),
  },
  [SecurityLogFormat.KubernetesAudit]: {
    title: translationKey("Kubernetes audit logs"),
    description: translationKey(
      "Changes to the cluster, shells opened in pods, secrets read and requests that were refused.",
    ),
  },
  [SecurityLogFormat.AwsCloudTrail]: {
    title: translationKey("AWS CloudTrail"),
    description: translationKey(
      "Console sign-ins, changes made in your AWS accounts and calls AWS refused.",
    ),
  },
  [SecurityLogFormat.WebAttack]: {
    title: translationKey("Web attacks"),
    description: translationKey(
      "Requests in a web server's access log that try SQL injection, path traversal or Log4Shell.",
    ),
  },
};

export const SECURITY_EVENT_DESTINATION_SCOPE_TEXTS: Record<
  SecurityEventDestinationScope,
  SecurityConnectionsText
> = {
  [SecurityEventDestinationScope.Detections]: {
    title: translationKey("Detections only"),
    description: translationKey(
      "What your detection rules and threat intel found, and the alerts your connected products raised.",
    ),
  },
  [SecurityEventDestinationScope.AllEvents]: {
    title: translationKey("All security events"),
    description: translationKey(
      "Every security event OneUptime receives, so your SIEM can search them too.",
    ),
  },
};

/*
 * The destination form's fields, by the catalog's field key. The form draws
 * the catalog's own title and description; these only put the same words
 * in the locale files.
 */
export const SECURITY_EVENT_DESTINATION_FIELD_TEXTS: Record<
  string,
  SecurityConnectionsText
> = {
  region: {
    title: translationKey("Region"),
    description: translationKey(
      "The Google SecOps regional endpoint that matches the location in your instance resource name.",
    ),
  },
  instanceResourceName: {
    title: translationKey("Instance resource name"),
    description: translationKey(
      "The Chronicle instance resource name, from your SecOps SIEM Settings > Profile.",
    ),
  },
  serviceAccountJson: {
    title: translationKey("Service account JSON"),
    description: translationKey(
      "A Google Cloud service-account key (JSON) with a role that can import events (chronicle.events.import), such as Chronicle API Editor. Encrypted at rest and never returned by the API.",
    ),
  },
};
