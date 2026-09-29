import OcsfSeverity, {
  OCSF_SEVERITY_ALIASES,
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  DETECTION_FINDING_CLASS_UID,
  GOOGLE_SECOPS_PRODUCT_NAME,
  GOOGLE_SECOPS_RISK_SCORE_BANDS,
  GOOGLE_SECOPS_VENDOR_NAME,
} from "../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";

/*
 * Re-grades Google SecOps detections that were stored as Unknown before the
 * normalizer learned to read a custom rule's severity.
 *
 * Every stored row keeps its source payload flattened into `attributes`
 * (`detection.0.ruleLabels.2.key` = "severity", `...2.value` = "Medium"), so
 * the grade the fixed GoogleSecOpsAlertNormalizer would give a row can be
 * computed in SQL from the row itself. The expression below is that
 * normalizer's resolveSeverity, written against the flattened keys:
 *
 *   1. detection[0].severity   (Google's grade on curated rules)
 *   2. the Collection's severity
 *   3. the first ruleLabels "severity" that names a grade (YARA-L meta)
 *   4. the first outcomes "risk_score" that grades, on Google's bands
 *
 * Its text tables are generated from OCSF_SEVERITY_ALIASES and
 * GOOGLE_SECOPS_RISK_SCORE_BANDS, the same tables the normalizer reads, so
 * the two cannot drift apart. It reads the list form of ruleLabels and
 * outcomes Google returns; a label map in a hand-built webhook body is
 * graded at ingest but not here.
 *
 * Only rows that are still Unknown and that the expression grades are
 * touched, so the repair is idempotent and never overrides a grade.
 */
export default class GoogleSecOpsSeverityRepair {
  /*
   * The OCSF severity name a stored row's attributes grade to, or '' when
   * nothing in them grades.
   */
  public static gradeExpression(): string {
    const detectionSeverity: string = `if(attributes['detection.0.severity'] != '', attributes['detection.0.severity'], attributes['detection.severity'])`;
    const graded: Array<string> = [
      GoogleSecOpsSeverityRepair.gradeText(detectionSeverity),
      GoogleSecOpsSeverityRepair.gradeText("attributes['severity']"),
      GoogleSecOpsSeverityRepair.firstKeyedGrade(
        "(ruleLabels|rule_labels)",
        "severity",
        GoogleSecOpsSeverityRepair.gradeText,
      ),
      GoogleSecOpsSeverityRepair.firstKeyedGrade(
        "outcomes",
        "risk_score",
        GoogleSecOpsSeverityRepair.gradeRiskScore,
      ),
    ];

    // The first of the four grades that is set, in the normalizer's order.
    return `arrayFirst(grade -> grade != '', [${graded.join(", ")}])`;
  }

  /*
   * The async ON CLUSTER mutation. `storageTable` is the local storage
   * table and `onCluster` the cluster clause, as every data mutation on
   * the clustered analytics schema is written.
   */
  public static repairStatement(data: {
    storageTable: string;
    onCluster: string;
  }): string {
    const grade: string = GoogleSecOpsSeverityRepair.gradeExpression();
    const names: Array<OcsfSeverity> = Object.keys(
      OcsfSeverityId,
    ) as Array<OcsfSeverity>;
    const severityId: string = `transform(${grade}, [${names
      .map((name: OcsfSeverity): string => {
        return GoogleSecOpsSeverityRepair.literal(name);
      })
      .join(", ")}], [${names
      .map((name: OcsfSeverity): string => {
        return String(OcsfSeverityId[name]);
      })
      .join(", ")}], ${OcsfSeverityId[OcsfSeverity.Unknown]})`;

    return `ALTER TABLE ${data.storageTable}${data.onCluster} UPDATE severityName = ${grade}, severityId = ${severityId} WHERE ${GoogleSecOpsSeverityRepair.condition()}`;
  }

