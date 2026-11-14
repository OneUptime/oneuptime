import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "USED BY" ON EACH RECORD'S OWN PAGE (#6813), and where it is removed.
 *
 * Each of the six records of the issue answers "what uses this?" on its own
 * page: the overview of a monitor, an on-call schedule, a service, a status
 * page and a team carries the Used by card for its kind, and a label - which
 * has no page of its own - has a Used by action on each row of Settings >
 * Labels. The Delete page of each of the five says what still uses the
 * record, on the page and inside its confirmation, and the Archive card of
 * a monitor, a status page and a service says it inside its confirmation.
 * The server's router is mounted, so the card has something to ask.
 */

const DASHBOARD: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function read(relative: string): string {
  return fs.readFileSync(path.join(DASHBOARD, relative), "utf8");
}

interface RecordPages {
  kind: string;
  overview: string;
  deletePage: string;
  settings?: string | undefined;
}

const RECORDS: Array<RecordPages> = [
  {
    kind: "Monitor",
    overview: "Pages/Monitor/View/Index.tsx",
    deletePage: "Pages/Monitor/View/Delete.tsx",
    settings: "Pages/Monitor/View/Settings.tsx",
  },
  {
    kind: "OnCallSchedule",
    overview: "Pages/OnCallDuty/OnCallDutySchedule/Index.tsx",
    deletePage: "Pages/OnCallDuty/OnCallDutySchedule/Delete.tsx",
  },
  {
    kind: "Service",
    overview: "Pages/Service/View/Index.tsx",
    deletePage: "Pages/Service/View/Delete.tsx",
    settings: "Pages/Service/View/Settings.tsx",
  },
  {
    kind: "StatusPage",
    overview: "Pages/StatusPages/View/Index.tsx",
    deletePage: "Pages/StatusPages/View/Delete.tsx",
    settings: "Pages/StatusPages/View/StatusPageSettings.tsx",
  },
  {
    kind: "Team",
    overview: "Pages/Teams/View/Index.tsx",
    deletePage: "Pages/Teams/View/Delete.tsx",
  },
];

describe("each record answers what uses it on its own page", () => {
  test.each(RECORDS)(
    "the $kind overview draws the Used by card for its kind",
    (record: RecordPages) => {
      const source: string = read(record.overview);

      expect(source).toContain(
        'import UsedByCard from "../../../Components/UsedBy/UsedByCard";',
      );
      expect(source).toMatch(
        new RegExp(
          `<UsedByCard\\s+recordKind=\\{UsedByRecordKind\\.${record.kind}\\}\\s+recordId=\\{modelId\\}`,
          "u",
        ),
      );
    },
  );

  test("the monitor's card sits in the overview's side column, under When this goes down, and refreshes with it", () => {
    const source: string = read("Pages/Monitor/View/Index.tsx");
    const whoIsTold: number = source.indexOf("<MonitorWhoIsToldCard");
    const usedBy: number = source.indexOf("<UsedByCard");
    const sideColumn: number = source.lastIndexOf(
      '<div className="min-w-0">',
      whoIsTold,
    );

    expect(whoIsTold).toBeGreaterThan(-1);
    expect(sideColumn).toBeGreaterThan(-1);
    expect(usedBy).toBeGreaterThan(whoIsTold);
    expect(source.slice(usedBy, usedBy + 300)).toContain(
      "refreshToken={data.manualRefreshCount}",
    );
    expect(source.slice(usedBy, usedBy + 300)).toContain(
      'headerLayout="stacked"',
    );
  });

  test("a label's row on Settings > Labels opens what carries it", () => {
    const source: string = read("Pages/Settings/Labels.tsx");

    expect(source).toContain("title: USED_BY_ACTION");
    expect(source).toContain("placement: ActionButtonPlacement.MoreMenu");
    expect(source).toContain("...archive.actionButtons");
    expect(source).toMatch(
      /<UsedByDialog\s+recordKind=\{UsedByRecordKind\.Label\}\s+recordId=\{usedByLabelId\}/u,
    );
  });
});

describe("where a record is removed, it says what still uses it", () => {
  test.each(RECORDS)(
    "the $kind Delete page says it on the page and inside the confirmation",
    (record: RecordPages) => {
      const source: string = read(record.deletePage);

      expect(source).toMatch(
        new RegExp(
          `useUsedBySummary\\(\\{\\s+recordKind: UsedByRecordKind\\.${record.kind},\\s+recordId: modelId,`,
          "u",
        ),
      );
      expect(source).toMatch(/<UsedByImpactNotice\s+state=\{usedBy\.state\}/u);
      expect(source).toContain("confirmationContent={");
      expect(source).toContain("hasUsedByImpact(usedBy.state)");
      expect(source).toContain("<UsedByImpactList state={usedBy.state} />");

      // The notice comes before the card that deletes.
      expect(source.indexOf("<UsedByImpactNotice")).toBeLessThan(
        source.indexOf("<ModelDelete"),
      );
    },
  );

  test("the monitor's Delete page leaves the SLOs to their own warning on the page, not in the dialog", () => {
    const source: string = read("Pages/Monitor/View/Delete.tsx");

    expect(source).toContain("<SloImpactWarning monitorId={modelId} />");
    expect(source).toMatch(
      /<UsedByImpactNotice\s+state=\{usedBy\.state\}\s+leaveOut=\{\[UsedByRelation\.MonitorSlos\]\}/u,
    );
    expect(source).toContain("<UsedByImpactList state={usedBy.state} />");
  });

  test.each(
    RECORDS.filter((record: RecordPages): boolean => {
      return Boolean(record.settings);
    }),
  )(
    "the $kind Archive card lists it inside its confirmation",
    (record: RecordPages) => {
      const source: string = read(record.settings as string);

      expect(source).toMatch(
        new RegExp(
          `archiveConfirmationContent=\\{\\s+<UsedByImpactForRecord\\s+recordKind=\\{UsedByRecordKind\\.${record.kind}\\}\\s+recordId=\\{modelId\\}`,
          "u",
        ),
      );
    },
  );

  test("the Archive card draws that list only while it asks to archive", () => {
    const source: string = read(
      "Components/TelemetryResource/ArchiveResourceCard.tsx",
    );

    expect(source).toContain(
      "{!isArchived && props.archiveConfirmationContent",
    );
  });
});

describe("the server answers", () => {
  test("the Used by router is mounted beside Who is told", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/BaseAPI/Index.ts"),
      "utf8",
    );

    expect(source).toContain(
      'import UsedByAPI from "Common/Server/API/UsedByAPI";',
    );
    expect(source).toContain(
      "app.use(`/${APP_NAME.toLocaleLowerCase()}`, UsedByAPI);",
    );
  });
});
