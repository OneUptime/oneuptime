import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  BACKUPS_ADMIN_PATH_KEYS,
  BACKUPS_NAV_GROUP,
  BACKUPS_NAV_TITLE,
  BACKUPS_PAGE,
} from "./BackupsDocsPage";
import { drawnAdminPath } from "./DocsAdminDashboard";
import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import { PACKAGES_DIR, readCommonSource } from "./DocsDashboardMenus";
import { boldLabels, tables } from "./DocsPageShape";
import { boldSpans, escapeRegExp } from "./DocsTranslationChecks";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import slugify from "Common/Server/Types/MarkdownSlugify";
import BackupRun from "Common/Models/DatabaseModels/BackupRun";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BACKUP_DEFAULT_FOLDER,
  BACKUP_DEFAULT_S3_REGION,
  BACKUP_DOCS_PATH,
  BackupDestinationCatalog,
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
  inferS3RegionFromEndpoint,
} from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BACKUP_CLICKHOUSE_FOLDER_NAME,
  BACKUP_MANIFEST_FILE_NAME,
  BACKUP_POSTGRES_FILE_NAME,
  getBackupName,
  isBackupName,
} from "Common/Types/Backup/BackupManifest";
import { selectBackupsToDelete } from "Common/Types/Backup/BackupRetention";
import {
  BACKUP_STEP_KEYS,
  BackupRunKind,
  BackupRunStatus,
  BackupStepKey,
  RESTORE_STEP_KEYS,
} from "Common/Types/Backup/BackupRunTypes";
import {
  AllBackupFrequencies,
  BackupFrequency,
  DEFAULT_BACKUP_RETENTION_IN_DAYS,
  DEFAULT_BACKUP_TIME_OF_DAY,
  MAX_BACKUP_RETENTION_IN_DAYS,
  MIN_BACKUP_RETENTION_IN_DAYS,
  getNextBackupAt,
} from "Common/Types/Backup/BackupSchedule";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE BACKUPS PAGE SAYS WHAT THE BACKUPS DO.
 *
 * docs/installation/backups tells a self-hosted installation's master
 * admins how to back OneUptime up to their own storage and restore it.
 * Markdown is not compiled, so these hold the English page to the product,
 * and BackupsDocsTranslations holds every language to the English page,
 * line by line:
 *
 *   - where it is: the nav, the address every Setup guide link opens, and
 *     the Admin Dashboard path the page names (drawnAdminPath);
 *   - the destinations: the recommended ones in the form's order, each
 *     one's storage, its own section under the anchor its Setup guide opens,
 *     every field by the catalog's own title, the folded ones under More
 *     fields, the examples and defaults the form starts with, the region
 *     read from an endpoint, and the key policy's actions and folder;
 *   - the schedule and retention: the frequencies, the example of every 6
 *     hours from 02:00 (getNextBackupAt), the days a backup is kept, and the
 *     rule that the newest backup that succeeded is never deleted
 *     (selectBackupsToDelete);
 *   - what a backup leaves at the destination: its folder's name and files
 *     (getBackupName and the manifest's file names);
 *   - who may set it up: master admins only, as the models and the service
 *     allow;
 *   - and the Enterprise half: the Backups page's buttons, states and step
 *     names (BackupsCopy), the word a restore is confirmed with, the failure
 *     email's interval, the PostgreSQL tools and their environment variable,
 *     and the license gates - testing and new backups need a license,
 *     restoring and deleting never do.
 *
 * The runner, its API and its screens are the Enterprise Edition's (ee/),
 * read as text as the other docs facts read ee/. That half runs where ee/
 * is checked out, which is the Enterprise Edition Test workflow
 * (.github/workflows/test.ee.yaml): the App Test job deletes ee/.
 */

const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPO_DIR, "ee");

const describeWhenEnterprisePresent: typeof describe.skip = fs.existsSync(
  EE_DIR,
)
  ? describe
  : describe.skip;

const HOW_A_BACKUP_WORKS_HEADING: string = "## How a backup works";
const BEFORE_YOU_BEGIN_HEADING: string = "## Before you begin";
const SET_UP_HEADING: string = "## Set up backups";
const DESTINATIONS_HEADING: string = "## Destinations";
const SCHEDULE_HEADING: string = "## Schedule and retention";
const RESTORE_HEADING: string = "## Restore a backup";
const WHEN_FAILS_HEADING: string = "## When a backup fails";
const TROUBLESHOOTING_HEADING: string = "## Troubleshooting";

