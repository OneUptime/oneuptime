import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  DataSecurityComplianceFramework,
  DataSecurityComplianceTurnedOff,
} from "Common/Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import OneUptimeDate from "Common/Types/Date";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import * as DownloadFile from "Common/UI/Utils/DownloadFile";
import {
  COMPLIANCE_REASON_MAX_LENGTH,
  TURNED_OFF,
  TURNED_OFF_BY_ON,
  TURNED_OFF_ON,
  findTurnedOffEntry,
  getTurnedOffEntries,
  getTurnedOffLine,
  readReasonInput,
} from "../../FeatureSet/Dashboard/src/Components/ResourceDataSecurity/ResourceComplianceModel";
import {
  describeTurnedOff,
  downloadFrameworkReportJson,
  getFrameworkReportCsv,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/ComplianceExport";

/*
 * WHY A FRAMEWORK OR A REQUIREMENT IS TURNED OFF (#9629), worked out: which
 * of a framework's turned-off settings a switch or a requirement reads, who
 * turned it off and when in the reader's words, the reason as it is typed,
 * and the auditor's files - the CSV's Turned Off On and the JSON's list.
 */

const CLUSTER_ID: string = "44444444-0000-4000-8000-000000000004";

function entryOf(
  data: Partial<DataSecurityComplianceTurnedOff> = {},
): DataSecurityComplianceTurnedOff {
  return {
    id: "66666666-0000-4000-8000-000000000006",
    resource: {
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
      name: "prod-eu",
    },
    requirement: null,
    note: "",
    turnedOffAt: "2026-11-12T09:30:00.000Z",
    turnedOffBy: "Jane Doe",
    ...data,
  };
}

function frameworkOf(
  turnedOff: Array<DataSecurityComplianceTurnedOff>,
): DataSecurityComplianceFramework {
  return {
    framework: ComplianceFramework.PCIDSS,
    fullName: "Payment Card Industry Data Security Standard",
    scope: "Stores that hold card data.",
    score: 50,
    storesInScope: 1,
    storesTurnedOff: 1,
    requirements: [
      {
        requirement: "3.4",
        title: "Render card numbers unreadable",
        status: ComplianceRequirementStatus.Passing,
        checkIds: ["encryption-at-rest"],
        failingIssueCount: 0,
      },
      {
        requirement: "7.2",
        title: "Restrict access",
        status: ComplianceRequirementStatus.TurnedOff,
        checkIds: ["public-read"],
        failingIssueCount: 0,
      },
    ],
    turnedOff,
  };
}

// A translator that fills a template as English does.
const ENGLISH: Translator = {
  translateText: (text: string): string => {
    return text;
  },
  translateTemplate: (
    template: string,
    values: Record<string, string>,
  ): string => {
    return template.replace(/{{(\w+)}}/g, (_all: string, name: string) => {
      return values[name] || "";
    });
  },
} as unknown as Translator;

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which turned-off setting a switch or a requirement reads", () => {
  const whole: DataSecurityComplianceTurnedOff = entryOf({ id: "whole" });
  const requirement: DataSecurityComplianceTurnedOff = entryOf({
    id: "requirement",
    requirement: "7.2",
  });
  const framework: DataSecurityComplianceFramework = frameworkOf([
    requirement,
    whole,
  ]);

  test("the whole framework's, or one requirement's, never the other's", () => {
    expect(getTurnedOffEntries(framework, null)).toEqual([whole]);
    expect(getTurnedOffEntries(framework, " 7.2 ")).toEqual([requirement]);
    expect(getTurnedOffEntries(framework, "3.4")).toEqual([]);
  });

  test("a switch reads its own setting", () => {
    expect(
      findTurnedOffEntry(framework, {
        framework: ComplianceFramework.PCIDSS,
      }),
    ).toBe(whole);
    expect(
      findTurnedOffEntry(framework, {
        framework: ComplianceFramework.PCIDSS,
        requirement: "7.2",
      }),
    ).toBe(requirement);
  });

  test("an older server's answer has none", () => {
    expect(getTurnedOffEntries({}, null)).toEqual([]);
  });
});

