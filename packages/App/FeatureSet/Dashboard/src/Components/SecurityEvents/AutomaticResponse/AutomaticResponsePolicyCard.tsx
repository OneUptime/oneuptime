import {
  ACTS_ON_TITLE,
  AUTOMATIC_RESPONSE_TEST_IDS,
  CHALLENGE_HELD_AS_BLOCK,
  DELETE_POLICY,
  EDIT_POLICY,
  GUARDRAILS_TITLE,
  SWITCH_LABEL,
  TIME_TO_BLOCK_DESCRIPTION,
  TIME_TO_BLOCK_EMPTY,
  TIME_TO_BLOCK_FIGURES,
  TIME_TO_BLOCK_TITLE,
  TURN_IT_ON_QUESTION,
  TURN_ON,
  TURN_ON_WITHOUT_TRIAL,
  TURN_ON_WITHOUT_TRIAL_DESCRIPTION,
} from "./AutomaticResponseCopy";
import {
  PolicyCondition,
  PolicyModeChip,
  PolicyRuleChip,
  canTurnOnWithoutTrial,
  formatTimeToBlock,
  getChallengeHeldAsBlockAt,
  getPolicyConditions,
  getPolicyDisplayDescription,
  getPolicyDisplayName,
  getPolicyModeChip,
  getPolicyRuleChip,
  getSwitchedOnMode,
  isPolicyAskingToTurnOn,
  isPolicySwitchOn,
  say,
  writeGuardrails,
  writeLastWeek,
  writePolicyStateLine,
  writeTrialSummary,
} from "./AutomaticResponseModel";
import TimeToBlockChart from "./TimeToBlockChart";
import { formatNamesInSentence } from "../../SecurityCase/Response/SecurityCaseBlockStepModel";
import IconProp from "Common/Types/Icon/IconProp";
import {
  SecurityAutomaticResponseOverviewDestination,
  SecurityAutomaticResponseOverviewPolicy,
  SecurityAutomaticResponseRule,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { MORE_SETTINGS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { FOLDED_SECTION_LINE } from "Common/UI/Components/FoldedSection/FoldedSectionVariant";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import Pill from "Common/UI/Components/Pill/Pill";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * ONE AUTOMATIC RESPONSE POLICY (#10350): its name and what it does; beside
 * them, whether it is on - a chip (Off, Trial Run, Trial Finished, On) and
 * the switch that turns it on or off; then where it stands and what its
 * trial run would have done ("In 7 days this would have challenged 1,283
 * addresses. None had signed-in users, and none were yours. Turn it on?"
 * beside Turn On) or what it did; what it acts on, with where each of a
 * ready policy's rules stands; its guardrails in plain words; and its time
 * to block. Turning it on without a trial run is folded under More
 * settings. A project's own policy is edited and deleted from its header.
 *
 * Who may not change policies sees them all, and why the switch is locked.
 */

const SECTION_HEADING_CLASS_NAME: string =
  "text-xs font-medium uppercase tracking-wide text-gray-500";
const SECTION_CLASS_NAME: string = "border-t border-gray-100 pt-4";

export interface ComponentProps {
  policy: SecurityAutomaticResponseOverviewPolicy;
  destinations: ReadonlyArray<SecurityAutomaticResponseOverviewDestination>;
  maxBlocksPerHour: number;
  // Whether the reader may change policies; when not, why (already in their words), or nothing to say.
  canChange: boolean;
  changeRefusal?: string | undefined;
  // A change of this policy is being saved.
  isSaving: boolean;
  now: Date;
  onSetMode: (mode: SecurityAutomaticResponseMode) => void;
  onTurnOnWithoutTrial: () => void;
  onEdit?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}

const AutomaticResponsePolicyCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { policy } = props;
  const isOwn: boolean =
    policy.kind === SecurityAutomaticResponsePolicyKind.Custom;
  const name: string = getPolicyDisplayName(policy, translator);
  const description: string = getPolicyDisplayDescription(policy, translator);
  const chip: PolicyModeChip = getPolicyModeChip(policy);
  const isOn: boolean = isPolicySwitchOn(policy);
  const stateLine: string = writePolicyStateLine({
    policy,
    translator,
    now: props.now,
  });
  const summary: Array<string> = [
    ...writeTrialSummary({ policy, translator }),
    ...writeLastWeek({ policy, translator }),
  ];
  const isAsking: boolean = isPolicyAskingToTurnOn(policy);
  const conditions: Array<PolicyCondition> = getPolicyConditions({
    policy,
    translator,
  });
  const heldAsBlockAt: Array<string> = getChallengeHeldAsBlockAt({
    policy,
    destinations: props.destinations,
  });
  const guardrails: Array<string> = writeGuardrails({
    policy,
    maxBlocksPerHour: props.maxBlocksPerHour,
    translator,
  });
  // Locked switches say why; with nothing to say, the reader has no switch at all.
  const showsControls: boolean =
    props.canChange || Boolean(props.changeRefusal);
  const isLocked: boolean = !props.canChange || props.isSaving;

  const switchElement: ReactElement = (
    <div className="flex items-center gap-3">
      <Pill
        text={chip.text}
        tone={chip.tone}
        dataTestId={AUTOMATIC_RESPONSE_TEST_IDS.modeChip}
      />
      {showsControls ? (
        <Toggle
          value={isOn}
          disabled={isLocked}
          ariaLabel={translator.translateTemplate(SWITCH_LABEL, { name })}
          isAriaLabelTranslated={true}
          tooltip={props.canChange ? undefined : props.changeRefusal}
          isTooltipTranslated={true}
          dataTestId={AUTOMATIC_RESPONSE_TEST_IDS.toggle}
          onChange={(value: boolean) => {
            props.onSetMode(
              value
                ? getSwitchedOnMode(policy)
                : SecurityAutomaticResponseMode.Off,
            );
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );

  const buttons: Array<ReactElement> =
    isOwn && props.canChange
      ? [
          <Button
            key="edit"
            title={EDIT_POLICY}
            icon={IconProp.Edit}
            buttonStyle={ButtonStyleType.NORMAL}
            disabled={props.isSaving}
            onClick={props.onEdit}
            dataTestId="automatic-response-edit-policy"
          />,
          <Button
            key="delete"
            title={DELETE_POLICY}
            icon={IconProp.Trash}
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            disabled={props.isSaving}
            onClick={props.onDelete}
            dataTestId="automatic-response-delete-policy"
          />,
        ]
      : [];

  return (
    <Card
      title={isOwn ? <IsolatedText text={name} /> : name}
      titleText={policy.name}
      description={
        description ? (
          isOwn ? (
            <IsolatedText text={description} />
          ) : (
            description
          )
        ) : undefined
      }
      rightElement={switchElement}
      buttons={buttons}
    >
      <div
        className="space-y-4"
        data-testid={AUTOMATIC_RESPONSE_TEST_IDS.card}
        data-kind={policy.kind}
        data-mode={policy.mode}
      >
        {/* Where it stands, and what it would have done or did. */}
        {stateLine || summary.length > 0 ? (
          <div className="space-y-2">
            {stateLine ? (
              <p
                className="text-sm text-gray-700"
                data-testid={AUTOMATIC_RESPONSE_TEST_IDS.stateLine}
              >
                {stateLine}
              </p>
            ) : (
              <></>
            )}
            {summary.length > 0 ? (
              <p
                className="text-sm text-gray-700"
                data-testid={AUTOMATIC_RESPONSE_TEST_IDS.summary}
              >
                {[
                  ...summary,
                  ...(isAsking ? [say(translator, TURN_IT_ON_QUESTION)] : []),
                ].map((sentence: string, index: number): ReactElement => {
                  return (
                    <React.Fragment key={index}>
                      {index > 0 ? " " : ""}
                      <span>{sentence}</span>
                    </React.Fragment>
                  );
                })}
              </p>
            ) : (
              <></>
            )}
            {isAsking && props.canChange ? (
              <Button
                title={TURN_ON}
                buttonStyle={ButtonStyleType.PRIMARY}
                icon={IconProp.Check}
                isLoading={props.isSaving}
                disabled={props.isSaving}
                onClick={() => {
                  props.onSetMode(SecurityAutomaticResponseMode.On);
                }}
                dataTestId={AUTOMATIC_RESPONSE_TEST_IDS.turnOn}
              />
            ) : (
              <></>
            )}
          </div>
        ) : (
          <></>
        )}

        {/* What it acts on. */}
        <div className={SECTION_CLASS_NAME}>
          <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
            {translator.translateText(ACTS_ON_TITLE)}
          </h3>
          <ul className="space-y-1.5">
            {policy.rules.map(
              (rule: SecurityAutomaticResponseRule): ReactElement => {
                const ruleChip: PolicyRuleChip = getPolicyRuleChip({
                  rule,
                  isPolicyRunning: isOn,
                });

                return (
                  <li
                    key={rule.libraryRuleId}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700"
                    data-testid={AUTOMATIC_RESPONSE_TEST_IDS.rule}
                    data-state={rule.state}
                  >
                    <IsolatedText text={rule.title} />
                    <Pill
                      text={ruleChip.text}
                      tone={ruleChip.tone}
                      tooltip={ruleChip.tooltip}
                    />
                  </li>
                );
              },
            )}
            {conditions.map(
              (condition: PolicyCondition, index: number): ReactElement => {
                return (
                  <li
                    key={`condition-${index}`}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700"
                  >
                    <span>{condition.text}</span>
                    {(condition.techniques || []).map(
                      (technique: string): ReactElement => {
                        return (
                          <span
                            key={technique}
                            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
                          >
                            {technique}
                          </span>
                        );
                      },
                    )}
                  </li>
                );
              },
            )}
          </ul>
          {heldAsBlockAt.length > 0 ? (
            <p
              className="mt-2 text-sm text-gray-600"
              data-testid={AUTOMATIC_RESPONSE_TEST_IDS.heldAsBlock}
            >
              {translator.translateTemplate(
                CHALLENGE_HELD_AS_BLOCK,
                {
                  destinations: formatNamesInSentence(
                    heldAsBlockAt,
                    translator,
                  ),
                },
                { setsValuesApart: true },
              )}
            </p>
          ) : (
            <></>
          )}
        </div>

        {/* What keeps it safe to leave on. */}
        <div
          className={SECTION_CLASS_NAME}
          data-testid={AUTOMATIC_RESPONSE_TEST_IDS.guardrails}
        >
          <h3 className={`mb-2 ${SECTION_HEADING_CLASS_NAME}`}>
            {translator.translateText(GUARDRAILS_TITLE)}
          </h3>
          <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {guardrails.map(
              (guardrail: string, index: number): ReactElement => {
                return (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-sm text-gray-700"
                  >
                    <Icon
                      icon={IconProp.Check}
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
                    />
                    <span>{guardrail}</span>
                  </li>
                );
              },
            )}
          </ul>
        </div>

        {/* How fast it blocks. */}
        <div
          className={SECTION_CLASS_NAME}
          data-testid={AUTOMATIC_RESPONSE_TEST_IDS.timeToBlock}
        >
          <h3 className={SECTION_HEADING_CLASS_NAME}>
            {translator.translateText(TIME_TO_BLOCK_TITLE)}
          </h3>
          <p className="mb-2 text-sm text-gray-600">
            {translator.translateText(TIME_TO_BLOCK_DESCRIPTION)}
          </p>
          {policy.timeToBlock.count > 0 ? (
            <>
              <p className="mb-2 text-sm font-medium text-gray-900">
                {translator.translatePlural(
                  TIME_TO_BLOCK_FIGURES,
                  policy.timeToBlock.count,
                  {
                    p50: formatTimeToBlock(
                      policy.timeToBlock.p50InSeconds,
                      translator,
                    ),
                    p95: formatTimeToBlock(
                      policy.timeToBlock.p95InSeconds,
                      translator,
                    ),
                  },
                )}
              </p>
              <TimeToBlockChart
                days={policy.timeToBlock.days}
                testId={`automatic-response-time-to-block-chart-${policy.id}`}
              />
            </>
          ) : (
            <p className="text-sm text-gray-500">
              {translator.translateText(TIME_TO_BLOCK_EMPTY)}
            </p>
          )}
        </div>

        {/* Skipping the trial run, for whoever knows they want it on now. */}
        {props.canChange && canTurnOnWithoutTrial(policy) ? (
          <FoldedSection
            title={MORE_SETTINGS_SECTION_TITLE}
            variant={FOLDED_SECTION_LINE}
            items={[
              {
                key: "turnOnWithoutTrial",
                title: TURN_ON_WITHOUT_TRIAL,
                isSet: false,
              },
            ]}
            dataTestId={`automatic-response-more-settings-${policy.id}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 basis-64 text-sm text-gray-600">
                {translator.translateText(TURN_ON_WITHOUT_TRIAL_DESCRIPTION)}
              </p>
              <Button
                title={TURN_ON_WITHOUT_TRIAL}
                buttonStyle={ButtonStyleType.NORMAL}
                disabled={props.isSaving}
                onClick={props.onTurnOnWithoutTrial}
                dataTestId={AUTOMATIC_RESPONSE_TEST_IDS.turnOnWithoutTrial}
              />
            </div>
          </FoldedSection>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default AutomaticResponsePolicyCard;
