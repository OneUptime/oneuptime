import PageComponentProps from "../../PageComponentProps";
import EventStatBar from "../../../Components/EventView/EventStatBar";
import EventStatTile from "../../../Components/EventView/EventStatTile";
import MitreAttackChips from "../../../Components/SecurityCase/MitreAttackChips";
import SecurityCaseAiCard from "../../../Components/SecurityCase/SecurityCaseAiCard";
import SecurityCaseImpactCard from "../../../Components/SecurityCase/Context/SecurityCaseImpactCard";
import {
  SecurityCaseFigures,
  getSecurityCaseFigures,
} from "../../../Components/SecurityCase/SecurityCaseFigures";
import { formatCompactDurationInMinutes } from "../../../Utils/CompactDuration";
import SecurityCaseViewContext, {
  useSecurityCaseView,
} from "./SecurityCaseViewContext";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";
import Card from "Common/UI/Components/Card/Card";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A case's Overview: the case at a glance, under its header (drawn in full
 * here by the layout - what it is, its status steps, who has it). How many
 * detections it holds and for how long it has been worked; what OneUptime
 * AI made of it, first, as the read an analyst starts from (not drawn at
 * all with the project's AI off); and the ATT&CK tactics and techniques its
 * detections map to - the kind of attack this is. Between the two, its
 * Impact: what the case puts at risk, as the rest of OneUptime knows it -
 * whether OneUptime has seen it reached from the internet, who owns what it
 * names and what last changed there, with what each record calls and is
 * watched by folded away until asked for.
 *
 * Its parts are pages of their own, in the case's side menu: the Timeline,
 * the Story, the Detections, the Entities, the Playbooks and the Private
 * Notes.
 */
const SecurityCaseOverviewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const view: SecurityCaseViewContext = useSecurityCaseView();
  const securityCase: SecurityCase = view.securityCase;

  const isClosed: boolean = SecurityCaseStatuses.isClosed(
    view.values.statuses,
    securityCase.securityCaseStatusId,
  );
  const figures: SecurityCaseFigures = getSecurityCaseFigures(
    securityCase,
    OneUptimeDate.getCurrentDate(),
  );

  const duration: (minutes: number | null) => string = (
    minutes: number | null,
  ): string => {
    return formatCompactDurationInMinutes(minutes, translator.language);
  };

  return (
    <>
      {/*
       * By its own width: beside the case's side menu a laptop's window
       * leaves it too little for four tiles in a row, and their labels
       * wrapped and pushed two of the figures a line down.
       */}
      <EventStatBar
        columns={4}
        isLaidOutByOwnWidth={true}
        ariaLabel={translator.translateText("Case figures")}
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
        />
        <EventStatTile
          variant="segment"
          icon={IconProp.ShieldCheck}
          label="Time to Contain"
          value={duration(figures.timeToContainInMinutes)}
        />
      </EventStatBar>

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
    </>
  );
};

export default SecurityCaseOverviewPage;
