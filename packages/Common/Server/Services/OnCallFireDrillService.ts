import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallTestPageEvents from "../Utils/OnCall/OnCallTestPageEvents";
import BaseService from "./BaseService";
import OnCallDutyPolicyExecutionLogService, {
  OnCallFireDrillOfRun,
} from "./OnCallDutyPolicyExecutionLogService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_POLICY_LIMIT_NAMESPACE,
  OnCallTestPageLimitKey,
} from "./OnCallTestPageService";
import WhoIsToldService from "./WhoIsToldService";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  WhoIsToldEvent,
  WhoIsToldPolicy,
  WhoIsToldResult,
} from "../../Types/Monitor/WhoIsTold";
import ObjectID from "../../Types/ObjectID";
import {
  ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE,
  ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE,
  OnCallFireDrillEvent,
  OnCallFireDrillFailure,
  OnCallFireDrillFailureRecord,
  OnCallFireDrillPolicy,
  OnCallFireDrillPreview,
  OnCallFireDrillRun,
  OnCallFireDrillStarted,
  getOnCallFireDrillFailures,
  getOnCallFireDrillPolicyTooSoonMessage,
} from "../../Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
  OnCallTestPageCost,
  OnCallTestPageKind,
  OnCallTestPagePreview,
  OnCallTestPagePreviewLevel,
  OnCallTestPagePreviewPerson,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";

/*
 * AN ON-CALL FIRE DRILL (Types/OnCallDutyPolicy/OnCallFireDrill, #7012): a
 * monitor's failure rehearsed as a test - one policy test for each on-call
 * policy the failure pages, started together.
 *
 * Which policies a failure pages is not worked out here. It is read from
 * "When this goes down" (WhoIsToldService), which asks the same code a real
 * failure is paged by: the policies the criteria names, and the ones the
 * project's on-call rules add through the rule engines' own matching
 * (getMatchingRules). So a drill pages exactly what a failure would, and
 * follows that code wherever it goes. It is read afresh, as the caller may
 * read the monitor, both for the preview and as the drill starts: the
 * policies the drill pages are the server's, never a list the request names.
 *
 * Each policy's test is the one "Test this policy" starts
 * (OnCallDutyPolicyExecutionLogService.startPolicyTest): a run with no
 * incident or alert behind it, whose every message says TEST - so nothing
 * public or permanent happens (OnCallTestPageTouchesNothingPublic). Who may
 * test each policy the API asks as the policy's own test asks it, and how
 * often is limited by the same windows, claimed for every policy at once
 * (OnCallTestPageService.claimLimitsOfEach).
 *
 * A drill pages each policy's first level, or walks every level of each
 * (#9385) as a walked test of the policy does; its preview reads both, as
 * the policy's own test's preview does. It may rehearse the incident an
 * alert incident rule declares from an alert (#9397), which When this goes
 * down shows under the alert. Each test is kept with the drill, the monitor
 * and the failure (#9386), which OnCallFireDrillHistoryService reads back.
 */

// Whether the caller may test a policy, as its own test asks (the API's).
export type MayTestPolicy = (policyId: ObjectID) => Promise<boolean>;

