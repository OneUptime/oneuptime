import { describe, expect, test } from "@jest/globals";
import GoogleSecOpsSeverityRepair from "../../../../Server/Utils/SecurityEvent/GoogleSecOpsSeverityRepair";
import OcsfSeverity, {
  OCSF_SEVERITY_ALIASES,
  OcsfSeverityId,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import { GOOGLE_SECOPS_RISK_SCORE_BANDS } from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";

/*
 * The SQL that re-grades Google SecOps detections stored as Unknown before
 * the normalizer read custom-rule severities. What it computes is pinned
 * against a real ClickHouse in GoogleSecOpsSeverityRepairClickhouseIntegration;
 * these tests pin the statement's shape: the guards that keep it to Google
 * SecOps findings that are still Unknown, that it writes the name and the id
 * together from one grade, and that its tables are the normalizer's own.
 */

const STATEMENT: string = GoogleSecOpsSeverityRepair.repairStatement({
  storageTable: "SecurityEventItemV1Local",
  onCluster: " ON CLUSTER 'oneuptime'",
});
const GRADE: string = GoogleSecOpsSeverityRepair.gradeExpression();

describe("GoogleSecOpsSeverityRepair.repairStatement", () => {
  test("mutates the local storage table ON CLUSTER", () => {
    expect(
      STATEMENT.startsWith(
        "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'oneuptime' UPDATE ",
      ),
    ).toBe(true);
  });

  test("writes the severity name and its id from the same grade", () => {
    const names: Array<OcsfSeverity> = Object.keys(
      OcsfSeverityId,
    ) as Array<OcsfSeverity>;
    const idTransform: string = `transform(${GRADE}, [${names
      .map((name: OcsfSeverity): string => {
        return `'${name}'`;
      })
      .join(", ")}], [${names
      .map((name: OcsfSeverity): string => {
        return String(OcsfSeverityId[name]);
      })
      .join(", ")}], 0)`;

    expect(STATEMENT).toContain(
      `UPDATE severityName = ${GRADE}, severityId = ${idTransform} WHERE `,
    );
  });

  test("only touches Google SecOps findings still stored as Unknown that now grade", () => {
    const condition: string = GoogleSecOpsSeverityRepair.condition();

    expect(STATEMENT.endsWith(` WHERE ${condition}`)).toBe(true);
    expect(condition).toBe(
      [
        "vendorName = 'Google'",
        "productName = 'Google SecOps'",
        "classUid = 2004",
        "severityId = 0",
        `${GRADE} != ''`,
      ].join(" AND "),
    );
  });

  test("uses no non-deterministic function a mutation would reject", () => {
    for (const fn of ["now(", "rand", "today(", "generateUUID"]) {
      expect(STATEMENT).not.toContain(fn);
    }
  });

  test("is the same statement every time, so a re-run is the same mutation", () => {
    expect(
      GoogleSecOpsSeverityRepair.repairStatement({
        storageTable: "SecurityEventItemV1Local",
        onCluster: " ON CLUSTER 'oneuptime'",
      }),
    ).toBe(STATEMENT);
  });
});

describe("GoogleSecOpsSeverityRepair.gradeExpression", () => {
  test("reads the four sources in the normalizer's order", () => {
    const order: Array<number> = [
      GRADE.indexOf("attributes['detection.0.severity']"),
      GRADE.indexOf("attributes['severity']"),
      GRADE.indexOf("(ruleLabels|rule_labels)"),
      GRADE.indexOf("outcomes"),
    ];

    for (const position of order) {
      expect(position).toBeGreaterThan(-1);
    }

    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
    expect(GRADE.startsWith("arrayFirst(grade -> grade != '', [")).toBe(true);
  });

  test("grades text with every OCSF alias except Unknown", () => {
    for (const [alias, severity] of Object.entries(OCSF_SEVERITY_ALIASES)) {
      if (severity === OcsfSeverity.Unknown) {
        expect(GRADE).not.toContain(`'${alias}'`);
      } else {
        expect(GRADE).toContain(`'${alias}'`);
      }
    }

    expect(GRADE).not.toContain("'Unknown'");
  });

  test("grades risk scores with the normalizer's bands, highest first", () => {
    const bands: string = GOOGLE_SECOPS_RISK_SCORE_BANDS.map(
      (band: { minimum: number; severity: OcsfSeverity }): string => {
        return `score >= ${band.minimum}, '${band.severity}'`;
      },
    ).join(", ");

    expect(GRADE).toContain(
      `multiIf(NOT isFinite(score) OR score <= 0, '', ${bands}, '')`,
    );
  });

  test("reads only the first detection entry's labels and outcomes", () => {
    expect(GRADE).toContain(
      "'^detection[.](0[.])?(ruleLabels|rule_labels)[.][0-9]+[.]key$'",
    );
    expect(GRADE).toContain("'^detection[.](0[.])?outcomes[.][0-9]+[.]key$'");
  });

  test("walks list entries by their numeric index, not the map's key order", () => {
    expect(GRADE).toContain(
      "arraySort(entryKey -> toUInt64OrZero(extract(entryKey, '[.]([0-9]+)[.]key$'))",
    );
  });
});