const LINKED_TITLE: RegExp = /^\[([^\]]+)\]\(#([^)]+)\)$/;
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
// One entry of a Record<Enum, string> copy constant: [Enum.Member]: translationKey("...").
const ENUM_COPY_ENTRY: RegExp =
  /\[\w+\.(\w+)\]: translationKey\(\s*"([^"]+)",?\s*\)/g;
// A PostgreSQL client package the image installs: postgresql17-client.
const POSTGRES_CLIENT_PACKAGE: RegExp = /postgresql(\d+)-client/g;
const FAILURE_INTERVAL: RegExp =
  /BACKUP_FAILURE_NOTIFICATION_INTERVAL_IN_HOURS: number = (\d+);/;
const ARN_PREFIX: string = "arn:aws:s3:::";
const EXAMPLE_BUCKET: string = "my-backups";

/*
 * The fields a destination's own section names, by the catalog's titles:
 * a section may write "an access key" in place of naming its two fields,
 * as Wasabi's, MinIO's and Other S3-compatible storage's do.
 */
const FIELDS_NAMED_IN_SECTION: Record<BackupProvider, Array<string>> = {
  [BackupProvider.AmazonS3]: [
    "Bucket",
    "Region",
    "Access key ID",
    "Secret access key",
    "Folder",
  ],
  [BackupProvider.CloudflareR2]: [
    "Endpoint",
    "Bucket",
    "Access key ID",
    "Secret access key",
  ],
  [BackupProvider.BackblazeB2]: [
    "Endpoint",
    "Bucket",
    "Access key ID",
    "Secret access key",
  ],
  [BackupProvider.Wasabi]: ["Endpoint", "Bucket"],
  [BackupProvider.MinIO]: ["Endpoint", "Bucket"],
  [BackupProvider.GoogleCloudStorage]: [
    "Bucket",
    "HMAC access key",
    "HMAC secret",
  ],
  [BackupProvider.AzureBlobStorage]: [
    "Storage account",
    "Container",
    "Sign in with",
    "SAS token",
    "Access key",
    "Cloud",
    "Folder",
  ],
  [BackupProvider.OtherS3Compatible]: ["Endpoint", "Bucket", "Region"],
};

// The actions a backup's key needs, and nothing else (S3BackupStorage).
const S3_KEY_ACTIONS: Array<string> = [
  "s3:PutObject",
  "s3:GetObject",
  "s3:ListBucket",
  "s3:DeleteObject",
  "s3:AbortMultipartUpload",
];

function english(): string {
  return readPage("en", BACKUPS_PAGE);
}

function readEe(relative: string): string {
  return fs.readFileSync(path.join(EE_DIR, relative), "utf8");
}

function readApp(relative: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, "App", relative), "utf8");
}

/*
 * A section of the page: from its heading's line to the next heading of the
 * same level or higher.
 */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);
  const level: number = heading.indexOf(" ");

  if (start < 0) {
    throw new Error(`No section ${heading}`);
  }

  let inFence: boolean = false;
  let end: number = lines.length;

  for (let index: number = start + 1; index < lines.length; index++) {
    const line: string = lines[index] as string;

    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    const lineLevel: number =
      !inFence && line.startsWith("#") ? line.indexOf(" ") : -1;

    if (lineLevel > 0 && lineLevel <= level) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n");
}

function providerSection(provider: BackupProviderDefinition): string {
  return section(english(), `### ${provider.title}`);
}

function definitionOf(
  provider: BackupProviderDefinition,
): BackupDestinationDefinition {
  return getBackupDestinationDefinition(
    provider.type,
  ) as BackupDestinationDefinition;
}

function fieldsOf(
  definition: BackupDestinationDefinition,
): Array<BackupDestinationField> {
  return [...definition.configFields, ...definition.secretFields];
}

function fieldTitled(
  definition: BackupDestinationDefinition,
  title: string,
): BackupDestinationField | undefined {
  return fieldsOf(definition).find((field: BackupDestinationField): boolean => {
    return field.title === title;
  });
}

