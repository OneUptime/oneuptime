import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { SECURITY_CONNECTED_SIGNALS } from "./AiObservabilityDocsPages";
import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  CONNECTED_NOT_FOUND_TITLE,
  CONNECTED_POSSIBLE_PILL,
  CONNECTED_SIGNALS_TITLE,
  CONNECTED_TAB_LABEL,
  CONNECTED_TRY_AGAIN,
  INCIDENT_SECURITY_DECLARED_BY,
  INCIDENT_SECURITY_NAMING,
  RESOURCE_SECURITY_OPEN_IN_SECURITY,
  RESOURCE_SECURITY_TITLE,
  SIGNAL_LINK_LABELS,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityConnections/SecurityConnectionsCopy";
import {
  SECURITY_CASE_MENU,
  SecurityCaseMenuItem,
  SecurityCaseMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityCaseNavigation";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import { RECORD_RELATION_COLUMNS } from "Common/Server/Utils/SecurityEvent/Connections/SecurityConnections";
import Permission from "Common/Types/Permission";
import {
  RESOURCE_SECURITY_WINDOW_IN_DAYS,
  SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES,
  SECURITY_CONNECTION_KINDS,
  SECURITY_CONNECTION_MAX_RESOURCES,
  SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import {
  getCaseConnectionWindow,
  getEventConnectionWindow,
  getSecurityConnectionLookups,
  matchAddress,
  matchEmail,
  matchHostName,
} from "Common/Utils/SecurityCase/SecurityConnectionMatch";
import { describe, expect, it } from "@jest/globals";

/*
 * The Connected Signals page, held to the product it describes: where the
 * connections are drawn and what each is called, how sure each kind of
 * match is (the matching rules themselves decide every row), how many
 * records a case lists, the windows, who may see what, the kinds of record
 * a declared incident is linked to, and the signals a record opens. A
 * change to any of them fails here until the page says so too.
 *
 * Its other languages are held line for line to this one by
 * AiToolingAndSecurityDocsTranslations.
 */

const LINE_BREAK: RegExp = /\n/;

function englishPage(): string {
  return readPage("en", SECURITY_CONNECTED_SIGNALS);
}

function bold(text: string): string {
  return `**${text}**`;
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function section(heading: string): string {
  const markdown: string = englishPage();
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The rows of a section's first table, under its header row.
function rowsOf(heading: string): Array<Array<string>> {
  const found: Array<Array<Array<string>>> = tables(section(heading));

  expect(found.length).toBeGreaterThan(0);

  return (found[0] as Array<Array<string>>).slice(1);
}

// What the page calls each kind of record, where it lists them.
const KIND_NOUNS: Readonly<Record<SecurityConnectionKind, string>> = {
  [SecurityConnectionKind.Host]: "host",
  [SecurityConnectionKind.DockerHost]: "Docker host",
  [SecurityConnectionKind.PodmanHost]: "Podman host",
  [SecurityConnectionKind.KubernetesCluster]: "Kubernetes cluster",
  [SecurityConnectionKind.NetworkDevice]: "network device",
  [SecurityConnectionKind.Service]: "service",
  [SecurityConnectionKind.User]: "member",
  [SecurityConnectionKind.InventoryItem]: "inventory item",
};

// The roles a permission list names, as the docs name roles.
const ROLE_NAMES: Partial<Record<Permission, string>> = {
  [Permission.ProjectOwner]: "Project Owner",
  [Permission.ProjectAdmin]: "Project Admin",
  [Permission.SecurityAdmin]: "Security Admin",
  [Permission.SecurityMember]: "Security Member",
  [Permission.SecurityViewer]: "Security Viewer",
};

describe("the Connected Signals page", () => {
  it("is titled as its nav link, right after Entity Risk in the Security group", () => {
    expect(englishPage().split(LINE_BREAK)[0]).toBe(
      `# ${CONNECTED_SIGNALS_TITLE}`,
    );

    const group: NavGroup | undefined = DocsNav.find(
      (candidate: NavGroup): boolean => {
        return candidate.links.some((link: NavLink): boolean => {
          return link.url === `/docs/${SECURITY_CONNECTED_SIGNALS}`;
        });
      },
    );

    expect(group?.title).toBe("Security");

    const urls: Array<string> = group!.links.map((link: NavLink): string => {
      return link.url;
    });
    const at: number = urls.indexOf(`/docs/${SECURITY_CONNECTED_SIGNALS}`);

    expect(urls[at - 1]).toBe("/docs/telemetry/security-entity-risk");
    expect(group!.links[at]!.title).toBe(CONNECTED_SIGNALS_TITLE);
  });

  it("says where it is drawn, as the product names each place", () => {
    const where: string = flat(section("Where you see it"));
    const investigation: SecurityCaseMenuSection | undefined =
      SECURITY_CASE_MENU.find((menu: SecurityCaseMenuSection): boolean => {
        return menu.title === "Investigation";
      });
    const titles: Array<string> = (investigation?.items || []).map(
      (item: SecurityCaseMenuItem): string => {
        return item.title;
      },
    );

    // A case's page, after Entities in its menu.
    expect(titles[titles.indexOf(CONNECTED_SIGNALS_TITLE) - 1]).toBe(
      "Entities",
    );
    expect(where).toContain(
      `then ${bold(CONNECTED_SIGNALS_TITLE)} after ${bold("Entities")} in its menu.`,
    );
    expect(where).toContain(
      `${bold(CONNECTED_TAB_LABEL)}, a tab of every security event`,
    );
    expect(where).toContain(
      `A ${bold(RESOURCE_SECURITY_TITLE)} card on an incident's page, when a security case declared the incident (${bold(INCIDENT_SECURITY_DECLARED_BY)}) or open cases name a host or cluster it affects (${bold(INCIDENT_SECURITY_NAMING)}).`,
    );
    expect(where).toContain(
      `${bold(RESOURCE_SECURITY_OPEN_IN_SECURITY)} opens it there.`,
    );
  });

  it("names every kind of record a Security card is drawn on, and no other", () => {
    const nouns: Array<string> = SECURITY_CONNECTION_KINDS.map(
      (kind: SecurityConnectionKind): string => {
        return KIND_NOUNS[kind];
      },
    );

    expect(flat(section("Where you see it"))).toContain(
      `on the page of each ${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}:`,
    );
  });

  it("says how sure each kind of match is, as the matching rules decide it", () => {
    const rows: Array<Array<string>> = rowsOf("How a value is matched");
    const sureness: Array<string> = rows.map((row: Array<string>): string => {
      return row[2] as string;
    });

    expect(sureness).toEqual([
      // A host's own name, typed as a host.
      matchHostName({
        entityValue: "web-1",
        entityType: SecurityEntityType.Host,
        resourceName: "web-1",
      })!.certainty,
      // The same name, untyped.
      matchHostName({
        entityValue: "web-1",
        entityType: SecurityEntityType.Other,
        resourceName: "web-1",
      })!.certainty,
      // A short or full form of it.
      matchHostName({
        entityValue: "web-1",
        entityType: SecurityEntityType.Host,
        resourceName: "web-1.acme.internal",
      })!.certainty,
      // A public address only one record holds.
      matchAddress({ address: "203.0.113.9", holderCount: 1 })!.certainty,
      // A private one, or one held by more than one record.
      matchAddress({ address: "10.0.0.9", holderCount: 1 })!.certainty,
      // A member's email.
      matchEmail({
        entityValue: "kim@acme.example",
        email: "kim@acme.example",
      })!.certainty,
      // The record a log line was sent under.
      SecurityConnectionCertainty.Exact,
      "-",
    ]);
    expect(
      matchAddress({ address: "203.0.113.9", holderCount: 2 })!.certainty,
    ).toBe(SecurityConnectionCertainty.Possible);

    // What is never looked up at all.
    expect(
      getSecurityConnectionLookups([
        { type: SecurityEntityType.User, value: "kmorgan" },
        { type: SecurityEntityType.Url, value: "https://evil.example/x" },
        {
          type: SecurityEntityType.FileHash,
          value: "44d88612fea8a8f36de82e1278abb02f",
        },
        { type: SecurityEntityType.Process, value: "powershell.exe" },
      ]).lookedUp,
    ).toEqual([]);
    expect(rows[rows.length - 1]![0]).toBe(
      "A bare user name, a URL, a file hash or a process",
    );
  });

  it("names the pill, the list of what was not found and how many records a case lists", () => {
    const matched: string = flat(section("How a value is matched"));

    expect(matched).toContain(
      `A possible match shows ${bold(CONNECTED_POSSIBLE_PILL)} beside its name`,
    );
    expect(matched).toContain(
      `listed under ${bold(CONNECTED_NOT_FOUND_TITLE)}.`,
    );
    expect(matched).toContain(
      `At most ${SECURITY_CONNECTION_MAX_RESOURCES} records are listed for a case, the exact ones first.`,
    );
  });

  it("lists a record's signals as its line draws them, in their order", () => {
    const labels: Array<string> = Object.values(SIGNAL_LINK_LABELS);
    const shows: string = flat(section("What each record shows"));
    const positions: Array<number> = labels.map((label: string): number => {
      return shows.indexOf(bold(label));
    });

    for (const [index, position] of positions.entries()) {
      expect({ label: labels[index], found: position >= 0 }).toEqual({
        label: labels[index],
        found: true,
      });
    }

    expect(
      [...positions].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(positions);
  });

  it("gives each window as the windows are worked out", () => {
    const rows: Array<Array<string>> = rowsOf("What each record shows");
    const padding: number = SECURITY_CONNECTION_EVENT_PADDING_IN_MINUTES;
    const now: Date = new Date("2026-10-25T12:00:00.000Z");

    expect(rows).toEqual([
      [
        "A case",
        `From ${padding} minutes before its first detection to ${padding} minutes after its last, at most its last ${SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS} hours`,
      ],
      ["An event", `${padding} minutes either side of it`],
      [
        "An entity's page",
        `${padding} minutes either side of its last security event`,
      ],
      [
        `A record's ${bold(RESOURCE_SECURITY_TITLE)} card`,
        `The last ${RESOURCE_SECURITY_WINDOW_IN_DAYS} days`,
      ],
    ]);

    // A case of two days: its last day, ending half an hour after its last detection.
    const window: { start: Date; end: Date } = getCaseConnectionWindow({
      firstDetectedAt: new Date("2026-10-23T08:00:00.000Z"),
      lastDetectedAt: new Date("2026-10-25T10:00:00.000Z"),
      now,
    });

    expect(window.end.toISOString()).toBe("2026-10-25T10:30:00.000Z");
    expect(window.end.getTime() - window.start.getTime()).toBe(
      SECURITY_CONNECTION_MAX_WINDOW_IN_HOURS * 60 * 60 * 1000,
    );
    expect(
      getEventConnectionWindow(
        new Date("2026-10-25T10:00:00.000Z"),
        now,
      ).start.toISOString(),
    ).toBe("2026-10-25T09:30:00.000Z");
  });

  it("names the roles that may read security events, and the button that reads again", () => {
    const roles: Array<string> = new SecurityEvent()
      .getReadPermissions()
      .filter((permission: Permission): boolean => {
        return Boolean(ROLE_NAMES[permission]);
      })
      .map((permission: Permission): string => {
        return ROLE_NAMES[permission] as string;
      });
    const sees: string = flat(section("Who sees what"));

    // Every role but the custom permission, which "a role that can read" covers.
    expect(roles.length).toBe(
      new SecurityEvent().getReadPermissions().length - 1,
    );
    expect(sees).toContain(
      `take a role that can read security events: Security Admin, Security Member, Security Viewer, Project Owner or Project Admin.`,
    );

    for (const role of roles) {
      expect(sees).toContain(role);
    }

    // An incident's card reads cases: whoever may read security cases.
    expect(
      new SecurityCase()
        .getReadPermissions()
        .includes(Permission.ReadSecurityCase),
    ).toBe(true);
    expect(sees).toContain(`with ${bold(CONNECTED_TRY_AGAIN)}.`);
    expect(sees).toContain(
      `received a security event in the last ${RESOURCE_SECURITY_WINDOW_IN_DAYS} days.`,
    );
  });

  it("names the kinds of record a declared incident is linked to", () => {
    const linked: Array<SecurityConnectionKind> = Object.keys(
      RECORD_RELATION_COLUMNS,
    ) as Array<SecurityConnectionKind>;

    expect(linked).toEqual([
      SecurityConnectionKind.Host,
      SecurityConnectionKind.DockerHost,
      SecurityConnectionKind.PodmanHost,
      SecurityConnectionKind.KubernetesCluster,
      SecurityConnectionKind.Service,
    ]);
    expect(flat(section("Incidents a case declares"))).toContain(
      "links the incident to the hosts, Docker and Podman hosts, Kubernetes clusters and services the case is exactly connected to.",
    );
  });
});
