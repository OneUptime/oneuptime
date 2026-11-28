import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../Models/DatabaseModels/DataStoreFinding";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityIssueCodeFixJSON,
  DataSecurityResponseResult,
  DataSecurityScrubImpact,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import DataSecurityIssueCodeFix from "./DataSecurityIssueCodeFix";
import {
  ALL_DATA_SECURITY_RESPONSE_ACTIONS,
  isDataSecurityResponseAction,
} from "../../../Types/DataSecurity/DataSecurityResponseAction";
import { isTelemetryFindingCheck } from "../../../Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStoreKind,
  TELEMETRY_DATA_STORE_KINDS,
} from "../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import DataSecurityIssueService from "../../Services/DataSecurityIssueService";
import DataStoreFindingService from "../../Services/DataStoreFindingService";
import DataStoreService from "../../Services/DataStoreService";
import { DataSecurityAiCodeRequest } from "../AI/DataSecurity/DataSecurityAiInput";
import DataSecurityAiReads from "../AI/DataSecurity/DataSecurityAiReads";
import DataSecurityCodeTask, {
  DataSecurityFixCode,
} from "../AI/DataSecurity/DataSecurityCodeTask";
import { buildDataSecurityFixRequest } from "../AI/DataSecurity/DataSecurityIssuePrompt";
import ProjectDataTypeNames from "./ProjectDataTypeNames";
import DataSecurityResponse from "./DataSecurityResponse";
import { queueDataSecurityEvaluation } from "./DataSecurityJobs";
import TelemetryLeakFix from "./TelemetryLeakFix";
import {
  CreatedScrubRule,
  getScrubCoverage,
  isFindingScrubbed,
  readFindingServiceId,
  readFoundByOf,
} from "./Telemetry/TelemetryScrubCoverage";
import { getScrubItImpact } from "./Telemetry/TelemetryScrubImpact";
import { scrubFindingWithProvenRule } from "./Telemetry/TelemetryScrubIt";

/*
 * WHAT DATA SECURITY'S BUTTONS DO ON THE SERVER, IN ONE PLACE (#10378).
 *
 * Scrub It, Fix it from here's response actions and Fix with AI are routes
 * of Data Security's own (Server/API/DataSecurityAPI), and Ask AI's actions
 * that stand in for them (Server/Utils/AI/Toolbox/DataSecurity*Tools) - in
 * the chat, and through the MCP server - make the very same changes. So
 * each route's work lives here, and the route and the action both call it:
 * a change to what a button does changes its action with it, and the two
 * cannot drift. The buttons that are a plain write of a record (Confirm,
 * Not Sensitive, Accept Risk, Not an Issue, Reopen, Assign, a store's
 * owners) write through CrudRouteWrites, as the API's CRUD route does; the
 * rest call the utility their route calls (DataSecurityAiProposals,
 * FindingApplyToSimilar).
 *
 * The lists below are who may press each button: the route's permission
 * list, and the action's - the toolbox asks for them before it runs one
 * (AIToolbox.refuseByGates), so both refuse the same people.
 *
 * Each reads the record it acts on as the caller first: a record they may
 * not read is not found, by the button and by the action alike - before,
 * the scrub and response routes read the record as OneUptime, and so let a
 * role whose reach is held to some labels act on a store outside them.
 */

// Reads Data Security: the Overview, compliance, which response actions a store can take.
export const DATA_SECURITY_READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.SecurityViewer,
  Permission.ReadDataStore,
];

// Changes a store: Scan Now, Check Now, a response action.
export const DATA_SECURITY_OPERATE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataStore,
];

/*
 * Who may make a scrub rule of any signal - a log or trace scrub rule, or
 * the metric pipeline rule that redacts a metric's attribute; the rule
 * itself is made with the person's own permissions, so a log rule still
 * needs the log permission, a trace rule the trace one and a metric rule
 * the metric pipeline rule one.
 */
export const DATA_SECURITY_SCRUB_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectLogScrubRule,
  Permission.CreateProjectTraceScrubRule,
  Permission.CreateProjectMetricPipelineRule,
];

// Changes an issue: Fix with AI, and its fix plan.
export const DATA_SECURITY_ISSUE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.SecurityAdmin,
  Permission.SecurityMember,
  Permission.EditDataSecurityIssue,
];