// A table's body rows: the rows under its header.
function bodyRows(markdown: string): Array<Array<string>> {
  return (tables(markdown)[0] || []).slice(1);
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function fences(markdown: string, lang: string): Array<DocsFence> {
  return scanMarkdown(markdown).fences.filter((fence: DocsFence): boolean => {
    return fence.lang === lang;
  });
}

function anchorOf(docsPath: string): string {
  return docsPath.slice(docsPath.indexOf("#") + 1);
}

// The words a translationKey("...") of a copy file holds, under its key.
function copyEntry(source: string, key: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `\\b${escapeRegExp(key)}: translationKey\\(\\s*"([^"]+)",?\\s*\\)`,
  ).exec(source);

  if (!match) {
    throw new Error(`No copy entry ${key}`);
  }

  return match[1] as string;
}

// The words of a Record<Enum, string> copy constant, in its order.
function enumCopy(source: string, constant: string): Array<[string, string]> {
  const start: number = source.indexOf(`export const ${constant}`);
  const end: number = source.indexOf("\n};", start);

  if (start < 0 || end < 0) {
    throw new Error(`No copy constant ${constant}`);
  }

  return Array.from(source.slice(start, end).matchAll(ENUM_COPY_ENTRY)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1] as string, match[2] as string];
    },
  );
}

const UTC_HOURS: (date: Date) => string = (date: Date): string => {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
};

describe("where the page is", () => {
  it("is the page every Setup guide link opens, listed in the Installation group as Backups", () => {
    expect(BACKUP_DOCS_PATH).toBe(`/docs/${BACKUPS_PAGE}`);

    const group: NavGroup = DocsNav.find((candidate: NavGroup): boolean => {
      return candidate.title === BACKUPS_NAV_GROUP;
    }) as NavGroup;
    const link: NavLink | undefined = group.links.find(
      (candidate: NavLink): boolean => {
        return candidate.url === BACKUP_DOCS_PATH;
      },
    );

    expect(link?.title).toBe(BACKUPS_NAV_TITLE);
    expect(english().split("\n")[0]).toBe(`# ${BACKUPS_NAV_TITLE}`);
  });

  it("names the Admin Dashboard page by its breadcrumb's words", () => {
    expect(section(english(), SET_UP_HEADING)).toContain(
      `In the Admin Dashboard, go to ${drawnAdminPath("en", BACKUPS_ADMIN_PATH_KEYS)} and click **Set up backups**.`,
    );
  });

  it("says backups are part of the Enterprise Edition, which licenses them by their own feature", () => {
    expect(EnterpriseFeature.Backups).toBe("backups");
    expect(english().split("\n## ")[0]).toContain(
      "Backups are part of the Enterprise Edition.",
    );
    expect(section(english(), BEFORE_YOU_BEGIN_HEADING)).toContain(
      "- **The Enterprise Edition**, with a license that includes backups.",
    );
  });
});