export class OnCallFireDrillService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * THE MONITOR'S FAILURES A DRILL CAN REHEARSE: each incident or alert one
   * of its criteria opens that pages an on-call policy, in the order the
   * criteria are checked - read afresh, as the caller may read the monitor
   * and its policies (WhoIsToldService.getForMonitor: a policy they may not
   * read is named by nothing but its id).
   */
  public async readFailures(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<{
    monitorName: string;
    failures: Array<OnCallFireDrillFailure>;
  }> {
    const result: WhoIsToldResult = await WhoIsToldService.getForMonitor({
      projectId: data.projectId,
      monitorId: data.monitorId,
      props: data.props,
      refresh: true,
    });

    return {
      monitorName: result.monitorName,
      failures: getOnCallFireDrillFailures(result),
    };
  }

  /*
   * WHAT A DRILL WILL DO, before it starts: the monitor's failures to pick
   * from, and for the one picked (`eventKey`, or the first), each policy it
   * pages - with who that policy's first level pages now and how, and the
   * levels after it a walk reaches (#9385), read as the policy's own test
   * reads them, for each policy the caller may test - and what the whole
   * drill costs: its first levels, and at most when it walks every level.
   */
  @CaptureSpan()
  public async getPreview(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    callerUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
    eventKey?: string | undefined;
    mayTestPolicy: MayTestPolicy;
  }): Promise<OnCallFireDrillPreview> {
    const read: {
      monitorName: string;
      failures: Array<OnCallFireDrillFailure>;
    } = await this.readFailures(data);

    if (read.failures.length === 0) {
      throw new BadDataException(ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE);
    }

    const failure: OnCallFireDrillFailure | undefined = data.eventKey
      ? read.failures.find((each: OnCallFireDrillFailure): boolean => {
          return each.key === data.eventKey;
        })
      : read.failures[0];

    if (!failure) {
      throw new BadDataException(ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE);
    }

    const severityId: ObjectID = readSeverityId(failure.event);
    const policies: Array<OnCallFireDrillPolicy> = [];
    const people: Array<OnCallTestPagePreviewPerson> = [];
    // Who a walk of every level reaches: each first level, and each level after it.
    const walkPeople: Array<OnCallTestPagePreviewPerson> = [];

    for (const policy of failure.event.policies) {
      const policyId: ObjectID = new ObjectID(policy.id);
      const mayTest: boolean =
        !policy.isHidden && (await data.mayTestPolicy(policyId));

      if (!mayTest) {
        policies.push({
          policyId: policy.id,
          policyName: policy.isHidden ? "" : policy.name,
          mayTest: false,
        });
        continue;
      }

      // Its first level, and the levels a walk of them reaches (#9385).
      const preview: OnCallTestPagePreview =
        await OnCallTestPageService.getPreview({
          projectId: data.projectId,
          callerUserId: data.callerUserId,
          recordKind: failure.event.kind,
          severityId: severityId,
          policyId: policyId,
        });

      people.push(...preview.people);
      walkPeople.push(
        ...preview.people,
        ...(preview.walkLevels || []).flatMap(
          (level: OnCallTestPagePreviewLevel) => {
            return level.people;
          },
        ),
      );

      policies.push({
        policyId: policy.id,
        policyName: policy.name,
        mayTest: true,
        preview: preview,
      });
    }

    /*
     * Every policy's first level is paged by a run of its own: a person two
     * policies page is paged twice, and counted twice - and so is each level
     * a walk reaches, at most.
     */
    const [cost, walkCost]: Array<OnCallTestPageCost> =
      await OnCallTestPageService.getCosts({
        projectId: data.projectId,
        peopleOfEach: [people, walkPeople],
      });

    return {
      monitorId: data.monitorId.toString(),
      monitorName: read.monitorName,
      events: read.failures.map(toDrillEvent),
      eventKey: failure.key,
      policies: policies,
      cost: cost!,
      walkCost: walkCost!,
    };
  }

  /*
   * STARTS A DRILL: one test of each policy the failure pages now - read
   * afresh, never from the dialog's copy - at the failure's kind and
   * severity, each paging its first level, or walking every level when
   * asked to (#9385). Every policy must be one the caller may test
   * (`assertMayTestPolicy`, which throws), and the limits of every one of
   * them are claimed before anything is sent, all or nothing - a walk is
   * still one test of each policy. Each test is kept with the drill, the
   * monitor and the failure (#9386). Returns the drill, and each policy's
   * run to read its result by.
   */
  @CaptureSpan()
  public async start(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    sentByUserId: ObjectID;
    props: DatabaseCommonInteractionProps;
    eventKey: string;
    walksEscalation?: boolean | undefined;
    assertMayTestPolicy: (policyId: ObjectID) => Promise<void>;
  }): Promise<OnCallFireDrillStarted> {
    const read: {
      monitorName: string;
      failures: Array<OnCallFireDrillFailure>;
    } = await this.readFailures(data);

    if (read.failures.length === 0) {
      throw new BadDataException(ON_CALL_FIRE_DRILL_NOTHING_TO_PAGE_MESSAGE);
    }

    const failure: OnCallFireDrillFailure | undefined = read.failures.find(
      (each: OnCallFireDrillFailure): boolean => {
        return each.key === data.eventKey;
      },
    );

    if (!failure) {
      throw new BadDataException(ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE);
    }

    const severityId: ObjectID = readSeverityId(failure.event);
    const policies: Array<WhoIsToldPolicy> = failure.event.policies;

    // Every policy, or none: a drill that skipped one would say all is well.
    for (const policy of policies) {
      await data.assertMayTestPolicy(new ObjectID(policy.id));
    }

    for (const policy of policies) {
      await OnCallTestPageService.readPolicy({
        projectId: data.projectId,
        policyId: new ObjectID(policy.id),
      });
    }

    await OnCallTestPageService.readSeverity({
      projectId: data.projectId,
      recordKind: failure.event.kind,
      severityId: severityId,
    });

    await OnCallTestPageService.claimLimitsOfEach({
      projectId: data.projectId,
      keys: policies.map((policy: WhoIsToldPolicy): OnCallTestPageLimitKey => {
        return {
          namespace: ON_CALL_TEST_PAGE_POLICY_LIMIT_NAMESPACE,
          id: new ObjectID(policy.id),
          intervalInSeconds: ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
          tooSoonMessage: getOnCallFireDrillPolicyTooSoonMessage({
            policyName: policy.name,
            waitInSeconds: ON_CALL_TEST_PAGE_POLICY_INTERVAL_IN_SECONDS,
          }),
        };
      }),
    });

    const runs: Array<OnCallFireDrillRun> = [];

    // The drill each policy's test is kept with (#9386).
    const fireDrill: OnCallFireDrillOfRun = {
      fireDrillId: ObjectID.generate(),
      monitorId: data.monitorId,
      failure: getOnCallFireDrillFailureRecord(failure),
    };

    for (const policy of policies) {
      const executionLogId: ObjectID =
        await OnCallDutyPolicyExecutionLogService.startPolicyTest({
          projectId: data.projectId,
          onCallDutyPolicyId: new ObjectID(policy.id),
          recordKind: failure.event.kind,
          severityId: severityId,
          walksEscalation: data.walksEscalation === true,
          startedByUserId: data.sentByUserId,
          fireDrill: fireDrill,
        });

      OnCallTestPageEvents.onTestPageSent({
        projectId: data.projectId,
        executionLogId: executionLogId,
        sentByUserId: data.sentByUserId,
        kind: OnCallTestPageKind.Policy,
        recordKind: failure.event.kind,
      });

      runs.push({
        policyId: policy.id,
        policyName: policy.name,
        executionLogId: executionLogId.toString(),
      });
    }

    return { fireDrillId: fireDrill.fireDrillId.toString(), runs: runs };
  }
}

