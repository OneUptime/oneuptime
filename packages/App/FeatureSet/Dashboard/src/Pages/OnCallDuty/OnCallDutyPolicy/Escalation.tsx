import AcknowledgementTimeoutCard from "../../../Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeoutCard";
import {
  ACKNOWLEDGEMENT_TIMEOUT_MORE_SETTINGS_TEST_ID,
  AcknowledgementTimeoutCopy,
} from "../../../Components/OnCallPolicy/AcknowledgementTimeout/AcknowledgementTimeout";
import EscalationRules from "../../../Components/OnCallPolicy/EscalationRule/EscalationRules";
import { PagedPeopleIncidentRoleCopy } from "../../../Components/OnCallPolicy/IncidentRole/PagedPeopleIncidentRole";
import PagedPeopleIncidentRoleCard from "../../../Components/OnCallPolicy/IncidentRole/PagedPeopleIncidentRoleCard";
import RepeatPolicy from "../../../Components/OnCallPolicy/RepeatPolicy";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import { foldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const OnCallPolicyEscalation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  // The policy id comes from the route and the project id from ProjectUtil.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const projectId: ObjectID = ProjectUtil.getCurrentProjectId()!;

  /*
   * The minutes the policy pages again after, as the card under More
   * settings last read or saved them: what the folded section says it is
   * set to. Null while it does not page again.
   */
  const [acknowledgementTimeoutMinutes, setAcknowledgementTimeoutMinutes] =
    useState<number | null>(null);

  /*
   * The name of the incident role the policy gives the people it pages, as
   * the card under More settings last read or saved it: what the folded
   * section says it is set to. Null while it gives none; empty for a role
   * set whose name could not be read.
   */
  const [incidentRoleName, setIncidentRoleName] = useState<string | null>(null);

  return (
    <Fragment>
      {/*
       * The summary at the top says the policy pages again while it does:
       * the card below is folded away, the summary is read first.
       */}
      <EscalationRules
        onCallDutyPolicyId={modelId}
        projectId={projectId}
        acknowledgementTimeoutInMinutes={acknowledgementTimeoutMinutes}
      />

      <div className="mt-6">
        <RepeatPolicy onCallDutyPolicyId={modelId} />
      </div>

      {/*
       * Paging again when it is acknowledged but not resolved (issue
       * #5123), and the incident role the people it pages are given: most
       * teams never need them, so they wait, folded, under More settings -
       * which names them, and says what each is set to while it is on.
       */}
      <div className="mt-6">
        <AdvancedPageSection
          dataTestId={ACKNOWLEDGEMENT_TIMEOUT_MORE_SETTINGS_TEST_ID}
          items={[
            /*
             * Named at its card's place, its title's
             * (#acknowledgement-timeout), so a link lands on the card.
             */
            foldedSectionItem(AcknowledgementTimeoutCopy.cardTitle, {
              isSet: acknowledgementTimeoutMinutes !== null,
              value:
                acknowledgementTimeoutMinutes !== null
                  ? translator.translateTemplate(
                      AcknowledgementTimeoutCopy.foldedValue,
                      { minutes: acknowledgementTimeoutMinutes },
                    )
                  : undefined,
            }),
            // At its card's place too (#incident-role).
            foldedSectionItem(PagedPeopleIncidentRoleCopy.cardTitle, {
              isSet: incidentRoleName !== null,
              value: incidentRoleName || undefined,
            }),
          ]}
        >
          {/*
           * Each card a section of its own, a divider between them
           * (CardSections): a wrapper would sit the card inside More
           * settings with no divider.
           */}
          <AcknowledgementTimeoutCard
            onCallDutyPolicyId={modelId}
            onLoaded={setAcknowledgementTimeoutMinutes}
          />

          <PagedPeopleIncidentRoleCard
            onCallDutyPolicyId={modelId}
            onLoaded={setIncidentRoleName}
          />
        </AdvancedPageSection>
      </div>
    </Fragment>
  );
};

export default OnCallPolicyEscalation;