describe("the destinations", () => {
  it("lists the recommended destinations in the form's order, each with its storage and its section's anchor", () => {
    const rows: Array<Array<string>> = bodyRows(
      section(english(), DESTINATIONS_HEADING),
    );

    expect(rows).toHaveLength(BackupProviderCatalog.length);

    BackupProviderCatalog.forEach(
      (provider: BackupProviderDefinition, index: number): void => {
        const row: Array<string> = rows[index] as Array<string>;
        const linked: RegExpExecArray | null = LINKED_TITLE.exec(
          row[0] as string,
        );

        expect({
          provider: provider.provider,
          title: linked?.[1],
          anchor: linked?.[2],
          storage: row[1],
        }).toEqual({
          provider: provider.provider,
          title: provider.title,
          anchor: anchorOf(provider.docsPath),
          storage: definitionOf(provider).title,
        });
      },
    );
  });

  it("gives every recommended destination a section under the anchor its Setup guide link opens", () => {
    for (const provider of BackupProviderCatalog) {
      expect(provider.docsPath.startsWith(`${BACKUP_DOCS_PATH}#`)).toBe(true);
      expect({
        provider: provider.provider,
        anchor: slugify(provider.title),
      }).toEqual({
        provider: provider.provider,
        anchor: anchorOf(provider.docsPath),
      });
      expect(providerSection(provider)).toContain(`### ${provider.title}`);
    }
  });

  it("names each destination's fields by the catalog's own titles, and only them", () => {
    for (const provider of BackupProviderCatalog) {
      const definition: BackupDestinationDefinition = definitionOf(provider);
      const named: Array<string> = boldLabels(providerSection(provider)).filter(
        (label: string): boolean => {
          return label !== MORE_FIELDS_SECTION_TITLE;
        },
      );

      expect({
        provider: provider.provider,
        named: Array.from(new Set(named)),
      }).toEqual({
        provider: provider.provider,
        named: FIELDS_NAMED_IN_SECTION[provider.provider],
      });

      for (const title of named) {
        expect({
          provider: provider.provider,
          title,
          isField: Boolean(fieldTitled(definition, title)),
        }).toEqual({ provider: provider.provider, title, isField: true });
      }
    }
  });

  it("names every field of every storage somewhere in Destinations", () => {
    const named: Set<string> = new Set(
      boldLabels(section(english(), DESTINATIONS_HEADING)),
    );

    for (const definition of BackupDestinationCatalog) {
      for (const field of fieldsOf(definition)) {
        expect({
          type: definition.type,
          field: field.title,
          named: named.has(field.title),
        }).toEqual({ type: definition.type, field: field.title, named: true });
      }
    }
  });

  it("says a folded field waits under More fields, wherever it names one", () => {
    for (const provider of BackupProviderCatalog) {
      const definition: BackupDestinationDefinition = definitionOf(provider);

      for (const line of providerSection(provider).split("\n")) {
        const advanced: Array<string> = boldSpans(line).filter(
          (title: string): boolean => {
            return fieldTitled(definition, title)?.isAdvanced === true;
          },
        );

        if (advanced.length > 0) {
          expect({ provider: provider.provider, line }).toEqual({
            provider: provider.provider,
            line: expect.stringContaining(`**${MORE_FIELDS_SECTION_TITLE}**`),
          });
        }
      }
    }
  });

  it("gives the folder, the Amazon S3 region and each endpoint the form starts with", () => {
    const amazon: BackupDestinationDefinition = getBackupDestinationDefinition(
      BackupProviderCatalog[0]!.type,
    ) as BackupDestinationDefinition;

    expect(fieldTitled(amazon, "Region")?.defaultValue).toBe(
      BACKUP_DEFAULT_S3_REGION,
    );
    expect(providerSection(BackupProviderCatalog[0]!)).toContain(
      `| **Region** | The bucket's region. It starts on \`${BACKUP_DEFAULT_S3_REGION}\`. |`,
    );
    expect(providerSection(BackupProviderCatalog[0]!)).toContain(
      `Left empty, backups go to \`${BACKUP_DEFAULT_FOLDER}\`.`,
    );
    expect(section(english(), HOW_A_BACKUP_WORKS_HEADING)).toContain(
      `(\`${BACKUP_DEFAULT_FOLDER}\` unless you choose another)`,
    );

    for (const provider of BackupProviderCatalog) {
      if (
        !provider.endpointPlaceholder ||
        provider.provider === BackupProvider.OtherS3Compatible
      ) {
        continue;
      }

      expect({
        provider: provider.provider,
        examples: codeSpans(providerSection(provider)),
      }).toEqual({
        provider: provider.provider,
        examples: expect.arrayContaining([provider.endpointPlaceholder]),
      });
    }
  });

  it("reads the region from the endpoint where the page says it does", () => {
    const byProvider: (provider: BackupProvider) => BackupProviderDefinition = (
      provider: BackupProvider,
    ): BackupProviderDefinition => {
      return BackupProviderCatalog.find(
        (candidate: BackupProviderDefinition): boolean => {
          return candidate.provider === provider;
        },
      ) as BackupProviderDefinition;
    };

    for (const provider of [
      BackupProvider.BackblazeB2,
      BackupProvider.Wasabi,
    ]) {
      const definition: BackupProviderDefinition = byProvider(provider);
      const endpoint: string = definition.endpointPlaceholder as string;

      expect(providerSection(definition)).toContain(
        "The region is read from the endpoint.",
      );
      // s3.<region>.backblazeb2.com, s3.<region>.wasabisys.com
      expect(inferS3RegionFromEndpoint(endpoint)).toBe(
        new URL(endpoint).hostname.split(".")[1],
      );
    }

    // Anything else signs for us-east-1, as the page says.
    expect(
      providerSection(byProvider(BackupProvider.OtherS3Compatible)),
    ).toContain(
      `Left empty, it is read from the endpoint, or is \`${BACKUP_DEFAULT_S3_REGION}\`.`,
    );
    expect(inferS3RegionFromEndpoint("https://s3.example.com")).toBe(
      BACKUP_DEFAULT_S3_REGION,
    );
  });

  it("asks for a key that may do what a backup does, on the backups' folder, and nothing else", () => {
    const destinations: string = section(english(), DESTINATIONS_HEADING);
    const policy: {
      Statement: Array<{ Action: string | Array<string>; Resource: string }>;
    } = JSON.parse((fences(destinations, "json")[0] as DocsFence).code) as {
      Statement: Array<{ Action: string | Array<string>; Resource: string }>;
    };
    const actions: Array<string> = policy.Statement.flatMap(
      (statement: { Action: string | Array<string> }): Array<string> => {
        return Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action];
      },
    );

    expect([...actions].sort()).toEqual([...S3_KEY_ACTIONS].sort());
    expect(
      policy.Statement.map((statement: { Resource: string }): string => {
        return statement.Resource;
      }),
    ).toEqual([
      `${ARN_PREFIX}${EXAMPLE_BUCKET}`,
      `${ARN_PREFIX}${EXAMPLE_BUCKET}/${BACKUP_DEFAULT_FOLDER}*`,
    ]);

    // The sentence before it names the same actions.
    const sentence: string = destinations
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("A key for Amazon S3");
      }) as string;

    expect([...codeSpans(sentence)].sort()).toEqual([...S3_KEY_ACTIONS].sort());
  });
});