/*
 * Who may press on a proposal of OneUptime AI's (#10364): who may read it,
 * the issue's readers. Each press then takes the change's own permission
 * (DataSecurityAiProposals), so a reader who may make no change is refused
 * with what it takes.
 */
export const DATA_SECURITY_AI_PROPOSAL_PERMISSIONS: Array<Permission> = [
  ...new DataSecurityAiProposal().readRecordPermissions,
];

/*
 * Who may apply a decision to the findings like one (#10372): who may
 * change findings. Each finding is then read and changed with the
 * person's own permissions, store by store.
 */
export const DATA_SECURITY_APPLY_TO_SIMILAR_PERMISSIONS: Array<Permission> = [
  ...new DataStoreFinding().updateRecordPermissions,
];

// What Fix with AI answers while the issue's fix is on its way.
export const ISSUE_FIX_ON_ITS_WAY_MESSAGE: string =
  "OneUptime AI is already writing this fix, or its pull request waits for review. Follow it in Code.";

// The states of a fix in code that is on its way (DeclaredCodeChangeState's words).
export const FIX_ON_ITS_WAY_STATES: ReadonlyArray<string> = [
  "writing",
  "opened",
  "waiting",
];

/*
 * A telemetry finding a button acts on - Scrub It, Drop This Metric - with
 * its data type, its place and its store's kind and service. A finding the
 * caller may not read, another project's, or one in a data store, is
 * refused.
 */
