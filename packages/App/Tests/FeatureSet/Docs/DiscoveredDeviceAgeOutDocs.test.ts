import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Project from "Common/Models/DatabaseModels/Project";
import {
  AGE_OUT_REPORTING_WINDOW_MS,
  buildAgeOutStatement,
} from "Common/Server/Utils/NetworkDevice/DiscoveredDeviceAgeOut";
import {
  DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
} from "Common/Types/NetworkDevice/DiscoveredDeviceRetention";
import Permission from "Common/Types/Permission";
import { MORE_SETTINGS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import DiscoveredDeviceRetentionCopy from "../../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceRetentionCopy";
import {
  NETWORK_DEVICE_PAGE,
  drawnNetworkLabel,
  drawnPath,
  sectionInLanguage,
} from "./NetworkDocsLabels";

/*
 * Issue #6389: the network device guide's Discovered devices section says
 * that devices nothing has seen for a while are removed, what always stays,
 * and where a Project Owner or Admin changes how long - in every docs
 * language. Markdown is not compiled, so these tests hold the guide to the
 * Dashboard's own labels (a translation to the labels its language's
 * Dashboard draws) and the English guide to what the code does: the default,
 * the choices, who may change them, how often the list is checked, and what
 * the removal keeps and takes with it.
 */

const SECTION_HEADING: string = "### Discovered devices";

// The guide's sentence that the list no longer keeps every device for good.
const RETIRED_ENGLISH: string = "Nothing leaves the list on its own";

const JOB_SOURCE: string = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/AgeOutDiscoveredDevices.ts",
  ),
  "utf8",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

// The paragraph on unseen devices: the one naming the setting's path.
function ageOutParagraph(language: string): string {
  const section: string = sectionInLanguage(
    language,
    NETWORK_DEVICE_PAGE,
    SECTION_HEADING,
  );
  const path: string = drawnPath(language, [
    MORE_SETTINGS_SECTION_TITLE,
    DiscoveredDeviceRetentionCopy.cardTitle,
    DiscoveredDeviceRetentionCopy.label,
  ]);
  const paragraphs: Array<string> = section
    .split("\n\n")
    .filter((paragraph: string): boolean => {
      return paragraph.includes(path);
    });

  expect({ language, paragraphs: paragraphs.length }).toEqual({
    language,
    paragraphs: 1,
  });

  return paragraphs[0] as string;
}

describe.each([...SUPPORTED_DOCS_LANGUAGE_CODES])(
  "the %s network device guide on devices no longer seen",
  (language: string) => {
    test("finds the setting where the Discovered Devices page keeps it, as that language's Dashboard draws it", () => {
      expect(ageOutParagraph(language)).toContain(
        drawnPath(language, [
          MORE_SETTINGS_SECTION_TITLE,
          DiscoveredDeviceRetentionCopy.cardTitle,
          DiscoveredDeviceRetentionCopy.label,
        ]),
      );
    });

    test("names Never as the pick draws it", () => {
      expect(ageOutParagraph(language)).toContain(
        `**${drawnNetworkLabel(language, DiscoveredDeviceRetentionCopy.never)}**`,
      );
    });

    test("gives every length the pick offers, and the default", () => {
      const paragraph: string = ageOutParagraph(language);

      for (const days of DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS) {
        expect({
          language,
          days,
          said: paragraph.includes(String(days)),
        }).toEqual({ language, days, said: true });
      }
    });

    test("closes the section, after what the rows and the map do", () => {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        SECTION_HEADING,
      ).trim();
      const paragraphs: Array<string> = section.split("\n\n");

      expect(paragraphs[paragraphs.length - 1]?.trim()).toBe(
        ageOutParagraph(language).trim(),
      );
    });

    test("still says Last Seen tells when a device was last there", () => {
      const section: string = sectionInLanguage(
        language,
        NETWORK_DEVICE_PAGE,
        SECTION_HEADING,
      );

      expect(section).toContain(
        `**${drawnNetworkLabel(language, "Last Seen")}**`,
      );
    });
  },
);

describe("the English guide says what the code does", () => {
  const section: string = squash(
    sectionInLanguage("en", NETWORK_DEVICE_PAGE, SECTION_HEADING),
  );
  const paragraph: string = squash(ageOutParagraph("en"));

  test("no longer says nothing leaves the list", () => {
    expect(section).not.toContain(RETIRED_ENGLISH);
    expect(section).toContain(
      "**Last Seen** says when a device was last there.",
    );
  });

  test("the default it names is the setting's", () => {
    expect(DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS).toBe(30);
    expect(paragraph).toContain(
      "A device not seen for 30 days is removed from the list and the map",
    );
  });

  test("the lengths it lists are the pick's, in its order", () => {
    const choices: Array<number> = [
      ...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
    ];
    const last: number = choices.pop() as number;

    expect(paragraph).toContain(
      `: ${choices.join(", ")} or ${last} days, or **${DiscoveredDeviceRetentionCopy.never}**.`,
    );
  });

  test("names who may change it: the column's own update permissions", () => {
    expect(
      new Project().getColumnAccessControlFor("discoveredDeviceRetentionInDays")
        ?.update,
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(paragraph).toContain("Project Owners and Project Admins change it");
  });

  test("says the list is checked every hour, as the job runs", () => {
    expect(squash(JOB_SOURCE)).toContain("schedule: EVERY_HOUR");
    expect(paragraph).toContain("The list is checked every hour");
  });

  test("says what always stays: monitored, classified, added or changed by someone", () => {
    const sql: string = squash(
      buildAgeOutStatement({
        projectId: "aa000000-0000-4000-8000-000000000001",
        seenBefore: new Date(),
        reportingDeviceIds: [],
        limit: 1,
        removedAt: new Date(),
      }).sql,
    );

    expect(sql).toContain("AND NOT EXISTS ( SELECT 1 FROM monitored m");
    expect(sql).toContain(`COALESCE(btrim(e."classification"), '') = ''`);
    expect(sql).toContain(`e."editedAt" IS NULL`);
    expect(sql).toContain(`e."createdByUserId" IS NULL`);
    expect(paragraph).toContain(
      "unless it is monitored, classified, or one someone added or changed",
    );
  });

  test("says nothing is removed while the switch or controller that saw it reports nothing", () => {
    expect(AGE_OUT_REPORTING_WINDOW_MS).toBeGreaterThan(0);
    expect(paragraph).toContain(
      "nothing a switch or controller saw is removed while it reports nothing",
    );
  });

  test("says a device seen again comes back new, on the map even if it was hidden", () => {
    const sql: string = buildAgeOutStatement({
      projectId: "aa000000-0000-4000-8000-000000000001",
      seenBefore: new Date(),
      reportingDeviceIds: [],
      limit: 1,
      removedAt: new Date(),
    }).sql;

    expect(sql).toContain(`s."nodeKey" = 'endpoint:' || r."_id"::text`);
    expect(paragraph).toContain(
      "A removed device that is seen again comes back as a new one, shown on the map even if it was hidden before.",
    );
  });

  test("says where the line is that tells how long devices stay", () => {
    expect(paragraph).toContain(
      "The line under the list says how long devices stay",
    );
  });
});