describe("the schedule and retention", () => {
  const scheduleTable: () => Array<Array<string>> = (): Array<
    Array<string>
  > => {
    return bodyRows(section(english(), SCHEDULE_HEADING));
  };

  it("offers as many frequencies as the schedule has, every day the one most installations need", () => {
    const howOften: Array<string> = scheduleTable()[0] as Array<string>;

    expect(howOften[0]).toBe("**How often**");
    expect(boldSpans(howOften[1] as string)).toHaveLength(
      AllBackupFrequencies.length,
    );
    expect(howOften[1]).toContain("Every day suits most installations.");
  });

  it("runs every 6 hours from 02:00 at the hours the page lists, and every hour on the hour", () => {
    const at: Array<string> = scheduleTable()[1] as Array<string>;
    const runs: Array<string> = [];
    let after: Date = new Date(Date.UTC(2026, 9, 24, 1, 0, 0));

    for (let index: number = 0; index < 4; index++) {
      const next: Date = getNextBackupAt(
        {
          frequency: BackupFrequency.Every6Hours,
          timeOfDay: DEFAULT_BACKUP_TIME_OF_DAY,
          dayOfWeek: 0,
        },
        after,
      );
      runs.push(UTC_HOURS(next));
      after = next;
    }

    expect(DEFAULT_BACKUP_TIME_OF_DAY).toBe("02:00");
    expect(at[1]).toContain(
      `at \`${DEFAULT_BACKUP_TIME_OF_DAY}\`, backups every 6 hours run at ${runs.slice(0, 3).join(", ")} and ${runs[3]}.`,
    );

    const hourly: Date = getNextBackupAt(
      {
        frequency: BackupFrequency.EveryHour,
        timeOfDay: DEFAULT_BACKUP_TIME_OF_DAY,
        dayOfWeek: 0,
      },
      new Date(Date.UTC(2026, 9, 24, 5, 17, 0)),
    );

    expect(UTC_HOURS(hourly)).toBe("06:00");
    expect(at[1]).toContain("Backups every hour run on the hour.");
  });

  it("keeps backups for the days the schedule allows, 30 unless changed", () => {
    expect(scheduleTable()[3]).toEqual([
      "**Keep backups for (days)**",
      `From ${MIN_BACKUP_RETENTION_IN_DAYS} to ${MAX_BACKUP_RETENTION_IN_DAYS} days. ${DEFAULT_BACKUP_RETENTION_IN_DAYS} unless you change it.`,
    ]);
    expect(section(english(), SET_UP_HEADING)).toContain(
      `**Keep backups for (days)** is ${DEFAULT_BACKUP_RETENTION_IN_DAYS} unless you change it.`,
    );
  });

  it("deletes the backups older than the retention but the newest that succeeded, as the retention does", () => {
    const now: Date = new Date(Date.UTC(2026, 9, 24, 3, 0, 0));
    const daysAgo: (days: number) => Date = (days: number): Date => {
      return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    };

    // Backups stopped 40 days ago: the newest that succeeded is old, and stays.
    const decision: ReturnType<typeof selectBackupsToDelete> =
      selectBackupsToDelete({
        backups: [
          {
            id: "old-failed",
            kind: BackupRunKind.Backup,
            status: BackupRunStatus.Failed,
            startedAt: daysAgo(41),
          },
          {
            id: "older-succeeded",
            kind: BackupRunKind.Backup,
            status: BackupRunStatus.Succeeded,
            startedAt: daysAgo(45),
          },
          {
            id: "newest-succeeded",
            kind: BackupRunKind.Backup,
            status: BackupRunStatus.Succeeded,
            startedAt: daysAgo(40),
          },
        ],
        retentionInDays: DEFAULT_BACKUP_RETENTION_IN_DAYS,
        now,
      });

    expect(decision).toEqual({
      deleteIds: ["older-succeeded", "old-failed"],
      keptNewestSucceededId: "newest-succeeded",
    });
    expect(section(english(), SCHEDULE_HEADING)).toContain(
      "After each backup, the backups that started more than **Keep backups for (days)** ago are deleted, at the destination and from the list, except the newest backup that succeeded, which is kept however old it is.",
    );
  });
});

