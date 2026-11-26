import DataSecurityCustomDataType from "../../../Models/DatabaseModels/DataSecurityCustomDataType";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueFeed, {
  DataSecurityIssueFeedEventType,
} from "../../../Models/DatabaseModels/DataSecurityIssueFeed";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../Models/DatabaseModels/DataStoreAccess";
import DataStoreFeed, {
  DataStoreFeedEventType,
} from "../../../Models/DatabaseModels/DataStoreFeed";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CloudRegionLocation,
  getCloudRegionLocation,
} from "../../../Types/DataSecurity/CloudRegionCountry";
import { customDataTypeId } from "../../../Types/DataSecurity/CustomDataTypeId";
import DataCategory from "../../../Types/DataSecurity/DataCategory";
import {
  DataSecurityResponseAction,
  EXPOSURE_RESPONSE_ACTIONS,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import DataSensitivity, {
  isDataSensitivity,
} from "../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import { BreachPlace } from "../../../Types/DataSecurity/BreachLaws";
import {
  buildExposureAssessmentView,
  EXPOSURE_CHECK_IDS,
  ExposureAssessmentView,
  ExposureChangeDirection,
  ExposureDataType,
  ExposureGrant,
  ExposureIssueEntry,
  ExposureIssueEvent,
  ExposureIssueFacts,
  ExposureIssueView,
  ExposureReads,
  ExposureResponseEntry,
  ExposureSecret,
  ExposureStoreChange,
  ExposureWhoseData,
  ExposureWindow,
  EXPOSING_CHANGE_LOOKBACK_IN_DAYS,
  getExposureChangeDirection,
  getExposureChangeOperations,
  getExposureReads,
  getExposureWindow,
  getWhoseData,
  MAX_EXPOSURE_SECRETS,
  readStoredExposureAssessment,
  StoredExposureAssessment,
} from "../../../Types/DataSecurity/ExposureAssessment";
import { DataStoreExposure } from "../../../Types/DataSecurity/DataStorePosture";
import {
  ExposureChecklistAnswer,
  getExposureChecklistAnswers,
} from "../../../Types/DataSecurity/ExposureChecklist";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  getDataStoreKeyOfEntityValue,
  readSecurityEntities,
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import {
  ChangeEventAttribute,
  ChangeEventSource,
} from "../../../Utils/Telemetry/ChangeEventFields";
import { Results } from "../../Services/AnalyticsDatabaseService";
import ChangeEventService from "../../Services/ChangeEventService";
import DataSecurityCustomDataTypeService from "../../Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreAccessService from "../../Services/DataStoreAccessService";
import DataStoreFeedService from "../../Services/DataStoreFeedService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import SecurityCaseService from "../../Services/SecurityCaseService";
import SecurityCaseTaskService from "../../Services/SecurityCaseTaskService";
import { getClickhouseDatabaseName } from "../AnalyticsDatabase/ClusterConfig";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import CallerPermission from "../Permission/CallerPermission";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  DataStoreChangeMatcher,
  DataStoreForSignal,
  PostureChange,
  readPostureChange,
} from "./DataSecurityChangeSignals";
import { readResponseActionOfStoreFeed } from "./DataSecurityResponseFeed";
import { ResponseJSON } from "@clickhouse/client";

