import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  FINDING_FRESHNESS_IN_DAYS,
  getTelemetryCheckIdOfDataType,
  isTelemetryFindingCheck,
  isUnscrubbedTelemetryFinding,
} from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AiFindingRecord,
  AiIssueRecord,
  MAX_ISSUE_FINDINGS_FOR_AI,
} from "./DataSecurityAiInput";

/*
 * WHAT A DATA SECURITY FEATURE READS FOR ONEUPTIME AI (#10365).
 *
 * Explain and Fix with AI read an issue, and a telemetry issue's places,
 * here: the columns DataSecurityAiInput may tell OneUptime AI and nothing
 * more - never a finding's masked samples or the records it was seen in,
 * never a store's connection string. Read as OneUptime: the route that
 * asks has checked who may ask already.
 */

// What Explain and Fix with AI read of an issue and its store.
export const AI_ISSUE_SELECT: {
  _id: true;
  checkId: true;
  title: true;
  evidence: true;
  severity: true;
  dataTypeIds: true;
  dataStoreId: true;
  dataStore: {
    name: true;
    kind: true;
    region: true;
    sensitivity: true;
    providerResourceId: true;
  };
} = {
  _id: true,
  checkId: true,
  title: true,
  evidence: true,
  severity: true,
  dataTypeIds: true,
  dataStoreId: true,
  dataStore: {
    name: true,
    kind: true,
    region: true,
    sensitivity: true,
    providerResourceId: true,
  },
};

// What a telemetry issue's places are read with.
export const AI_PLACE_SELECT: {
  dataTypeId: true;
  dataTypeName: true;
  location: true;
  locationKind: true;
  confidence: true;
  matchCount: true;
  isConfirmed: true;
  isAiSuggested: true;
  isScrubbed: true;
} = {
  dataTypeId: true,
  dataTypeName: true,
  location: true,
  locationKind: true,
  // What isUnscrubbedTelemetryFinding reads to tell the findings a check counts.
  confidence: true,
  matchCount: true,
  isConfirmed: true,
  isAiSuggested: true,
  isScrubbed: true,
};

// The most findings looked through for a telemetry issue's places.
const PLACES_READ: number = 100;

export default class DataSecurityAiReads {
  /*
   * An issue of the project, with its store, as OneUptime AI may be told
   * it. One of another project, or none, is not found.
   */
  @CaptureSpan()
  public static async readIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
  }): Promise<DataSecurityIssue & AiIssueRecord> {
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: AI_ISSUE_SELECT,
        props: { isRoot: true },
      });

    if (!issue?.id) {
      throw new BadDataException("Issue not found.");
    }

    return issue;
  }

  /*
   * Where a telemetry issue's data sits: the findings its check counts
   * (isUnscrubbedTelemetryFinding) - each data type and its location, never
   * a sample - the most matched first. None for any other issue.
   */
  @CaptureSpan()
  public static async readPlaces(data: {
    projectId: ObjectID;
    issue: AiIssueRecord;
  }): Promise<Array<AiFindingRecord>> {
    if (
      !isTelemetryFindingCheck(data.issue.checkId) ||
      !data.issue.dataStoreId
    ) {
      return [];
    }

    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.issue.dataStoreId,
          isSuppressed: false,
          isScrubbed: false,
          lastSeenAt: QueryHelper.greaterThanEqualTo(
            // A length of time, the same on every server (issue #8236).
            OneUptimeDate.addRemoveDurationInDays(
              OneUptimeDate.getCurrentDate(),
              -FINDING_FRESHNESS_IN_DAYS,
            ),
          ),
        },
        select: AI_PLACE_SELECT,
        sort: { matchCount: SortOrder.Descending },
        skip: 0,
        limit: PLACES_READ,
        props: { isRoot: true },
      });

    return findings
      .filter((finding: DataStoreFinding): boolean => {
        return (
          isUnscrubbedTelemetryFinding(finding) &&
          getTelemetryCheckIdOfDataType(finding.dataTypeId || "") ===
            data.issue.checkId
        );
      })
      .slice(0, MAX_ISSUE_FINDINGS_FOR_AI)
      .map((finding: DataStoreFinding): AiFindingRecord => {
        return {
          dataTypeId: finding.dataTypeId,
          dataTypeName: finding.dataTypeName,
          location: finding.location,
          locationKind: finding.locationKind,
        };
      });
  }
}