describe("what a backup leaves at the destination", () => {
  it("is a folder named after its start in UTC, holding the files the manifest names", () => {
    const name: string = getBackupName({
      startedAt: new Date(Date.UTC(2026, 9, 24, 2, 0, 0)),
      id: "3f2a9c1b-0000-4000-8000-000000000001",
    });
    const sample: DocsFence = fences(
      section(english(), HOW_A_BACKUP_WORKS_HEADING),
      "text",
    )[0] as DocsFence;

    expect(isBackupName(name)).toBe(true);
    expect(sample.code.trim().split("\n")).toEqual([
      `${BACKUP_DEFAULT_FOLDER}${name}/${BACKUP_MANIFEST_FILE_NAME}`,
      `${BACKUP_DEFAULT_FOLDER}${name}/${BACKUP_POSTGRES_FILE_NAME}`,
      `${BACKUP_DEFAULT_FOLDER}${name}/${BACKUP_CLICKHOUSE_FOLDER_NAME}`,
    ]);
    expect(section(english(), HOW_A_BACKUP_WORKS_HEADING)).toContain(
      `\`${BACKUP_MANIFEST_FILE_NAME}\` is written last`,
    );
  });
});

describe("who may set backups up", () => {
  it("is a master admin: no project permission reaches either table, and the service says so", () => {
    for (const model of [new BackupSetting(), new BackupRun()]) {
      for (const permissions of [
        model.createRecordPermissions,
        model.readRecordPermissions,
        model.updateRecordPermissions,
        model.deleteRecordPermissions,
      ]) {
        expect(permissions).toEqual([]);
      }
    }

    const service: string = readCommonSource(
      "Server/Services/BackupSettingService.ts",
    );

    expect(service).toContain(
      '"Only a master admin can set up the instance\'s backups."',
    );
    expect(service).toContain("if (!props.isRoot && !props.isMasterAdmin) {");
    expect(section(english(), BEFORE_YOU_BEGIN_HEADING)).toContain(
      "- **A master admin.** Backups are set up in the Admin Dashboard.",
    );
  });
});

