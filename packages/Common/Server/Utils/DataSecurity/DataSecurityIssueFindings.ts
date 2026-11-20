import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getTelemetryCheckIdOfDataType,
  isTelemetryFindingCheck,
  isUnscrubbedTelemetryFinding,
} from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import ObjectID from "../../../Types/ObjectID";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * THE FINDINGS A TELEMETRY ISSUE'S CHECK COUNTS: the places its data type
 * was seen in the store's telemetry in the last FINDING_FRESHNESS_IN_DAYS
 * days that no scrub rule hides and nobody set aside
 * (isUnscrubbedTelemetryFinding), of the data types its check is about -
 * the most matched first. Explain and Fix with AI tell OneUptime AI where
 * the data sits from them, and Scrub It's proposal makes a rule for each
 * (#10364). Never a sample: the columns that hold one are not read.
 *
 * None for an issue that is not a telemetry issue.
 */

// The most findings a store's telemetry issue is read with.
export const MAX_ISSUE_FINDINGS_READ: number = 100;

export async function readCountedTelemetryFindings(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID | undefined;
  checkId: string | undefined;
  now?: Date | undefined;
}): Promise<Array<DataStoreFinding>> {
  if (!isTelemetryFindingCheck(data.checkId) || !data.dataStoreId) {
    return [];
  }

  const findings: Array<DataStoreFinding> = await DataStoreFindingService.findBy(
    {
      query: {
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        isSuppressed: false,
        isScrubbed: false,
        lastSeenAt: QueryHelper.greaterThanEqualTo(
          // A length of time, the same on every server (issue #8236).
          OneUptimeDate.addRemoveDurationInDays(
            data.now || OneUptimeDate.getCurrentDate(),
            -FINDING_FRESHNESS_IN_DAYS,
          ),
        ),
      },
      select: {
        _id: true,
        dataTypeId: true,
        dataTypeName: true,
        location: true,
        locationKind: true,
        confidence: true,
        matchCount: true,
        isConfirmed: true,
        isAiSuggested: true,
        isScrubbed: true,
      },
      sort: { matchCount: SortOrder.Descending },
      skip: 0,
      limit: MAX_ISSUE_FINDINGS_READ,
      props: { isRoot: true },
    },
  );

  return findings.filter((finding: DataStoreFinding): boolean => {
    return (
      isUnscrubbedTelemetryFinding(finding) &&
      getTelemetryCheckIdOfDataType(finding.dataTypeId || "") === data.checkId
    );
  });
}