export async function readTelemetryFindingForCaller(data: {
  projectId: ObjectID;
  findingId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<DataStoreFinding> {
  // The caller's own read first: a finding they may not read is not found.
  const readable: DataStoreFinding | null =
    await DataStoreFindingService.findOneBy({
      query: { _id: data.findingId, projectId: data.projectId },
      select: { _id: true },
      props: data.props,
    });

  if (!readable?.id) {
    throw new BadDataException("Finding not found.");
  }

  // Its store's kind and key, which its reader's role may not read.
  const finding: DataStoreFinding | null =
    await DataStoreFindingService.findOneBy({
      query: { _id: data.findingId, projectId: data.projectId },
      select: {
        _id: true,
        dataTypeId: true,
        // What a rule calls the type when the project no longer names it.
        dataTypeName: true,
        location: true,
        dataStoreId: true,
        // Its key names its service, for a store kept without one (#10433).
        dataStore: { kind: true, serviceId: true, storeKey: true },
        // How its values were found says whether a rule hides them (#11502).
        isFoundByContext: true,
        isFoundByModel: true,
      },
      props: { isRoot: true },
    });

  if (!finding?.dataTypeId || !finding.location || !finding.dataStore?.kind) {
    throw new BadDataException("Finding not found.");
  }

  if (
    !TELEMETRY_DATA_STORE_KINDS.includes(
      finding.dataStore.kind as DataStoreKind,
    )
  ) {
    throw new BadDataException(
      "Scrub It hides data in telemetry as it arrives; this finding is in a data store, not in telemetry.",
    );
  }

  return finding;
}

/*
 * A store a button acts on, in the project, read as the caller first: one
 * they may not read is not found.
 */
export async function readStoreForCaller(data: {
  projectId: ObjectID;
  dataStoreId: ObjectID;
  props: DatabaseCommonInteractionProps;
}): Promise<DataStore> {
  const readable: DataStore | null = await DataStoreService.findOneBy({
    query: { _id: data.dataStoreId, projectId: data.projectId },
    select: { _id: true },
    props: data.props,
  });

  if (!readable?.id) {
    throw new BadDataException("Data store not found.");
  }

  const store: DataStore | null = await DataStoreService.findOneBy({
    query: { _id: data.dataStoreId, projectId: data.projectId },
    select: { _id: true, cloudConnectionId: true },
    props: { isRoot: true },
  });

  if (!store?.id) {
    throw new BadDataException("Data store not found.");
  }

  return store;
}

export default class DataSecurityButtons {
  /*
   * The telemetry finding Scrub It acts on, as its route reads it - read as
   * the caller first (readTelemetryFindingForCaller). A read.
   */
  public static async getTelemetryFinding(data: {
    projectId: ObjectID;
    findingId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataStoreFinding> {
    return await readTelemetryFindingForCaller(data);
  }

  /*
   * SCRUB IT on a telemetry finding (#10366, #10433): the enabled rule that
   * already hides it, or the proven, narrow rule for it - the one the
   * dialog showed, proven on the records it was seen in - made with the
   * caller's own permissions; then the finding is marked scrubbed and the
   * project checked again.
   */
  public static async scrubFinding(data: {
    projectId: ObjectID;
    findingId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<CreatedScrubRule & { isProven: boolean }> {
    const finding: DataStoreFinding = await readTelemetryFindingForCaller(data);

    const created: CreatedScrubRule & { isProven: boolean } =
      await scrubFindingWithProvenRule({
        projectId: data.projectId,
        userId: data.props.userId || undefined,
        // A project API key makes the rule with its own props, never as OneUptime.
        callerProps: data.props,
        findingId: finding.id!.toString(),
        kind: finding.dataStore!.kind as DataStoreKind,
        dataTypeId: finding.dataTypeId!,
        dataTypeName: finding.dataTypeName,
        location: finding.location!,
        // The rule is its service's: a metric's always was, a log's or a span's since #10433.
        serviceId: finding.dataStore!.serviceId || null,
        storeKey: finding.dataStore!.storeKey || null,
      });

    /*
     * Scrubbed when a rule now hides what it found: the one made, or the
     * one that already did. A rule of the type's shapes, made where nothing
     * could be proven, keeps what was found only beside its words (#11502),
     * and the finding says so.
     */
    await DataStoreFindingService.updateColumnsByIdWithoutHooks({
      id: finding.id!,
      data: {
        isScrubbed: isFindingScrubbed(await getScrubCoverage(data.projectId), {
          kind: finding.dataStore!.kind as DataStoreKind,
          dataTypeId: finding.dataTypeId!,
          location: finding.location!,
          serviceId:
            readFindingServiceId({
              kind: finding.dataStore!.kind,
              serviceId: finding.dataStore!.serviceId || null,
              storeKey: finding.dataStore!.storeKey || null,
            }) || finding.dataStore!.serviceId,
          ...readFoundByOf(finding),
        }),
      },
    });
    await queueDataSecurityEvaluation(data.projectId);

    return created;
  }

  /*
   * What Scrub It would do (#10433): the rule it would make - its action,
   * the parts of the records it scrubs and whose - and what that rule
   * would take away from what reads the data, before it is made. Named as
   * the caller may read it; the rest counted.
   */
  public static async getScrubImpact(data: {
    projectId: ObjectID;
    findingId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityScrubImpact> {
    const finding: DataStoreFinding = await readTelemetryFindingForCaller(data);

    return await getScrubItImpact({
      projectId: data.projectId,
      kind: finding.dataStore!.kind as DataStoreKind,
      dataTypeId: finding.dataTypeId!,
      dataTypeName: finding.dataTypeName,
      location: finding.location!,
      serviceId: finding.dataStore!.serviceId || null,
      storeKey: finding.dataStore!.storeKey || null,
      findingId: finding.id!.toString(),
      props: data.props,
    });
  }

  /*
   * A RESPONSE ACTION on a store - Block public access, Revoke sharing and
   * the rest of Fix it from here - through its cloud connection, with the
   * issue it was run from: only one of this store's, never another store's,
   * whose timeline would then claim a change it did not see.
   */
  public static async respond(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    action: unknown;
    dataSecurityIssueId?: unknown;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityResponseResult> {
    const store: DataStore = await readStoreForCaller(data);

    if (!isDataSecurityResponseAction(data.action)) {
      throw new BadDataException(
        `Choose one of the response actions: ${ALL_DATA_SECURITY_RESPONSE_ACTIONS.map(
          (name: string): string => {
            return `"${name}"`;
          },
        ).join(", ")}.`,
      );
    }

    const issueId: ObjectID | undefined = await this.readIssueOfStore({
      projectId: data.projectId,
      dataStoreId: store.id!,
      value: data.dataSecurityIssueId,
    });

    return (await DataSecurityResponse.run({
      projectId: data.projectId,
      dataStoreId: store.id!,
      action: data.action,
      userId: data.props.userId || undefined,
      dataSecurityIssueId: issueId,
    })) as unknown as DataSecurityResponseResult;
  }

  /*
   * FIX WITH AI on an issue (#10362): a pull request that fixes it, asked
   * of OneUptime AI as the caller - in a repository they may change in
   * Code, and only when AI can work there now (DataSecurityCodeTask). A
   * service's telemetry issue (#10367) gets one pull request for every
   * open telemetry leak of the service, from the places its records name -
   * the plan the person was shown, held to it.
   */
  public static async fixIssueWithAi(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
    codeRepositoryId?: unknown;
    expectedPlanFingerprint?: unknown;
  }): Promise<JSONObject> {
    // The caller's own read first: an issue they may not read is not found.
    const readable: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true },
        props: data.props,
      });

    if (!readable?.id) {
      throw new BadDataException("Data security issue not found.");
    }

    const issue: DataSecurityIssue = await DataSecurityAiReads.readIssue({
      projectId: data.projectId,
      issueId: data.issueId,
    });

    // A service's telemetry issue, or a RUM application's front-end one (#10933).
    if (
      await TelemetryLeakFix.ownerOfIssue({
        projectId: data.projectId,
        issue,
      })
    ) {
      return (await TelemetryLeakFix.runForIssue({
        projectId: data.projectId,
        issueId: issue.id!,
        props: data.props,
        codeRepositoryId: data.codeRepositoryId,
        expectedPlanFingerprint: data.expectedPlanFingerprint,
      })) as unknown as JSONObject;
    }

    /*
     * One fix of an issue at a time, as a telemetry issue's fix holds to
     * (TelemetryLeakFix.start): a second press while the first is being
     * written, is open for review or waits on someone returns it, rather
     * than start a second task, a second pull request and a second bill.
     */
    const fixOnItsWay: DataSecurityIssueCodeFixJSON | null =
      await this.readFixOnItsWay({
        projectId: data.projectId,
        issueId: issue.id!,
        props: data.props,
      });

    if (fixOnItsWay) {
      return {
        message: ISSUE_FIX_ON_ITS_WAY_MESSAGE,
      } as unknown as JSONObject;
    }

    return (await DataSecurityCodeTask.requestFix({
      props: data.props,
      projectId: data.projectId,
      issueIds: [issue.id!],
      // A telemetry issue is fixed in the service's code, any other in infrastructure code.
      code: isTelemetryFindingCheck(issue.checkId)
        ? DataSecurityFixCode.Service
        : DataSecurityFixCode.Infrastructure,
      requestedRepositoryId: data.codeRepositoryId,
      // The request as DataSecurityAiInput builds it (#10365).
      buildMessage: async (): Promise<DataSecurityAiCodeRequest> => {
        return buildDataSecurityFixRequest(
          issue,
          await DataSecurityAiReads.readPlaces({
            projectId: data.projectId,
            issue,
          }),
          await ProjectDataTypeNames.read({ projectId: data.projectId }),
        );
      },
    })) as unknown as JSONObject;
  }

  /*
   * The issue's fix in code while it is on its way - being written, open
   * for review, or waiting on someone - as the issue's page reads it
   * (DataSecurityIssueCodeFix); null when there is none, or it ended,
   * failed or was hidden.
   */
  public static async readFixOnItsWay(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueCodeFixJSON | null> {
    const fix: DataSecurityIssueCodeFixJSON | null = (
      await DataSecurityIssueCodeFix.read({
        projectId: data.projectId,
        issueId: data.issueId,
        props: data.props,
      })
    ).fix;

    return fix && FIX_ON_ITS_WAY_STATES.includes(fix.state) ? fix : null;
  }

  /*
   * The issue a response was run from, when the request names one: one of
   * this store's, in this project - never another store's.
   */
  private static async readIssueOfStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    value: unknown;
  }): Promise<ObjectID | undefined> {
    if (data.value === undefined || data.value === null || data.value === "") {
      return undefined;
    }

    if (typeof data.value !== "string" || !ObjectID.isValidUUID(data.value)) {
      throw new BadDataException("Issue not found.");
    }

    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: {
          _id: new ObjectID(data.value),
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    if (!issue?.id) {
      throw new BadDataException("Issue not found.");
    }

    return issue.id;
  }
}