describe("the PostgreSQL tools the Enterprise image carries", () => {
  it("are the client tools the image installs, one set per PostgreSQL major", () => {
    const dockerfile: string = readApp("Dockerfile.tpl");
    const install: string = dockerfile
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("RUN apk add") && line.includes("-client");
      }) as string;
    const majors: Array<string> = Array.from(
      install.matchAll(POSTGRES_CLIENT_PACKAGE),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(majors.length).toBeGreaterThan(1);

    const listed: string = `${majors.slice(0, -1).join(", ")} and ${majors[majors.length - 1]}`;

    expect(section(english(), TROUBLESHOOTING_HEADING)).toContain(
      `The Enterprise image carries \`pg_dump\` and \`pg_restore\` ${listed}, which back up PostgreSQL ${majors[majors.length - 1]} and every version before it.`,
    );

    // In the Enterprise stage only: the Community image has no backups.
    const enterpriseStage: number = dockerfile.indexOf(
      "FROM enterprise-build AS enterprise",
    );
    const communityStage: number = dockerfile.indexOf(
      "FROM community-build AS community",
    );
    const at: number = dockerfile.indexOf(install);

    expect(enterpriseStage).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(enterpriseStage);
    expect(communityStage < 0 || communityStage > at).toBe(true);
  });
});