  /*
   * The rows the repair rewrites: Google SecOps detection findings still
   * stored as Unknown whose attributes now grade. The cheap column checks
   * come first so ClickHouse evaluates the attribute expression only for
   * those rows.
   */
  public static condition(): string {
    return [
      `vendorName = ${GoogleSecOpsSeverityRepair.literal(GOOGLE_SECOPS_VENDOR_NAME)}`,
      `productName = ${GoogleSecOpsSeverityRepair.literal(GOOGLE_SECOPS_PRODUCT_NAME)}`,
      `classUid = ${DETECTION_FINDING_CLASS_UID}`,
      `severityId = ${OcsfSeverityId[OcsfSeverity.Unknown]}`,
      `${GoogleSecOpsSeverityRepair.gradeExpression()} != ''`,
    ].join(" AND ");
  }

  // normalizeOcsfSeverity, minus Unknown: text that names no grade is ''.
  private static gradeText(expression: string): string {
    const graded: Array<[string, OcsfSeverity]> = Object.entries(
      OCSF_SEVERITY_ALIASES,
    ).filter((entry: [string, OcsfSeverity]): boolean => {
      return entry[1] !== OcsfSeverity.Unknown;
    });

    const from: string = graded
      .map((entry: [string, OcsfSeverity]): string => {
        return GoogleSecOpsSeverityRepair.literal(entry[0]);
      })
      .join(", ");
    const to: string = graded
      .map((entry: [string, OcsfSeverity]): string => {
        return GoogleSecOpsSeverityRepair.literal(entry[1]);
      })
      .join(", ");

    return `transform(upperUTF8(${GoogleSecOpsSeverityRepair.trimmed(expression)}), [${from}], [${to}], '')`;
  }

  /*
   * The normalizer's gradeRiskScore: a finite score above zero grades into
   * the first band whose minimum it reaches.
   */
  private static gradeRiskScore(expression: string): string {
    const bands: string = GOOGLE_SECOPS_RISK_SCORE_BANDS.map(
      (band: { minimum: number; severity: OcsfSeverity }): string => {
        return `score >= ${band.minimum}, ${GoogleSecOpsSeverityRepair.literal(band.severity)}`;
      },
    ).join(", ");

    return `arrayMap(score -> multiIf(NOT isFinite(score) OR score <= 0, '', ${bands}, ''), [ifNull(toFloat64OrNull(${GoogleSecOpsSeverityRepair.trimmed(expression)}), 0)])[1]`;
  }

  /*
   * The first grade among the entries of detection[0].<list> whose key is
   * `key`, in list order: the normalizer's readKeyedValues + firstGrade.
   * A flattened entry is `detection.0.<list>.<index>.key` / `.value`
   * (`detection.<list>...` when the webhook sent detection as an object).
   */
  private static firstKeyedGrade(
    listPattern: string,
    key: string,
    grade: (expression: string) => string,
  ): string {
    const keyPattern: string = `^detection[.](0[.])?${listPattern}[.][0-9]+[.]key$`;
    const keys: string = `arraySort(entryKey -> toUInt64OrZero(extract(entryKey, '[.]([0-9]+)[.]key$')), arrayFilter(entryKey -> match(entryKey, ${GoogleSecOpsSeverityRepair.literal(keyPattern)}), mapKeys(attributes)))`;
    const value: string =
      "attributes[concat(substring(entryKey, 1, length(entryKey) - 3), 'value')]";

    return `arrayFirst(entryGrade -> entryGrade != '', arrayMap(entryKey -> if(lowerUTF8(${GoogleSecOpsSeverityRepair.trimmed("attributes[entryKey]")}) = ${GoogleSecOpsSeverityRepair.literal(key)}, ${grade(value)}, ''), ${keys}))`;
  }

  /*
   * JavaScript's String.trim strips all surrounding whitespace; ClickHouse's
   * trim() strips spaces only.
   */
  private static trimmed(expression: string): string {
    return `replaceRegexpAll(${expression}, '^[[:space:]]+|[[:space:]]+$', '')`;
  }

  private static literal(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
}
