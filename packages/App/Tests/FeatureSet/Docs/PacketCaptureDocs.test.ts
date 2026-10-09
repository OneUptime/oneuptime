import {
  getActiveCaptureLimitMessage,
  PICKUP_TIMEOUT_MESSAGE,
} from "Common/Server/Services/PacketCaptureService";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import PacketCaptureFilterUtil from "Common/Types/PacketCapture/PacketCaptureFilter";
import {
  DEFAULT_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS,
  PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_DEFAULT_MAX_PACKETS,
  PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
  PACKET_CAPTURE_MAX_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MAX_FILTER_LENGTH,
  PACKET_CAPTURE_MAX_PACKETS,
  PACKET_CAPTURE_MIN_DURATION_IN_SECONDS,
  PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB,
  PACKET_CAPTURE_MIN_PACKETS,
  PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_RETENTION_IN_DAYS,
  PacketCaptureLimitsUtil,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  describeLimits,
  PacketCaptureReadiness,
  PacketCaptureReadinessCopy,
} from "../../../FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Packet Capture docs page, in every language, says what the product
 * does - so each fact on it is held to the code that does it:
 *
 *   - what whoever runs the probe sets: the switch the probe reads, host
 *     networking and NET_RAW (never NET_ADMIN), for Docker, Docker Compose
 *     and Kubernetes, and the line the probe logs when captures are on;
 *   - the limits, the filters the form builds and the characters a filter
 *     may use, the permissions and who holds them, the retention;
 *   - the messages a person searches for: the probe's and the server's are
 *     quoted in English in every language (that is how they appear), the
 *     dashboard's in the reader's language, as the dashboard shows them;
 *   - every dashboard label the steps name is the one the dashboard shows
 *     in that language, and the limits summary is the sentence it shows.
 */

const DOCS_ROOT: string = path.join(__dirname, "../../../FeatureSet/Docs");
const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);
const PROBE_ROOT: string = path.join(__dirname, "../../../../Probe");

const TRANSLATED_LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const LANGUAGES: Array<string> = ["en", ...TRANSLATED_LANGUAGES];

// Spaces Intl writes into numbers (no-break and narrow no-break), as plain ones.
const NUMBER_SPACES: RegExp = /[\u00a0\u202f]/g;
const DETAILS_TITLE: RegExp = /^:::details (.+)$/gm;
const QUOTES: RegExp = /^["'«»„“”「」]+|["'«»„“”「」]+$/g;
const FILTER_ROW: RegExp =
  /^\| (`[^`]*`)? ?\| (`[^`]*`)? ?\| ([^|]+) \| `([^`]+)` \|$/gm;
const BACKTICKED: RegExp = /`([^`]*)`/;

function readPage(language: string): string {
  return fs.readFileSync(
    path.join(DOCS_ROOT, "Content", language, "probe", "packet-capture.md"),
    "utf8",
  );
}

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  if (language === "en") {
    return createTranslator(undefined, "en");
  }

  const locale: Record<string, string> = readLocale(language);

  return createTranslator((key: string): string | undefined => {
    return locale[key];
  }, language);
}

function plainSpaces(text: string): string {
  return text.replace(NUMBER_SPACES, " ");
}

// The text of each ":::details" title, without the quotes around it.
function detailsTitles(page: string): Array<string> {
  const titles: Array<string> = [];

  for (const match of page.matchAll(DETAILS_TITLE)) {
    // French sets its guillemets off with spaces: « like this ».
    titles.push((match[1] || "").trim().replace(QUOTES, "").trim());
  }

  return titles;
}

function permissionTitle(permission: Permission): string {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (item: PermissionProps): boolean => {
        return item.permission === permission;
      },
    );

  expect(props).toBeDefined();

  return props!.title;
}