/*
 * WHAT DATA SECURITY KNOWS OF A CASE'S EXPOSURE, READ (#10377).
 *
 * An exposure's assessment is worked out by plain code
 * (Types/DataSecurity/ExposureAssessment) from what Data Security keeps:
 *
 *   - the case, its entities, and which of them is a data store;
 *   - the store's exposure issues - the ones the case holds, else the
 *     store's own - and their timelines (DataSecurityIssueFeed): when each
 *     opened, reopened and resolved;
 *   - the store's timeline (DataStoreFeed): Data Security's own response
 *     that closed it, Block public access or Revoke sharing;
 *   - the cloud's change log (ChangeEvent): the changes of who can reach
 *     the store around the exposure, matched to it as the change signals
 *     match them (DataStoreChangeMatcher) - best effort, read with a bound;
 *   - who can reach the store (DataStoreAccess): counted, never named;
 *   - the secrets found in it (DataStoreFinding): each type and where -
 *     never a sample, which is not selected;
 *   - the store's configuration: whether reads are logged (its posture's
 *     accessLogging), its region, what it holds, about how many records,
 *     the countries its data types say its people are in, and the people
 *     its record of processing says it is about, as a person wrote or
 *     confirmed them;
 *   - the case's tasks, matched to the playbook's checklist.
 *
 * Who reads it: the case's readers who may read the store and its
 * findings too (mayRead), since it names what the store holds. The case
 * and its stores are read as the reader first - a case or a store a label
 * keeps from them is not found - and the rest as OneUptime, once that read
 * passed.
 */

export const READ_REFUSED_MESSAGE: string =
  "An exposure assessment names what a data store holds, so it takes reading the security case, the data store and the store's findings. Ask a Project Admin for a role that reads all three.";

export const CHANGE_REFUSED_MESSAGE: string =
  "Changing an exposure assessment takes permission to edit the security case, and to read the data store and its findings.";

export const NOT_ABOUT_A_STORE_MESSAGE: string =
  "This security case is about no data store you may read, so there is no exposure to assess.";

// The most exposure issues, timeline entries, grants and changes one assessment reads.
const MAX_EXPOSURE_ISSUES: number = 20;
const MAX_ISSUE_FEED_ITEMS: number = 500;
const MAX_STORE_RESPONSES: number = 100;
const MAX_GRANTS: number = 1000;
const MAX_CHANGES: number = 500;
const MAX_TASKS: number = 200;
const MAX_CASE_STORES: number = 20;

const ROOT: { isRoot: true } = { isRoot: true };

// What the store is read with: what plain code assesses, and what OneUptime AI may be told of it.
export const EXPOSURE_STORE_SELECT: {
  _id: true;
  name: true;
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  exposure: true;
  isPublicByDesign: true;
  posture: true;
  dataTypeIds: true;
  dataCategories: true;
  subjectCountries: true;
  estimatedRecords: true;
  dataSubjects: true;
  firstSeenAt: true;
  storeKey: true;
  cloudResourceId: true;
  providerResourceId: true;
  cloudAccountNumber: true;
} = {
  _id: true,
  name: true,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  exposure: true,
  isPublicByDesign: true,
  posture: true,
  dataTypeIds: true,
  dataCategories: true,
  subjectCountries: true,
  estimatedRecords: true,
  dataSubjects: true,
  firstSeenAt: true,
  storeKey: true,
  cloudResourceId: true,
  providerResourceId: true,
  cloudAccountNumber: true,
};

export interface ExposureCaseStore {
  dataStoreId: string;
  name: string;
  kind: string;
  sensitivity: string;
}

// The case as the reader may read it, its stores, and the assessment it keeps.
export interface ExposureCaseScope {
  securityCaseId: ObjectID;
  stores: Array<ExposureCaseStore>;
  stored: StoredExposureAssessment | null;
}

export interface ReadExposure {
  store: DataStore;
  view: ExposureAssessmentView;
}

