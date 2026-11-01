import { PROXMOX_NOTIFICATIONS_STEP_TITLE } from "../../../FeatureSet/Dashboard/src/Pages/Proxmox/Utils/DocumentationMarkdown";
import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import {
  ProxmoxNotificationAlertTemplate,
  getAllProxmoxNotificationAlertTemplates,
} from "Common/Types/Monitor/ProxmoxNotificationAlertTemplates";
import {
  PROXMOX_NOTIFICATION_NODE_ATTRIBUTE,
  ProxmoxNotificationAttribute,
  ProxmoxNotificationSeverity,
  ProxmoxNotificationType,
  buildProxmoxNotificationRemoveCommands,
  buildProxmoxNotificationSetupCommands,
} from "Common/Utils/Proxmox/ProxmoxNotifications";
import { describe, expect, it } from "@jest/globals";

/*
 * The Proxmox agent page's "Send Proxmox VE's notifications": the two
 * commands that send a cluster's notifications to OneUptime as logs, what
 * each record carries, and what OneUptime does with them. The commands are
 * the ones the cluster's setup guide builds (ProxmoxNotifications), shown
 * for OneUptime Cloud and a sample cluster, so a change to the webhook
 * fails here until the page shows it. The translations keep the same code
 * line for line (InfrastructureAgentDocsTranslations).
 */

const PAGE: string = "telemetry/proxmox";
const HEADING: string = `## ${PROXMOX_NOTIFICATIONS_STEP_TITLE}`;

// What the page's commands are written for.
const DOCS_ONEUPTIME_URL: string = "https://oneuptime.com";
const DOCS_CLUSTER_NAME: string = "pve-prod";
const DOCS_INGESTION_KEY: string = "YOUR_TELEMETRY_INGESTION_KEY";

const ATTRIBUTE_ROW: RegExp = /^\| `([^`]+)` \| (.+) \|$/;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;

function englishPage(): string {
  return readPage("en", PAGE);
}

// From the heading to the next H2.
function section(): string {
  const markdown: string = englishPage();
  const start: number = markdown.indexOf(`${HEADING}\n`);
  expect({ heading: HEADING, found: start > -1 }).toEqual({
    heading: HEADING,
    found: true,
  });
  const end: number = markdown.indexOf("\n## ", start + HEADING.length);
  return markdown.slice(start, end < 0 ? undefined : end);
}

function bashFences(): Array<string> {
  return scanMarkdown(section())
    .fences.filter((fence: DocsFence): boolean => {
      return fence.lang === "bash";
    })
    .map((fence: DocsFence): string => {
      return fence.code.trim();
    });
}

// The attribute table: each row's attribute and the inline code of its value.
function attributeRows(): Array<{ attribute: string; values: Array<string> }> {
  return section()
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(ATTRIBUTE_ROW);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray) => {
      return {
        attribute: match[1] as string,
        values: Array.from((match[2] as string).matchAll(INLINE_CODE)).map(
          (code: RegExpMatchArray): string => {
            return code[1] as string;
          },
        ),
      };
    });
}

function valuesOf(attribute: string): Array<string> {
  const row: { attribute: string; values: Array<string> } | undefined =
    attributeRows().find((candidate: { attribute: string }): boolean => {
      return candidate.attribute === attribute;
    });
  expect({ attribute, listed: Boolean(row) }).toEqual({
    attribute,
    listed: true,
  });
  return row?.values || [];
}

describe("the Proxmox agent page's notifications section", () => {
  it("is titled as the setup guide's last step", () => {
    expect(PROXMOX_NOTIFICATIONS_STEP_TITLE).toBe(
      "Send Proxmox VE's notifications",
    );
    expect(englishPage()).toContain(`${HEADING}\n`);
  });

  it("shows the setup commands the guide builds, then the commands that remove them", () => {
    expect(bashFences()).toEqual([
      buildProxmoxNotificationSetupCommands({
        oneUptimeUrl: DOCS_ONEUPTIME_URL,
        clusterName: DOCS_CLUSTER_NAME,
        ingestionKey: DOCS_INGESTION_KEY,
      }),
      buildProxmoxNotificationRemoveCommands(),
    ]);
  });

  it("names the release webhook targets need, here and in the comparison table", () => {
    expect(section()).toContain("On Proxmox VE 8.3 or later");
    expect(englishPage()).toContain(
      "| Backup results, fenced nodes and failed replication, from Proxmox VE's notifications (8.3 or later) | Yes | Yes |",
    );
  });

  it("lists every attribute a notification record carries, in the order the body writes them", () => {
    expect(
      attributeRows().map((row: { attribute: string }): string => {
        return row.attribute;
      }),
    ).toEqual([
      ProxmoxNotificationAttribute.Type,
      ProxmoxNotificationAttribute.Severity,
      ProxmoxNotificationAttribute.Title,
      ProxmoxNotificationAttribute.JobId,
      PROXMOX_NOTIFICATION_NODE_ATTRIBUTE,
    ]);
  });

  it("lists every notification type and every severity Proxmox VE sends", () => {
    expect(valuesOf(ProxmoxNotificationAttribute.Type)).toEqual(
      Object.values(ProxmoxNotificationType),
    );
    expect(valuesOf(ProxmoxNotificationAttribute.Severity)).toEqual(
      Object.values(ProxmoxNotificationSeverity),
    );
  });

  it("names the alerts that read the same logs by their template names", () => {
    for (const template of getAllProxmoxNotificationAlertTemplates()) {
      expect({ template: template.name, named: true }).toEqual({
        template: template.name,
        named: section().includes(`**${template.name}**`),
      });
    }
    expect(
      getAllProxmoxNotificationAlertTemplates().map(
        (template: ProxmoxNotificationAlertTemplate): string => {
          return template.name;
        },
      ),
    ).toEqual(["Backup Job Failed", "Node Fenced"]);
  });

  it("is linked from the page's cards and its native push section, and has a troubleshooting entry", () => {
    const markdown: string = englishPage();
    const link: string = "](#send-proxmox-ves-notifications)";

    expect(markdown.split(link).length - 1).toBe(2);
    expect(markdown).toContain(`- [Backup results${link}:`);
    expect(markdown).toContain(`[send Proxmox VE's notifications${link}`);
    expect(markdown).toContain(":::details Backup results never appear");
  });
});