describe("the page and where it is listed", () => {
  test.each(LANGUAGES)("there is a %s page", (language: string) => {
    expect(readPage(language).length).toBeGreaterThan(1000);
  });

  test("it is in the nav under Probe, after Incoming Request Ingress", () => {
    const nav: string = fs.readFileSync(
      path.join(DOCS_ROOT, "Utils", "Nav.ts"),
      "utf8",
    );
    const probe: number = nav.indexOf('title: "Probe",');
    const ingress: number = nav.indexOf(
      'url: "/docs/probe/incoming-request-ingress"',
    );
    const capture: number = nav.indexOf('url: "/docs/probe/packet-capture"');

    expect(probe).toBeGreaterThan(-1);
    expect(ingress).toBeGreaterThan(probe);
    expect(capture).toBeGreaterThan(ingress);
    expect(nav).toContain('title: "Packet Capture",');
  });

  test.each(LANGUAGES)("the %s nav names it", (language: string) => {
    const locale: { navLinks?: Record<string, string> } = JSON.parse(
      fs.readFileSync(
        path.join(DOCS_ROOT, "Locales", `${language}.json`),
        "utf8",
      ),
    ) as { navLinks?: Record<string, string> };

    expect(locale.navLinks?.["Packet Capture"]?.length).toBeGreaterThan(0);
  });

  test("the custom probe page lists the probe's packet capture settings, and links here", () => {
    const customProbe: string = fs.readFileSync(
      path.join(DOCS_ROOT, "Content", "en", "probe", "custom-probe.md"),
      "utf8",
    );

    expect(customProbe).toContain("`PROBE_PACKET_CAPTURE_ENABLED`");
    expect(customProbe).toContain(
      "`PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS`",
    );
    expect(customProbe).toContain("`PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB`");
    expect(customProbe).toContain("(/docs/probe/packet-capture)");
  });
});

describe("turning captures on, as the probe reads it", () => {
  const settings: string = fs.readFileSync(
    path.join(PROBE_ROOT, "Utils", "PacketCapture", "PacketCaptureSettings.ts"),
    "utf8",
  );

  test("the variables the page names are the ones the probe reads", () => {
    for (const name of [
      "PROBE_PACKET_CAPTURE_ENABLED",
      "PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS",
      "PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB",
    ]) {
      expect(settings).toContain(`"${name}"`);

      for (const language of LANGUAGES) {
        expect({
          language: language,
          has: readPage(language).includes(name),
        }).toEqual({ language: language, has: true });
      }
    }
  });

  test.each(LANGUAGES)(
    "the %s page shows host networking and NET_RAW for Docker, Compose and Kubernetes, and never NET_ADMIN",
    (language: string) => {
      const page: string = readPage(language);

      expect(page).toContain("--network host");
      expect(page).toContain("--cap-add NET_RAW");
      expect(page).toContain("-e PROBE_PACKET_CAPTURE_ENABLED=true");
      expect(page).toContain("network_mode: host");
      expect(page).toContain("cap_add:\n      - NET_RAW");
      expect(page).toContain("- PROBE_PACKET_CAPTURE_ENABLED=true");
      expect(page).toContain("hostNetwork: true");
      expect(page).toContain('add: ["NET_RAW"]');
      expect(page).toContain(
        '- name: PROBE_PACKET_CAPTURE_ENABLED\n              value: "true"',
      );
      expect(page).not.toContain("NET_ADMIN");
    },
  );

  test.each(LANGUAGES)(
    "the %s page quotes the line the probe logs when captures are on",
    (language: string) => {
      const line: string = `Packet capture is on: captures of up to ${PacketCaptureLimitsUtil.describeDuration(PACKET_CAPTURE_MAX_DURATION_IN_SECONDS)} and ${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB} MB can be started on this probe from the dashboard.`;

      expect(readPage(language)).toContain(`\`${line}\``);
    },
  );

  test("the probe's own maximums can only lower the hard ones, as the page says", () => {
    const page: string = readPage("en");

    expect(page).toContain(
      `| \`PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS\` | \`${PACKET_CAPTURE_MAX_DURATION_IN_SECONDS}\` | The longest capture this probe runs, from ${PACKET_CAPTURE_MIN_DURATION_IN_SECONDS} to ${PACKET_CAPTURE_MAX_DURATION_IN_SECONDS} seconds. |`,
    );
    expect(page).toContain(
      `| \`PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB\` | \`${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB}\` | The largest capture file this probe makes, from ${PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB} to ${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB} MB. |`,
    );
  });
});