function effectiveSensitivity(store: DataStore): DataSensitivity {
  const level: unknown = store.sensitivityOverride || store.sensitivity;

  return isDataSensitivity(level) ? level : DataSensitivity.Public;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default class ExposureAssessmentReader {
  /*
   * Whether a caller may read a case's exposure assessment: one who may
   * read security cases, data stores and the stores' findings.
   */
  public static mayRead(props: DatabaseCommonInteractionProps): boolean {
    return (
      props.isRoot === true ||
      (CallerPermission.holdsModelPermission(props, {
        model: new SecurityCase(),
        operation: "read",
      }) &&
        CallerPermission.holdsModelPermission(props, {
          model: new DataStore(),
          operation: "read",
        }) &&
        CallerPermission.holdsModelPermission(props, {
          model: new DataStoreFinding(),
          operation: "read",
        }))
    );
  }

  /*
   * ...and change it: start it, draft it, edit a draft, say where the
   * people live. One of its readers who may update THIS case, by its own
   * row, as an update of it through the API would decide
   * (SecurityCaseService.findOneUpdatableById): the assessment is a column
   * of the case, written as OneUptime, and holding a case-editing permission
   * somewhere in the project does not decide a change of one case - a
   * credential issued for reading only changes none, whatever its roles
   * (TableHalfWriteGuard).
   */
  public static async mayChange(data: {
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (data.props.isRoot === true) {
      return true;
    }

    if (!ExposureAssessmentReader.mayRead(data.props)) {
      return false;
    }

    try {
      return Boolean(
        await SecurityCaseService.findOneUpdatableById({
          id: data.securityCaseId,
          select: { _id: true },
          props: data.props,
        }),
      );
    } catch (error) {
      // A caller who may not update security cases at all, or not on their plan.
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * The case as the caller may read it, the stores it is about that they
   * may read, and the assessment it keeps. A caller who may not read the
   * store's findings is refused before anything is read.
   */
  @CaptureSpan()
  public static async readScope(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExposureCaseScope> {
    if (!ExposureAssessmentReader.mayRead(data.props)) {
      throw new NotAuthorizedException(READ_REFUSED_MESSAGE);
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: { _id: true, entities: true },
        props: data.props,
      });

    if (!securityCase) {
      throw new NotFoundException("Security case not found.");
    }

    const kept: SecurityCase | null = await SecurityCaseService.findOneBy({
      query: { _id: data.securityCaseId, projectId: data.projectId },
      select: { _id: true, exposureAssessment: true },
      props: ROOT,
    });
    const stored: StoredExposureAssessment | null =
      readStoredExposureAssessment(kept?.exposureAssessment);
    const storeKeys: Array<string> = [
      ...new Set(
        readSecurityEntities(securityCase.entities)
          .filter((entity: SecurityEntity): boolean => {
            return entity.type === SecurityEntityType.DataStore;
          })
          .map((entity: SecurityEntity): string => {
            return getDataStoreKeyOfEntityValue(entity.value);
          })
          .filter(Boolean),
      ),
    ].slice(0, MAX_CASE_STORES);
    const readable: Array<DataStore> = [];

    if (storeKeys.length > 0) {
      readable.push(
        ...(await DataStoreService.findBy({
          query: {
            projectId: data.projectId,
            storeKey: new Includes(storeKeys),
            isArchived: false,
          },
          select: {
            _id: true,
            name: true,
            kind: true,
            sensitivity: true,
            sensitivityOverride: true,
          },
          skip: 0,
          limit: MAX_CASE_STORES,
          props: data.props,
        })),
      );
    }

    // The store the assessment is about, though the case no longer names it.
    if (
      stored &&
      !readable.some((store: DataStore): boolean => {
        return store.id?.toString() === stored.dataStoreId;
      })
    ) {
      const assessedStore: DataStore | null = await DataStoreService.findOneBy({
        query: {
          _id: new ObjectID(stored.dataStoreId),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          kind: true,
          sensitivity: true,
          sensitivityOverride: true,
        },
        props: data.props,
      });

      if (!assessedStore) {
        throw new NotAuthorizedException(READ_REFUSED_MESSAGE);
      }

      readable.push(assessedStore);
    }

    return {
      securityCaseId: data.securityCaseId,
      stores: readable
        .filter((store: DataStore): boolean => {
          return Boolean(store.id);
        })
        .map((store: DataStore): ExposureCaseStore => {
          return {
            dataStoreId: store.id!.toString(),
            name: store.name || "",
            kind: store.kind || "",
            sensitivity: effectiveSensitivity(store),
          };
        }),
      stored,
    };
  }

  /*
   * Everything plain code assesses an exposure from, read as OneUptime -
   * the caller's reads of the case and the store passed already
   * (readScope) - and worked out.
   */
  @CaptureSpan()
  public static async readView(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    dataStoreId: ObjectID;
    placesNamed?: ReadonlyArray<BreachPlace> | undefined;
    now?: Date | undefined;
  }): Promise<ReadExposure> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: EXPOSURE_STORE_SELECT,
      props: ROOT,
    });

    if (!store?.id) {
      throw new NotFoundException(NOT_ABOUT_A_STORE_MESSAGE);
    }

    const issues: Array<DataSecurityIssue> =
      await ExposureAssessmentReader.readExposureIssues({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        dataStoreId: store.id,
      });
    const timelines: Map<
      string,
      Array<ExposureIssueEntry>
    > = await ExposureAssessmentReader.readIssueTimelines({
      projectId: data.projectId,
      issues,
    });
    const issueFacts: Array<ExposureIssueFacts> = issues.map(
      (issue: DataSecurityIssue): ExposureIssueFacts => {
        const id: string = issue.id!.toString();

        return {
          id,
          checkId: issue.checkId || "",
          title: issue.title || "",
          severity: issue.severity || "",
          status: issue.status || "",
          firstDetectedAt: issue.firstDetectedAt || null,
          resolvedAt: issue.resolvedAt || null,
          timeline: timelines.get(id) || [],
        };
      },
    );
    const firstFound: number = Math.min(
      ...issueFacts
        .map((issue: ExposureIssueFacts): number => {
          return issue.firstDetectedAt
            ? new Date(issue.firstDetectedAt).getTime()
            : now.getTime();
        })
        .concat([now.getTime()]),
    );
    const window: ExposureWindow | null = getExposureWindow({
      issues: issueFacts,
      changes: await ExposureAssessmentReader.readStoreChanges({
        projectId: data.projectId,
        store,
        since: new Date(
          firstFound - EXPOSING_CHANGE_LOOKBACK_IN_DAYS * 24 * 60 * 60 * 1000,
        ),
        until: now,
      }),
      responses: await ExposureAssessmentReader.readStoreResponses({
        projectId: data.projectId,
        dataStoreId: store.id,
      }),
      storeFirstSeenAt: store.firstSeenAt || null,
      now,
    });
    const grants: Array<ExposureGrant> =
      await ExposureAssessmentReader.readGrants({
        projectId: data.projectId,
        dataStoreId: store.id,
      });
    const reads: ExposureReads = getExposureReads({
      accessLogging: store.posture?.accessLogging,
      exposureCheckIds: issueFacts.map((issue: ExposureIssueFacts): string => {
        return issue.checkId;
      }),
      isStorePublic: store.exposure === DataStoreExposure.Public,
      grants,
      window,
      now,
    });
    const location: CloudRegionLocation | null = getCloudRegionLocation(
      store.region,
    );
    const whose: ExposureWhoseData = getWhoseData({
      dataTypes: await ExposureAssessmentReader.readDataTypes({
        projectId: data.projectId,
        dataTypeIds: store.dataTypeIds || [],
      }),
      estimatedRecords: store.estimatedRecords,
      subjectCountries: store.subjectCountries || [],
      placesNamed: data.placesNamed,
      region: store.region,
      regionCountry: location?.country || undefined,
      regionIsInEea: location ? location.isInEea : undefined,
      people: (store.dataSubjects || []).map((people: string): string => {
        return people;
      }),
    });
    const rotate: { found: Array<ExposureSecret>; hasMore: boolean } =
      await ExposureAssessmentReader.readSecretsToRotate({
        projectId: data.projectId,
        dataStoreId: store.id,
        window,
      });

    return {
      store,
      view: buildExposureAssessmentView({
        store: {
          id: store.id.toString(),
          name: store.name || "",
          kind: store.kind || "",
          provider: store.provider || undefined,
          region: store.region || undefined,
          environment: store.environment || undefined,
          sensitivity: effectiveSensitivity(store),
          exposure: store.exposure || DataStoreExposure.Unknown,
        },
        exposureIssues: issues.map(
          (issue: DataSecurityIssue): ExposureIssueView => {
            return {
              id: issue.id!.toString(),
              checkId: issue.checkId || "",
              title: issue.title || "",
              severity: issue.severity || "",
              status: issue.status || "",
              firstDetectedAt: toIso(issue.firstDetectedAt),
              resolvedAt: toIso(issue.resolvedAt),
            };
          },
        ),
        window,
        reads,
        whose,
        secretsToRotate: rotate.found,
        hasMoreSecrets: rotate.hasMore,
        now,
      }),
    };
  }

  /*
   * The store's exposure issues: those the case holds, else the store's
   * own - a case a person opened, or one about a store whose issue joined
   * another case.
   */
  public static async readExposureIssues(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<DataSecurityIssue>> {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
          checkId: new Includes([...EXPOSURE_CHECK_IDS]),
        },
        select: {
          _id: true,
          checkId: true,
          title: true,
          severity: true,
          status: true,
          firstDetectedAt: true,
          resolvedAt: true,
          securityCaseId: true,
        },
        sort: { firstDetectedAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_EXPOSURE_ISSUES,
        props: ROOT,
      });
    const ofCase: Array<DataSecurityIssue> = issues.filter(
      (issue: DataSecurityIssue): boolean => {
        return (
          issue.securityCaseId?.toString() === data.securityCaseId.toString()
        );
      },
    );

    return (ofCase.length > 0 ? ofCase : issues).filter(
      (issue: DataSecurityIssue): boolean => {
        return Boolean(issue.id);
      },
    );
  }

  // When each issue opened, reopened and resolved, from its timeline.
  public static async readIssueTimelines(data: {
    projectId: ObjectID;
    issues: ReadonlyArray<DataSecurityIssue>;
  }): Promise<Map<string, Array<ExposureIssueEntry>>> {
    const timelines: Map<string, Array<ExposureIssueEntry>> = new Map();

    if (data.issues.length === 0) {
      return timelines;
    }

    const events: Record<string, ExposureIssueEvent> = {
      [DataSecurityIssueFeedEventType.IssueOpened]: ExposureIssueEvent.Opened,
      [DataSecurityIssueFeedEventType.Reopened]: ExposureIssueEvent.Reopened,
      [DataSecurityIssueFeedEventType.Resolved]: ExposureIssueEvent.Resolved,
    };
    const items: Array<DataSecurityIssueFeed> =
      await DataSecurityIssueFeedService.findBy({
        query: {
          projectId: data.projectId,
          dataSecurityIssueId: new Includes(
            data.issues.map((issue: DataSecurityIssue): ObjectID => {
              return issue.id!;
            }),
          ),
          dataSecurityIssueFeedEventType: new Includes(Object.keys(events)),
        },
        select: {
          _id: true,
          dataSecurityIssueId: true,
          dataSecurityIssueFeedEventType: true,
          postedAt: true,
          createdAt: true,
        },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_ISSUE_FEED_ITEMS,
        props: ROOT,
      });

    for (const item of items) {
      const id: string = item.dataSecurityIssueId?.toString() || "";
      const event: ExposureIssueEvent | undefined =
        events[item.dataSecurityIssueFeedEventType || ""];
      const at: Date | undefined = item.postedAt || item.createdAt;

      if (!id || !event || !at) {
        continue;
      }

      timelines.set(id, [...(timelines.get(id) || []), { event, at }]);
    }

    return timelines;
  }

  // Data Security's own responses that closed the store: Block public access, Revoke sharing.
  public static async readStoreResponses(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<ExposureResponseEntry>> {
    const items: Array<DataStoreFeed> = await DataStoreFeedService.findBy({
      query: {
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        dataStoreFeedEventType: DataStoreFeedEventType.ResponseActionTaken,
      },
      select: {
        _id: true,
        feedInfoInMarkdown: true,
        postedAt: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      skip: 0,
      limit: MAX_STORE_RESPONSES,
      props: ROOT,
    });

    return items
      .map((item: DataStoreFeed): ExposureResponseEntry | null => {
        const read: {
          action: DataSecurityResponseAction;
          changed: boolean;
        } | null = readResponseActionOfStoreFeed(item.feedInfoInMarkdown || "");
        const at: Date | undefined = item.postedAt || item.createdAt;

        if (!read || !at) {
          return null;
        }

        return {
          at,
          closesExposure:
            read.changed && EXPOSURE_RESPONSE_ACTIONS.includes(read.action),
        };
      })
      .filter(
        (
          entry: ExposureResponseEntry | null,
        ): entry is ExposureResponseEntry => {
          return entry !== null;
        },
      );
  }

  /*
   * The changes of the cloud's log that moved who can reach the store,
   * between two moments: read from the change events by their time, the
   * way the change signals read them, and matched to the store as they
   * match them. Best effort: a log that cannot be read gives none, and the
   * window then says "at least since".
   */
  public static async readStoreChanges(data: {
    projectId: ObjectID;
    store: DataStore;
    since: Date;
    until: Date;
  }): Promise<Array<ExposureStoreChange>> {
    try {
      const statement: Statement = SQL`SELECT toUnixTimestamp64Milli(time) AS timeInMs, attributes FROM `;
      statement.append(
        `${getClickhouseDatabaseName()}.${AnalyticsTableName.ChangeEvent}`,
      );
      statement.append(
        SQL` WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
        }} AND time >= ${{
          type: TableColumnType.DateTime64,
          value: data.since,
        }} AND time <= ${{
          type: TableColumnType.DateTime64,
          value: data.until,
        }} AND attributes[${{
          type: TableColumnType.Text,
          value: ChangeEventAttribute.Source,
        }}] = ${{
          type: TableColumnType.Text,
          value: ChangeEventSource.Cloud,
        }} AND attributes[${{
          type: TableColumnType.Text,
          value: ChangeEventAttribute.CloudOperation,
        }}] IN ${{
          type: TableColumnType.ArrayText,
          value: getExposureChangeOperations(),
        }} AND retentionDate >= now() ORDER BY time ASC LIMIT ${{
          type: TableColumnType.Number,
          value: MAX_CHANGES,
        }}`,
      );
      statement.append(
        getQuerySettings({
          maxExecutionTimeInSeconds: 30,
          timeoutOverflowMode: "throw",
        }),
      );

      const result: Results = await ChangeEventService.executeQuery(statement);
      const response: ResponseJSON<JSONObject> =
        await result.json<JSONObject>();
      const matcher: DataStoreChangeMatcher = new DataStoreChangeMatcher([
        data.store as DataStoreForSignal,
      ]);
      const changes: Array<ExposureStoreChange> = [];

      for (const row of response.data || []) {
        const change: PostureChange | null = readPostureChange(row);

        if (!change || !matcher.match(change)) {
          continue;
        }

        const direction: ExposureChangeDirection | null =
          getExposureChangeDirection({
            operation: change.operation,
            grantsAccess: change.grantsAccess,
          });

        if (!direction) {
          continue;
        }

        changes.push({
          time: change.time,
          operation: change.operation,
          direction,
          failed: change.failed,
          madeByOneUptime: change.madeByOneUptime,
        });
      }

      return changes;
    } catch (error) {
      logger.error(
        `DataSecurity: could not read the change log around store ${data.store.id?.toString()}'s exposure; its window says "at least since": ${error}`,
      );
      return [];
    }
  }

  // Who can reach the store, as grants: their principals are counted, never named.
  public static async readGrants(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Array<ExposureGrant>> {
    const grants: Array<DataStoreAccess> = await DataStoreAccessService.findBy({
      query: { projectId: data.projectId, dataStoreId: data.dataStoreId },
      select: {
        _id: true,
        principal: true,
        isExternal: true,
        isPublic: true,
        isSeenInTraces: true,
        lastUsedAt: true,
      },
      skip: 0,
      limit: MAX_GRANTS,
      props: ROOT,
    });

    return grants
      .filter((grant: DataStoreAccess): boolean => {
        // A service traces saw using it is the company's own.
        return grant.isSeenInTraces !== true && Boolean(grant.principal);
      })
      .map((grant: DataStoreAccess): ExposureGrant => {
        return {
          principal: grant.principal || "",
          isExternal: grant.isExternal === true,
          isPublic: grant.isPublic === true,
          lastUsedAt: grant.lastUsedAt || null,
        };
      });
  }

  // The store's data types, by the project's names for them and their categories.
  public static async readDataTypes(data: {
    projectId: ObjectID;
    dataTypeIds: ReadonlyArray<string>;
  }): Promise<Array<ExposureDataType>> {
    const customs: Array<DataSecurityCustomDataType> = data.dataTypeIds.some(
      (id: string): boolean => {
        return !getBuiltInDataType(id);
      },
    )
      ? await DataSecurityCustomDataTypeService.findBy({
          query: { projectId: data.projectId },
          select: { _id: true, name: true, category: true },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: ROOT,
        })
      : [];
    const names: Map<string, string> = new Map();
    const categories: Map<string, string> = new Map();

    for (const custom of customs) {
      if (!custom.id) {
        continue;
      }

      const id: string = customDataTypeId(custom.id.toString());

      names.set(id, custom.name || "");

      if (custom.category) {
        categories.set(id, custom.category);
      }
    }

    const namer: DataTypeNamer = new DataTypeNamer(names);

    return [...new Set(data.dataTypeIds)].map(
      (id: string): ExposureDataType => {
        return {
          id,
          name: namer.nameOf(id),
          category:
            getBuiltInDataType(id)?.category || categories.get(id) || "",
        };
      },
    );
  }

  /*
   * The secrets found in the store that were there while it was exposed:
   * each type and where, never a sample - a secret fixed before the window
   * opened was never exposed. The most recent first.
   */
  public static async readSecretsToRotate(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    window: ExposureWindow | null;
  }): Promise<{ found: Array<ExposureSecret>; hasMore: boolean }> {
    const findings: Array<DataStoreFinding> =
      await DataStoreFindingService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
          dataCategory: DataCategory.SecretsAndCredentials,
          isSuppressed: false,
        },
        select: {
          _id: true,
          dataTypeId: true,
          dataTypeName: true,
          location: true,
          locationKind: true,
          lastSeenAt: true,
          fixedAt: true,
        },
        sort: { lastSeenAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_EXPOSURE_SECRETS * 2,
        props: ROOT,
      });
    const opened: number | null = data.window
      ? new Date(data.window.start).getTime()
      : null;
    const exposed: Array<ExposureSecret> = findings
      .filter((finding: DataStoreFinding): boolean => {
        if (!finding.fixedAt || opened === null) {
          return true;
        }

        return new Date(finding.fixedAt).getTime() >= opened;
      })
      .map((finding: DataStoreFinding): ExposureSecret => {
        return {
          dataTypeId: finding.dataTypeId || "",
          dataTypeName: finding.dataTypeName || finding.dataTypeId || "",
          location: finding.location || "",
          locationKind: finding.locationKind || undefined,
          isStillThere: !finding.fixedAt,
        };
      });

    return {
      found: exposed.slice(0, MAX_EXPOSURE_SECRETS),
      hasMore: exposed.length > MAX_EXPOSURE_SECRETS,
    };
  }

  /*
   * The playbook's checklist, matched to the case's tasks as the caller
   * may read them: a caller who may not read the case's tasks sees each
   * line without its task.
   */
  public static async readChecklist(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<ExposureChecklistAnswer>> {
    let tasks: Array<SecurityCaseTask> = [];

    try {
      tasks = await SecurityCaseTaskService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: { _id: true, title: true, responseStepKey: true, isDone: true },
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: MAX_TASKS,
        props: data.props,
      });
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }
    }

    return getExposureChecklistAnswers(
      tasks
        .filter((task: SecurityCaseTask): boolean => {
          return Boolean(task.id);
        })
        .map((task: SecurityCaseTask) => {
          return {
            id: task.id!.toString(),
            title: task.title,
            responseStepKey: task.responseStepKey,
            isDone: task.isDone,
          };
        }),
    );
  }
}
