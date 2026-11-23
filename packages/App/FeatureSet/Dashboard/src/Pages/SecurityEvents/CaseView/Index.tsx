import PageComponentProps from "../../PageComponentProps";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import MitreAttackChips from "../../../Components/SecurityCase/MitreAttackChips";
import SecurityCaseWhyOpenedCard from "../../../Components/SecurityCase/Matches/SecurityCaseWhyOpenedCard";
import useSecurityCaseMatches, {
  SecurityCaseMatchesState,
} from "../../../Components/SecurityCase/Matches/useSecurityCaseMatches";
import SecurityCaseResponsePlanCard from "../../../Components/SecurityCase/Response/SecurityCaseResponsePlanCard";
import SecurityCaseAiCard from "../../../Components/SecurityCase/SecurityCaseAiCard";
import SecurityCaseAiHoldNotice from "../../../Components/SecurityCase/AiResponse/SecurityCaseAiHoldNotice";
import SecurityCaseImpactCard from "../../../Components/SecurityCase/Context/SecurityCaseImpactCard";
import OverviewCustomFields from "../../../Components/CustomFields/OverviewCustomFields";
import {
  SecurityCaseFigures,
  getSecurityCaseFigures,
} from "../../../Components/SecurityCase/SecurityCaseFigures";
import { RESPONSE_TARGETS_TEST_IDS } from "../../../Components/SecurityCase/ResponseTargets/ResponseTargetsCopy";
import { useTargetClock } from "../../../Components/SecurityCase/ResponseTargets/SecurityCaseTargetChip";
import {
  SecurityCaseTargetNote,
  getSecurityCaseTargetNote,
  getSecurityCaseTargetToneClassName,
  readCaseTargets,
} from "../../../Components/SecurityCase/ResponseTargets/SecurityCaseTargetDisplay";
import { formatCompactDurationInMinutes } from "../../../Utils/CompactDuration";
import { CASE_TIME_TO_BLOCK } from "../../../Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import { formatTimeToBlock } from "../../../Components/SecurityEvents/AutomaticResponse/AutomaticResponseModel";
import { keepSecurityCaseTimeWhole } from "../../../Components/SecurityCase/SecurityCaseQueueViews";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import SecurityCaseCustomField from "Common/Models/DatabaseModels/SecurityCaseCustomField";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import {
  SecurityCaseTarget,
  SecurityCaseTargetReading,
} from "Common/Utils/SecurityCase/SecurityCaseTargets";
import RefusedTelemetryLines from "../../../Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryLines";
import { CASE_REFUSED } from "../../../Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryCopy";
import useProjectRefusedTelemetry from "../../../Components/SecurityEvents/RefusedTelemetry/useProjectRefusedTelemetry";
import { getRefusedTelemetryWhileCaseOpen } from "../../../Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryModel";
import { RefusedTelemetry } from "Common/Utils/SecurityEvent/RefusedTelemetry";
import Card from "Common/UI/Components/Card/Card";
import RecordActivityLine from "Common/UI/Components/Detail/RecordActivityLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import User from "Common/UI/Utils/User";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Overview: the case at a glance, under its header (drawn in full
 * here by the layout - what it is, its status steps, who has it). How many
 * detections it holds and for how long it has been worked; then the three
 * things an analyst asks first (#9556, #9557):
 *
 *   Why This Case Was Opened  the detection that opened it, how its rule
 *                             counts, the events it matched - each with the
 *                             log line, request and trace it came from -
 *                             and where to look next;
 *   Response Plan             what to do about it now: confirm it, contain
 *                             it, fix what let it happen, close it - each
 *                             step concrete to the case, one click where
 *                             OneUptime can do it, ticked off as a task;
 *
 * then what OneUptime AI made of it (not drawn at all with the project's AI
 * off), and the ATT&CK tactics and techniques its detections map to - the
 * kind of attack this is. Between the two, its Impact: what the case puts
 * at risk, as the rest of OneUptime knows it - whether OneUptime has seen it
 * reached from the internet, who owns what it names and what last changed
 * there, with what each record calls and is watched by folded away until
 * asked for.
 *
 * Under Time to Acknowledge and Time to Contain, where the case stands
 * against the response target its priority sets (Security Events >
 * Settings > Response Targets): due in, overdue by, within its target, or
 * how far over it - amber while it is about to be missed, red once it is.
 *
 * Last, the project's own fields on the case (Security Events > Settings >
 * Custom Fields), edited in place - not drawn at all while the project has
 * none, as every record's Overview draws them (OverviewCustomFields).
 *
 * Its parts are pages of their own, in the case's side menu: the Timeline,
 * the Story, the Detections, the Entities, the Evidence, the Tasks, the
 * Playbooks and the Private Notes.
 */