describe("who turned it off, and when, in the reader's words", () => {
  test("a person's name and the day, the day as OneUptime writes it for the reader", () => {
    const day: string = OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
      "2026-11-12T09:30:00.000Z",
      true,
    );

    expect(getTurnedOffLine(entryOf(), ENGLISH)).toBe(
      `Turned off by Jane Doe on ${day}`,
    );
  });

  test("an API key's names nobody, and one from before they were kept says only Turned off", () => {
    expect(getTurnedOffLine(entryOf({ turnedOffBy: null }), ENGLISH)).toMatch(
      /^Turned off on .+/,
    );
    expect(
      getTurnedOffLine(
        entryOf({ turnedOffBy: null, turnedOffAt: null }),
        ENGLISH,
      ),
    ).toBe("Turned off");
  });

  test("each is one whole sentence, its values filled in place", () => {
    expect(TURNED_OFF_BY_ON).toBe("Turned off by {{name}} on {{date}}");
    expect(TURNED_OFF_ON).toBe("Turned off on {{date}}");
    expect(TURNED_OFF).toBe("Turned off");
  });
});

describe("a reason as it is typed", () => {
  test("is cut at what its setting keeps", () => {
    expect(COMPLIANCE_REASON_MAX_LENGTH).toBe(500);
    expect(readReasonInput("x".repeat(600))).toHaveLength(500);
    // Its spaces stay while it is typed; it is trimmed when saved.
    expect(readReasonInput("No card data ")).toBe("No card data ");
  });
});

describe("the auditor's files", () => {
  const framework: DataSecurityComplianceFramework = frameworkOf([
    entryOf({
      id: "requirement",
      requirement: "7.2",
      resource: {
        kind: DataStoreResourceKind.Service,
        id: "77777777-0000-4000-8000-000000000007",
        name: "checkout",
      },
      note: "Its telemetry never holds card numbers.",
      turnedOffBy: null,
      turnedOffAt: "2026-11-10T08:00:00.000Z",
    }),
    entryOf({ id: "whole", note: "No card data ever reaches prod-eu." }),
  ]);

  test("each requirement says where it is turned off, by whom, when and why", () => {
    expect(describeTurnedOff(framework, "7.2")).toBe(
      "checkout (Service), turned off on 2026-11-10: Its telemetry never holds card numbers.; prod-eu (KubernetesCluster), whole framework, turned off by Jane Doe on 2026-11-12: No card data ever reaches prod-eu.",
    );
    // The whole framework turned off is every requirement's.
    expect(describeTurnedOff(framework, "3.4")).toBe(
      "prod-eu (KubernetesCluster), whole framework, turned off by Jane Doe on 2026-11-12: No card data ever reaches prod-eu.",
    );
  });

  test("a resource the reader may not read is named by its id", () => {
    expect(
      describeTurnedOff(
        frameworkOf([
          entryOf({
            resource: {
              kind: DataStoreResourceKind.KubernetesCluster,
              id: CLUSTER_ID,
              name: "",
            },
          }),
        ]),
        "3.4",
      ),
    ).toBe(
      `${CLUSTER_ID} (KubernetesCluster), whole framework, turned off by Jane Doe on 2026-11-12`,
    );
  });

  test("the CSV has a Turned Off On column", () => {
    const lines: Array<string> = getFrameworkReportCsv(framework).split("\r\n");

    expect(lines[0]).toBe(
      "Framework,Requirement,Title,Status,Checks,Open Issues,Turned Off On",
    );
    expect(lines[2]).toContain("Turned off");
    expect(lines[2]).toContain(
      "checkout (Service), turned off on 2026-11-10: Its telemetry never holds card numbers.",
    );
  });

  test("the JSON lists what is turned off, whole", () => {
    let written: string = "";

    jest
      .spyOn(DownloadFile, "default")
      .mockImplementation((data: { content: string }): void => {
        written = data.content;
      });

    downloadFrameworkReportJson(
      framework,
      new Date("2026-11-19T00:00:00.000Z"),
    );

    const report: { turnedOff: Array<DataSecurityComplianceTurnedOff> } =
      JSON.parse(written);

    expect(report.turnedOff).toEqual(framework.turnedOff);
  });
});