describe("the limits, filters and permissions, as the product holds them", () => {
  const page: string = readPage("en");

  test("the limits table is the limits", () => {
    const count: (value: number) => string = (value: number): string => {
      return value.toLocaleString("en-US");
    };

    expect(page).toContain(
      `| Duration | ${PacketCaptureLimitsUtil.describeDuration(PACKET_CAPTURE_DEFAULT_DURATION_IN_SECONDS)} | ${PacketCaptureLimitsUtil.describeDuration(PACKET_CAPTURE_MIN_DURATION_IN_SECONDS)} to ${PacketCaptureLimitsUtil.describeDuration(PACKET_CAPTURE_MAX_DURATION_IN_SECONDS)} |`,
    );
    expect(page).toContain(
      `| Packet limit | ${count(PACKET_CAPTURE_DEFAULT_MAX_PACKETS)} | ${count(PACKET_CAPTURE_MIN_PACKETS)} to ${count(PACKET_CAPTURE_MAX_PACKETS)} |`,
    );
    expect(page).toContain(
      `| File size limit | ${PACKET_CAPTURE_DEFAULT_FILE_SIZE_IN_MB} MB | ${PACKET_CAPTURE_MIN_FILE_SIZE_IN_MB} to ${PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB} MB |`,
    );
  });

  test("how many captures a probe runs, when one is given up on, and when files go", () => {
    expect(page).toContain(
      `A probe runs at most ${PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE} captures at once.`,
    );
    expect(page).toContain(
      `A capture the probe doesn't pick up within ${PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES} minutes fails, and says so.`,
    );
    expect(page).toContain(
      `Captures and their files are deleted ${PACKET_CAPTURE_RETENTION_IN_DAYS} days after they start.`,
    );
  });

  test("each row of the filters table is what the form builds", () => {
    const rows: Array<RegExpMatchArray> = Array.from(page.matchAll(FILTER_ROW));

    expect(rows.length).toBe(5);

    for (const row of rows) {
      const host: string = (row[1] || "").replace(/`/g, "");
      const port: string = (row[2] || "").replace(/`/g, "");
      const protocolLabel: string = (row[3] || "").trim();

      expect(
        PacketCaptureFilterUtil.buildFromSimple({
          host: host,
          port: port,
          protocol: protocolLabel === "Any protocol" ? "Any" : protocolLabel,
        }),
      ).toEqual({ expression: row[4], error: null });
    }
  });

  test("a filter is held to the length and the characters the page lists", () => {
    expect(page).toContain(
      `A filter you write yourself is one line of at most ${PACKET_CAPTURE_MAX_FILTER_LENGTH} characters`,
    );

    const sentence: string = page.substring(
      page.indexOf("made of letters, numbers, spaces and"),
    );
    const listed: string = BACKTICKED.exec(sentence)![1]!;

    // What the page lists is exactly what the server's refusal lists.
    expect(PacketCaptureFilterUtil.validate("host a;b")).toContain(
      `letters, numbers, spaces and ${listed}`,
    );

    for (const character of listed.split(" ")) {
      expect(
        PacketCaptureFilterUtil.validate(`tcp[13]${character}2`) || "",
      ).not.toContain("can't contain");
    }
  });

  test("the permissions table names the permissions and who holds them by default", () => {
    const model: PacketCapture = new PacketCapture();
    const holders: (permissions: Array<Permission>) => string = (
      permissions: Array<Permission>,
    ): string => {
      return permissions
        .filter((permission: Permission): boolean => {
          return [
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.ProjectMember,
            Permission.Viewer,
          ].includes(permission);
        })
        .map(permissionTitle)
        .join(", ");
    };

    expect(page).toContain(
      `| **${permissionTitle(Permission.CreatePacketCapture)}** | Start captures, and stop them | ${holders(model.createRecordPermissions)} |`,
    );
    expect(page).toContain(
      `| **${permissionTitle(Permission.DeletePacketCapture)}** | Delete captures and their files | ${holders(model.deleteRecordPermissions)} |`,
    );
    expect(page).toContain(
      `| **${permissionTitle(Permission.ReadPacketCapture)}** | See captures: when they ran, on which probe and with which filter | ${holders(model.readRecordPermissions)} |`,
    );
    expect(page).toContain(
      `| **${permissionTitle(Permission.DownloadPacketCapture)}** | Download capture files | Project Owner, Project Admin |`,
    );
  });

  test.each(LANGUAGES)(
    "the %s page names the four permissions as the dashboard does, in English",
    (language: string) => {
      const translated: string = readPage(language);

      for (const permission of [
        Permission.CreatePacketCapture,
        Permission.DownloadPacketCapture,
        Permission.DeletePacketCapture,
        Permission.ReadPacketCapture,
      ]) {
        expect(translated).toContain(`**${permissionTitle(permission)}**`);
      }
    },
  );
});