// A failure, as the dialog offers it.
function toDrillEvent(failure: OnCallFireDrillFailure): OnCallFireDrillEvent {
  const event: OnCallFireDrillEvent = {
    key: failure.key,
    criteriaName: failure.criteria.name,
    recordKind: failure.event.kind,
    severityName: failure.event.severityName,
    title: failure.event.title,
    policyCount: failure.event.policies.length,
  };

  // The incident an alert incident rule declares, its rule as the reader may read it (#9397).
  if (failure.declaration) {
    event.declaredBy = {
      ruleName: failure.declaration.rule.name,
      waitInMinutes: failure.declaration.waitInMinutes,
    };
  }

  return event;
}

/*
 * What a drill keeps of the failure it rehearsed, on each of its tests
 * (#9386): the criteria's name as it is now, and for a declared incident
 * how long its alert stays open first.
 */
export function getOnCallFireDrillFailureRecord(
  failure: Pick<OnCallFireDrillFailure, "criteria" | "declaration">,
): OnCallFireDrillFailureRecord {
  return {
    criteriaName: failure.criteria.name,
    ...(failure.declaration
      ? { declaredAfterMinutes: failure.declaration.waitInMinutes }
      : {}),
  };
}

// The severity a failure opens at: what each of its policies is tested at.
function readSeverityId(event: WhoIsToldEvent): ObjectID {
  if (!event.severityId || !ObjectID.isValidUUID(event.severityId)) {
    throw new BadDataException(ON_CALL_FIRE_DRILL_FAILURE_CHANGED_MESSAGE);
  }

  return new ObjectID(event.severityId);
}

export default new OnCallFireDrillService();
