/*
 * The security records OneUptime recognizes in the logs a project already
 * sends it. With "Your logs" turned on (SecurityLogSource), every log line
 * of one of these shapes becomes a security event too - so the rule library
 * finds brute force in SSH and Windows sign-ins, a shell opened in a pod in
 * Kubernetes audit logs, a stopped CloudTrail in AWS's own log and an attack
 * a firewall blocked in its CEF, with nothing new to send.
 *
 * Only the lines that matter for security become events: failed and
 * successful sign-ins, commands run as another user, changes and denied
 * calls, threats a security product found - never every read of an API,
 * every page a web server served or every connection a firewall allowed.
 */
enum SecurityLogFormat {
  SshSignIn = "ssh-sign-in",
  Sudo = "sudo",
  WindowsEvents = "windows-events",
  KubernetesAudit = "kubernetes-audit",
  AwsCloudTrail = "aws-cloudtrail",
  GoogleCloudAudit = "google-cloud-audit",
  AzureActivity = "azure-activity",
  Cef = "cef",
  Leef = "leef",
  WebAttack = "web-attack",
}

export default SecurityLogFormat;

/*
 * Where the logs of a kind come from, as the Connections page groups them,
 * so ten kinds read as four places a team knows.
 */
export enum SecurityLogFormatGroup {
  // Linux and Windows machines: their sign-ins, commands and processes.
  Servers = "servers",
  // Cloud providers' audit logs and their identity services.
  Cloud = "cloud",
  // Firewalls, IDS, WAFs, proxies and endpoint products over syslog.
  SecurityDevices = "security-devices",
  // What runs on the machines: clusters and web servers.
  Applications = "applications",
}

export const SECURITY_LOG_FORMAT_GROUPS: ReadonlyArray<SecurityLogFormatGroup> =
  [
    SecurityLogFormatGroup.Servers,
    SecurityLogFormatGroup.Cloud,
    SecurityLogFormatGroup.SecurityDevices,
    SecurityLogFormatGroup.Applications,
  ];

export interface SecurityLogFormatDefinition {
  format: SecurityLogFormat;
  group: SecurityLogFormatGroup;
  title: string;
  description: string;
  /*
   * Stamped on every event made from such a line - unless the line names
   * its own maker, as a CEF or LEEF line does in its header, a Windows
   * event its provider, and an Azure record whether it is the Activity Log
   * or Microsoft Entra ID's.
   */
  vendorName: string;
  productName: string;
  // One line of the kind, as a reader would recognize it.
  example: string;
}