describe("the messages a person searches the page for", () => {
  // The probe's and the server's messages: English, in every language.
  const ENGLISH_MESSAGES: Array<string> = [
    "The probe is not allowed to capture packets on eth0",
    "The interface does not exist on the probe",
    "tcpdump could not use the filter",
    `The probe did not pick up this capture within ${PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES} minutes`,
    `This probe is already running ${PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE} packet captures`,
  ];

  test("the server's messages are quoted as the server says them", () => {
    expect(PICKUP_TIMEOUT_MESSAGE.startsWith(`${ENGLISH_MESSAGES[3]}.`)).toBe(
      true,
    );
    expect(
      getActiveCaptureLimitMessage(
        PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
      ).startsWith(`${ENGLISH_MESSAGES[4]}.`),
    ).toBe(true);
  });

  test("the probe's messages are quoted as the probe says them", () => {
    const runner: string = fs.readFileSync(
      path.join(PROBE_ROOT, "Utils", "PacketCapture", "PacketCaptureRunner.ts"),
      "utf8",
    );

    expect(runner).toContain(
      "The probe is not allowed to capture packets on ${data.interfaceName}.",
    );
    expect(runner).toContain(
      'The interface "${data.interfaceName}" does not exist on the probe.',
    );
    expect(runner).toContain("tcpdump could not use the filter.");
  });

  test.each(LANGUAGES)(
    "the %s page answers each message, the dashboard's in its own language",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const titles: Array<string> = detailsTitles(readPage(language));

      expect(titles).toEqual([
        translator.translateText(
          PacketCaptureReadinessCopy[PacketCaptureReadiness.TurnedOff].title,
        ),
        ENGLISH_MESSAGES[0],
        ENGLISH_MESSAGES[1],
        ENGLISH_MESSAGES[2],
        ENGLISH_MESSAGES[3],
        translator.translateText("No packets matched the filter."),
        ENGLISH_MESSAGES[4],
      ]);
    },
  );
});

describe("the dashboard, as each language's page names it", () => {
  // The labels the steps walk through, as the dashboard shows them.
  const LABELS: Array<string> = [
    "Start Packet Capture",
    "Start Capture",
    "Packet Captures",
    "All interfaces (any)",
    "Host or network",
    "Port",
    "Protocol",
    "Write a BPF filter instead",
    "More fields",
    "Duration",
    "Packet limit",
    "File size limit (MB)",
    "Pending",
    "Running",
    "Stop",
    "Completed",
    "Download",
    "Connection Status",
    "Permissions",
  ];

  test.each(LANGUAGES)(
    "the %s page names each label as the dashboard shows it",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const page: string = readPage(language);
      const missing: Array<string> = LABELS.filter((label: string): boolean => {
        return !page.includes(`**${translator.translateText(label)}**`);
      }).map((label: string): string => {
        return `${label} -> ${translator.translateText(label)}`;
      });

      expect(missing).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "the %s page quotes the limits summary the form shows",
    (language: string) => {
      const summary: string = describeLimits(
        DEFAULT_PACKET_CAPTURE_LIMITS,
        translatorFor(language),
      );

      expect(plainSpaces(readPage(language))).toContain(
        `\`${plainSpaces(summary)}\``,
      );
    },
  );
});