describeWhenEnterprisePresent(
  "the Enterprise half, where ee/ is checked out",
  () => {
    const copy: () => string = (): string => {
      return readEe("AdminDashboard/Backups/BackupsCopy.ts");
    };

    it("names the page's buttons, fields and states as the Backups page draws them", () => {
      const labels: Record<string, string> = {
        setUpButton: "Set up backups",
        setupGuide: "Setup guide",
        testButton: "Test the destination",
        frequencyField: "How often",
        timeField: "At (UTC)",
        dayField: "Day of the week",
        retentionField: "Keep backups for (days)",
        clickhouseField: "Back up ClickHouse too",
        createButton: "Start backing up",
        backUpNowButton: "Back up now",
        viewStepsButton: "View steps",
        turnOffAction: "Turn off scheduled backups",
        turnOnButton: "Turn on",
        backupsTitle: "Backups",
        restoreAction: "Restore",
        restoreButton: "Restore",
        restorePostgresTitle:
          "PostgreSQL: projects, monitors, incidents, users",
        restoreClickhouseTitle: "ClickHouse: logs, traces, metrics",
        restoreBackupFirstTitle: "Back up the current data first",
        findBackupsAction: "Find backups",
        statusFailing: "The last backup failed",
        previousDestinationNote: "At a previous destination",
      };
      const page: string = english();

      for (const [key, label] of Object.entries(labels)) {
        expect({
          key,
          drawn: copyEntry(copy(), key),
          named: page.includes(`**${label}**`),
        }).toEqual({ key, drawn: label, named: true });
      }

      // The side menu's entry and the breadcrumb, which the page's path names.
      expect(readEe("AdminDashboard/Backups/BackupsPaths.ts")).toContain(
        `BACKUPS_SETTINGS_PAGE_TITLE: string = translationKey("${BACKUPS_ADMIN_PATH_KEYS[1]}");`,
      );
    });

    it("finds backups and turns the schedule off from the status card's menu", () => {
      const card: string = readEe(
        "AdminDashboard/Backups/BackupStatusCard.tsx",
      );
      // The card's ⋯, the same button as every card header's.
      const start: number = card.indexOf("<CardMoreMenu");
      const end: number = card.indexOf("</CardMoreMenu>");

      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);

      const menu: string = card.slice(start, end);

      expect(menu).toContain("text={BackupsCopy.findBackupsAction}");
      expect(menu).toContain("text={BackupsCopy.turnOffAction}");
      expect(english()).toContain(
        "**Turn off scheduled backups**, in the status card's menu, stops the schedule.",
      );
      expect(english()).toContain(
        "**Find backups**, in the status card's menu, looks again.",
      );
    });

    it("draws a backup's steps in the diagram, and a restore's in its table, as the steps dialog names them", () => {
      const steps: Map<string, string> = new Map(
        enumCopy(copy(), "BACKUP_STEP_COPY"),
      );
      const stepName: (key: BackupStepKey) => string = (
        key: BackupStepKey,
      ): string => {
        const member: string = Object.entries(BackupStepKey).find(
          (entry: [string, string]): boolean => {
            return entry[1] === key;
          },
        )?.[0] as string;

        return steps.get(member) as string;
      };
      const diagram: string = (
        fences(
          section(english(), HOW_A_BACKUP_WORKS_HEADING),
          "mermaid",
        )[0] as DocsFence
      ).code;

      for (const key of BACKUP_STEP_KEYS) {
        expect({
          key,
          inDiagram: diagram.includes(`["${stepName(key)}"]`),
        }).toEqual({ key, inDiagram: true });
      }

      const restoreTable: Array<Array<string>> = (
        tables(section(english(), RESTORE_HEADING)).find(
          (table: Array<Array<string>>): boolean => {
            return table[0]?.[0] === "Step";
          },
        ) as Array<Array<string>>
      ).slice(1);

      expect(
        restoreTable.map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(
        RESTORE_STEP_KEYS.map((key: BackupStepKey): string => {
          return `**${stepName(key)}**`;
        }),
      );
    });

    it("lists the frequencies as the form offers them", () => {
      const frequencies: Array<string> = enumCopy(
        copy(),
        "BACKUP_FREQUENCY_COPY",
      ).map((entry: [string, string]): string => {
        return entry[1];
      });
      const howOften: Array<string> = bodyRows(
        section(english(), SCHEDULE_HEADING),
      )[0] as Array<string>;

      expect(frequencies).toHaveLength(AllBackupFrequencies.length);
      expect(boldSpans(howOften[1] as string)).toEqual(frequencies);
    });

    it("is confirmed with the word the dialog and the server both ask for", () => {
      for (const file of [
        "Server/Backup/API/BackupAPI.ts",
        "AdminDashboard/Backups/RestoreBackupModal.tsx",
      ]) {
        expect({
          file,
          word: stringConstantOf(readEe(file), "RESTORE_CONFIRMATION_WORD"),
        }).toEqual({ file, word: "restore" });
      }

      expect(section(english(), RESTORE_HEADING)).toContain(
        "Type `restore` and click **Restore**.",
      );
    });

    it("emails master admins about a failing backup as often as the notifications do", () => {
      const notifications: string = readEe(
        "Server/Backup/BackupNotifications.ts",
      );
      const hours: string = (
        FAILURE_INTERVAL.exec(notifications) as RegExpExecArray
      )[1] as string;

      expect(section(english(), WHEN_FAILS_HEADING)).toContain(
        `Every master admin also receives an email, at most once every ${hours} hours while backups keep failing.`,
      );
    });

    it("names the environment variable the PostgreSQL tools are looked for in", () => {
      expect(
        stringConstantOf(
          readEe("Server/Backup/Postgres/PostgresTools.ts"),
          "BACKUP_POSTGRES_BIN_DIR_ENV",
        ),
      ).toBe("BACKUP_POSTGRES_BIN_DIR");
      expect(section(english(), TROUBLESHOOTING_HEADING)).toContain(
        "or set `BACKUP_POSTGRES_BIN_DIR` to the directory that holds them.",
      );
    });

    it("needs a license to test a destination and make a backup, and never to restore, delete or find one", () => {
      const api: string = readEe("Server/Backup/API/BackupAPI.ts");
      const handler: (name: string) => string = (name: string): string => {
        const start: number = api.indexOf(`public static async ${name}(`);
        const next: number = api.indexOf("public static async ", start + 1);

        if (start < 0) {
          throw new Error(`No handler ${name}`);
        }

        return api.slice(start, next < 0 ? undefined : next);
      };
      const gated: (text: string) => boolean = (text: string): boolean => {
        return text.includes("EnterpriseFeature.Backups");
      };

      expect(gated(handler("test"))).toBe(true);
      expect(gated(handler("runNow"))).toBe(true);

      for (const name of ["restore", "cancel", "delete", "find"]) {
        expect({ name, gated: gated(handler(name)) }).toEqual({
          name,
          gated: false,
        });
      }

      expect(section(english(), BEFORE_YOU_BEGIN_HEADING)).toContain(
        "Without a license, no new backup is made, and restoring and deleting backups still work.",
      );
    });
  },
);

// A `name: string = "value"` constant of a source file.
function stringConstantOf(source: string, name: string): string {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(name)}: string = "([^"]+)"`,
  ).exec(source);

  if (!match) {
    throw new Error(`No string constant ${name}`);
  }

  return match[1] as string;
}