export const SECURITY_CASE_REFUSED_TELEMETRY_TEST_ID: string =
  "security-case-refused-telemetry";

const SecurityCaseOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const securityCase: SecurityCase = view.securityCase;
  // What the case's detections matched: the Why card and the Response Plan both draw from it.
  const matches: SecurityCaseMatchesState = useSecurityCaseMatches(
    view.caseId,
    view.refreshToggle,
  );

  const isClosed: boolean = SecurityCaseStatuses.isClosed(
    view.values.statuses,
    securityCase.securityCaseStatusId,
  );
  // Read again every half minute, so a due time counts down on the page.
  const now: Date = useTargetClock();
  // What a budget or a rate refused of what Security Events reads (#10431).
  const projectRefusals: Array<RefusedTelemetry> = useProjectRefusedTelemetry();
  const figures: SecurityCaseFigures = getSecurityCaseFigures(
    securityCase,
    now,
  );
  const targets: Array<SecurityCaseTargetReading> = readCaseTargets({
    securityCase,
    priorities: view.values.priorities,
    now,
  });

  // Where the case stands against one target, under its figure.
  const targetNote: (target: SecurityCaseTarget) => ReactElement | undefined = (
    target: SecurityCaseTarget,
  ): ReactElement | undefined => {
    const reading: SecurityCaseTargetReading | undefined = targets.find(
      (candidate: SecurityCaseTargetReading): boolean => {
        return candidate.target === target;
      },
    );
    const note: SecurityCaseTargetNote | null = reading
      ? getSecurityCaseTargetNote(reading)
      : null;

    if (!note) {
      return undefined;
    }

    return (
      <span
        className={getSecurityCaseTargetToneClassName(note.tone)}
        data-testid={RESPONSE_TARGETS_TEST_IDS.tileNote}
        data-target={target}
      >
        {translator.translateTemplate(note.template, {
          // Each kept whole where the note wraps in a narrow tile.
          time: keepSecurityCaseTimeWhole(
            formatCompactDurationInMinutes(note.minutes, translator.language),
          ),
          target: keepSecurityCaseTimeWhole(
            formatCompactDurationInMinutes(
              note.targetInMinutes,
              translator.language,
            ),
          ),
        })}
      </span>
    );
  };

  const duration: (minutes: number | null) => string = (
    minutes: number | null,
  ): string => {
    return formatCompactDurationInMinutes(minutes, translator.language);
  };

  /*
   * What an ingestion budget or rate refused of the telemetry Security
   * Events reads while the case was open (#10431): from its first detection
   * to its close, or to now - the case's detections from then may be
   * missing.
   */
  const refusedWhileOpen: Array<RefusedTelemetry> =
    getRefusedTelemetryWhileCaseOpen({
      refusals: projectRefusals,
      firstDetectedAt: securityCase.firstDetectedAt,
      createdAt: securityCase.createdAt,
      closedAt: securityCase.closedAt,
      now,
    });

  return (
    <>
      {/*
       * While OneUptime AI responds first (#10353): that it is on it, when
       * people are alerted unless it contains the case, and Page now - the
       * first thing on the page, one click away.
       */}
      <SecurityCaseAiHoldNotice caseId={view.caseId} onChanged={view.refresh} />

      {/*
       * By its own width: beside the case's side menu a laptop's window
       * leaves it too little for four tiles in a row, and their labels
       * wrapped and pushed two of the figures a line down.
       */}
      <EventStatBar
        columns={4}
        isLaidOutByOwnWidth={true}
        ariaLabel="Case figures"
        footer={
          // Who opened the case and who last changed it (#10461).
          <RecordActivityLine modelType={SecurityCase} recordId={view.caseId} />
        }
      >
        <EventStatTile
          variant="segment"
          icon={IconProp.Bolt}
          label="Detections"
          value={translator.formatNumber(securityCase.detectionCount || 0)}
          description={
            securityCase.firstDetectedAt
              ? translator.translateTemplate("First {{when}}", {
                  when: OneUptimeDate.fromNow(securityCase.firstDetectedAt),
                })
              : undefined
          }
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.Clock}
          label={isClosed ? "Took" : "Open For"}
          value={duration(figures.openForInMinutes)}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.User}
          label="Time to Acknowledge"
          value={duration(figures.timeToAcknowledgeInMinutes)}
          note={targetNote(SecurityCaseTarget.Acknowledge)}
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldCheck}
          label="Time to Contain"
          value={duration(figures.timeToContainInMinutes)}
          note={targetNote(SecurityCaseTarget.Contain)}
          // An automatic response policy blocked its address: how fast (#10350).
          description={
            typeof securityCase.timeToBlockInSeconds === "number"
              ? translator.translateTemplate(CASE_TIME_TO_BLOCK, {
                  time: formatTimeToBlock(
                    securityCase.timeToBlockInSeconds,
                    translator,
                  ),
                })
              : undefined
          }
        />
      </EventStatBar>

      <RefusedTelemetryLines
        refusals={refusedWhileOpen}
        showsSource={true}
        intro={CASE_REFUSED}
        showsOpenBudgets={true}
        dataTestId={SECURITY_CASE_REFUSED_TELEMETRY_TEST_ID}
      />

      <SecurityCaseWhyOpenedCard caseId={view.caseId} state={matches} />

      <SecurityCaseResponsePlanCard
        caseId={view.caseId}
        securityCase={securityCase}
        values={view.values}
        matches={matches.matches}
        refreshToggle={view.refreshToggle}
        isWorking={view.isWorking}
        onAssignToMe={() => {
          void view.updateCase({
            assignedToUserId: User.getUserId().toString(),
          });
        }}
        onRunPlaybook={(playbookId: ObjectID) => {
          view.runPlaybook(playbookId);
        }}
        onDeclareIncident={view.requestDeclareIncident}
        onMarkContained={() => {
          const contained: SecurityCaseStatus | null =
            SecurityCaseStatuses.getStatusOfStage(
              view.values.statuses,
              SecurityCaseStage.Contained,
            );

          if (contained?.id) {
            void view.updateCase({
              securityCaseStatusId: contained.id.toString(),
            });
          }
        }}
        onCloseCase={view.requestClose}
      />

      <SecurityCaseAiCard
        securityCase={securityCase}
        priorities={view.values.priorities}
        refreshToggle={view.refreshToggle}
        isWorking={view.isWorking}
        onTriaged={view.refresh}
        onSetPriority={(priority: SecurityCasePriority) => {
          void view.updateCase({
            securityCasePriorityId: priority.id!.toString(),
          });
        }}
        onRunPlaybook={(playbookId: ObjectID) => {
          view.runPlaybook(playbookId);
        }}
      />

      <SecurityCaseImpactCard
        caseId={view.caseId}
        refreshToken={view.refreshToggle}
      />

      <Card
        title="MITRE ATT&CK"
        description="The tactics and techniques this case's detections map to."
      >
        <MitreAttackChips
          tactics={securityCase.mitreTactics || []}
          techniques={securityCase.mitreTechniques || []}
          emptyText="None of this case's detections is mapped to ATT&CK."
        />
      </Card>

      <OverviewCustomFields
        key={view.caseId.toString()}
        modelId={view.caseId}
        modelType={SecurityCase}
        customFieldType={SecurityCaseCustomField}
        resourceName="Security Case"
      />
    </>
  );
};

export default SecurityCaseOverviewPage;
