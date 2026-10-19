/*
 * The security records OneUptime recognizes in the logs a project already
 * sends it. With "Your logs" turned on (SecurityLogSource), every log line
 * of one of these shapes becomes a security event too - so the rule library
 * finds brute force in SSH logs, a shell opened in a pod in Kubernetes audit
 * logs and a stopped CloudTrail in AWS's own log, with nothing new to send.
 *
 * Only the lines that matter for security become events: failed and
 * successful sign-ins, commands run as another user, changes and denied
 * calls - never every read of an API or every page a web server served.
 */
enum SecurityLogFormat {
  SshSignIn = "ssh-sign-in",
  Sudo = "sudo",
  KubernetesAudit = "kubernetes-audit",
  AwsCloudTrail = "aws-cloudtrail",
  WebAttack = "web-attack",
}

export default SecurityLogFormat;

export interface SecurityLogFormatDefinition {
  format: SecurityLogFormat;
  title: string;
  description: string;
  // Stamped on every event made from such a line.
  vendorName: string;
  productName: string;
  // One line of the kind, as a reader would recognize it.
  example: string;
}

export const SECURITY_LOG_FORMATS: ReadonlyArray<SecurityLogFormatDefinition> =
  [
    {
      format: SecurityLogFormat.SshSignIn,
      title: "SSH sign-ins",
      description:
        "Failed and successful SSH sign-ins from a server's auth log, journal or syslog.",
      vendorName: "OpenSSH",
      productName: "SSH",
      example:
        "sshd[2210]: Failed password for invalid user admin from 203.0.113.7 port 52314 ssh2",
    },
    {
      format: SecurityLogFormat.Sudo,
      title: "sudo",
      description:
        "Commands run as another user, wrong sudo passwords and people not allowed to use sudo.",
      vendorName: "Linux",
      productName: "sudo",
      example:
        "sudo: alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow",
    },
    {
      format: SecurityLogFormat.KubernetesAudit,
      title: "Kubernetes audit logs",
      description:
        "Changes to the cluster, shells opened in pods, secrets read and requests that were refused.",
      vendorName: "Kubernetes",
      productName: "Kubernetes audit log",
      example:
        '{"apiVersion":"audit.k8s.io/v1","kind":"Event","verb":"create","objectRef":{"resource":"pods","subresource":"exec"}}',
    },
    {
      format: SecurityLogFormat.AwsCloudTrail,
      title: "AWS CloudTrail",
      description:
        "Console sign-ins, changes made in your AWS accounts and calls AWS refused.",
      vendorName: "AWS",
      productName: "AWS CloudTrail",
      example:
        '{"eventSource":"iam.amazonaws.com","eventName":"CreateAccessKey","userIdentity":{"type":"IAMUser"},"readOnly":false}',
    },
    {
      format: SecurityLogFormat.WebAttack,
      title: "Web attacks",
      description:
        "Requests in a web server's access log that try SQL injection, path traversal or Log4Shell.",
      vendorName: "",
      productName: "Web server",
      example:
        '203.0.113.7 - - [19/Oct/2026:10:00:00 +0000] "GET /item?id=1%27%20or%201%3D1 HTTP/1.1" 200 512',
    },
  ];

export function getSecurityLogFormatDefinition(
  format: string | undefined,
): SecurityLogFormatDefinition | undefined {
  return SECURITY_LOG_FORMATS.find(
    (definition: SecurityLogFormatDefinition): boolean => {
      return definition.format === format;
    },
  );
}

// Attributes every event made from a log line carries.
export const SECURITY_LOG_SOURCE_ATTRIBUTE: string = "oneuptime.source";
export const SECURITY_LOG_SOURCE_VALUE: string = "logs";
export const SECURITY_LOG_FORMAT_ATTRIBUTE: string = "oneuptime.log.format";
export const SECURITY_LOG_ID_ATTRIBUTE: string = "oneuptime.log.id";