export const SECURITY_LOG_FORMATS: ReadonlyArray<SecurityLogFormatDefinition> =
  [
    {
      format: SecurityLogFormat.SshSignIn,
      group: SecurityLogFormatGroup.Servers,
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
      group: SecurityLogFormatGroup.Servers,
      title: "sudo",
      description:
        "Commands run as another user, wrong sudo passwords and people not allowed to use sudo.",
      vendorName: "Linux",
      productName: "sudo",
      example:
        "sudo: alice : TTY=pts/0 ; PWD=/home/alice ; USER=root ; COMMAND=/usr/bin/cat /etc/shadow",
    },
    {
      format: SecurityLogFormat.WindowsEvents,
      group: SecurityLogFormatGroup.Servers,
      title: "Windows events",
      description:
        "Sign-ins, new processes, accounts and groups changed, services installed and logs cleared, from Windows, Sysmon and Microsoft Defender.",
      vendorName: "Microsoft",
      productName: "Windows",
      example:
        '{"EventID":4625,"Channel":"Security","ProviderName":"Microsoft-Windows-Security-Auditing","Computer":"WIN-01","TargetUserName":"alice","LogonType":"3","IpAddress":"203.0.113.7","Status":"0xc000006d","SubStatus":"0xc000006a"}',
    },
    {
      format: SecurityLogFormat.KubernetesAudit,
      group: SecurityLogFormatGroup.Applications,
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
      group: SecurityLogFormatGroup.Cloud,
      title: "AWS CloudTrail",
      description:
        "Console sign-ins, changes made in your AWS accounts and calls AWS refused.",
      vendorName: "AWS",
      productName: "AWS CloudTrail",
      example:
        '{"eventSource":"iam.amazonaws.com","eventName":"CreateAccessKey","userIdentity":{"type":"IAMUser"},"readOnly":false}',
    },
    {
      format: SecurityLogFormat.GoogleCloudAudit,
      group: SecurityLogFormatGroup.Cloud,
      title: "Google Cloud audit logs",
      description:
        "Changes made in your Google Cloud projects, calls Google refused, and Google Workspace sign-ins shared with Google Cloud.",
      vendorName: "Google",
      productName: "Google Cloud Audit Logs",
      example:
        '{"logName":"projects/acme-prod/logs/cloudaudit.googleapis.com%2Factivity","protoPayload":{"@type":"type.googleapis.com/google.cloud.audit.AuditLog","serviceName":"iam.googleapis.com","methodName":"google.iam.admin.v1.CreateServiceAccountKey","authenticationInfo":{"principalEmail":"alice@example.com"},"requestMetadata":{"callerIp":"203.0.113.7"}}}',
    },
    {
      format: SecurityLogFormat.AzureActivity,
      group: SecurityLogFormatGroup.Cloud,
      title: "Azure activity and Entra ID logs",
      description:
        "Changes made in your Azure subscriptions, Defender for Cloud alerts, and Microsoft Entra ID sign-ins and directory changes.",
      vendorName: "Microsoft",
      productName: "Azure Activity Log",
      example:
        '{"category":"Administrative","operationName":"MICROSOFT.AUTHORIZATION/ROLEASSIGNMENTS/WRITE","resultType":"Success","callerIpAddress":"203.0.113.7","identity":{"claims":{"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn":"alice@example.com"}},"resourceId":"/SUBSCRIPTIONS/00000000-0000-0000-0000-000000000000"}',
    },
    {
      format: SecurityLogFormat.Cef,
      group: SecurityLogFormatGroup.SecurityDevices,
      title: "CEF",
      description:
        "Threats, blocked connections and sign-ins from firewalls, IDS, WAFs and other security products that send Common Event Format.",
      vendorName: "",
      productName: "CEF",
      example:
        "CEF:0|Imperva Inc.|SecureSphere|15.0|Protocol|SQL injection|High|act=block src=203.0.113.7 dst=10.0.0.5 dpt=443 request=/item?id\\=1' or 1\\=1",
    },
    {
      format: SecurityLogFormat.Leef,
      group: SecurityLogFormatGroup.SecurityDevices,
      title: "LEEF",
      description:
        "The same from products that send Log Event Extended Format, as many do for IBM QRadar.",
      vendorName: "",
      productName: "LEEF",
      example:
        "LEEF:1.0|Zscaler|NSSWeblog|5.7|Blocked|cat=Malicious Content\tsrc=192.0.2.15\tdst=203.0.113.80\tusrName=alice@example.com\taction=Blocked\tsev=9",
    },
    {
      format: SecurityLogFormat.WebAttack,
      group: SecurityLogFormatGroup.Applications,
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

// The kinds of a group, in the order the Connections page lists them.
export function getSecurityLogFormatsInGroup(
  group: SecurityLogFormatGroup,
): Array<SecurityLogFormatDefinition> {
  return SECURITY_LOG_FORMATS.filter(
    (definition: SecurityLogFormatDefinition): boolean => {
      return definition.group === group;
    },
  );
}

/*
 * When the log scan last found a security event of each kind, as its
 * result keeps it (lastFoundAtByFormat: format -> ISO time), carried from
 * one scan to the next: the health of each source "Your logs" reads. Only
 * known formats and readable times are read; anything else in a stored
 * result is left out.
 */
export function readLastFoundAtByFormat(
  result: unknown,
): Partial<Record<SecurityLogFormat, Date>> {
  const found: Partial<Record<SecurityLogFormat, Date>> = {};
  const byFormat: unknown =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)["lastFoundAtByFormat"]
      : undefined;

  if (!byFormat || typeof byFormat !== "object" || Array.isArray(byFormat)) {
    return found;
  }

  for (const definition of SECURITY_LOG_FORMATS) {
    const value: unknown = (byFormat as Record<string, unknown>)[
      definition.format
    ];

    if (typeof value !== "string" || !value) {
      continue;
    }

    const date: Date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      found[definition.format] = date;
    }
  }

  return found;
}

// Attributes every event made from a log line carries.
export const SECURITY_LOG_SOURCE_ATTRIBUTE: string = "oneuptime.source";
export const SECURITY_LOG_SOURCE_VALUE: string = "logs";
export const SECURITY_LOG_FORMAT_ATTRIBUTE: string = "oneuptime.log.format";
export const SECURITY_LOG_ID_ATTRIBUTE: string = "oneuptime.log.id";
