import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";
import Checkbox from "Common/UI/Components/Checkbox/Checkbox";
import ChoiceRows from "Common/UI/Components/ChoiceRows/ChoiceRows";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import {
  CHOOSE_UPDATES_DESCRIPTION,
  CHOOSE_UPDATES_TITLE,
  EVERY_UPDATE_DESCRIPTIONS,
  EVERY_UPDATE_TITLE,
  getUpdateKindCopy,
  KEY_UPDATES_DESCRIPTIONS,
  KEY_UPDATES_TITLE,
  NOTHING_CHOSEN_NOTES,
  UPDATES_SECTION_TITLE,
  UpdateKindCopy,
  UpdatesEventType,
} from "./NotificationRuleUpdatesCopy";

/*
 * THE RULE'S UPDATES STEP: WHICH UPDATES IT POSTS (issue #7581).
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ (o) Every update                                          │
 *   │     Every state change, note, owner, page and edit.       │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ ( ) Key updates only                                      │
 *   │     Resolved and reopened, severity changes, public ...   │
 *   ├──────────────────────────────────────────────────────────┤
 *   │ ( ) Choose updates                                        │
 *   │     Pick the updates to post.                             │
 *   │     [x] Resolved and reopened   [ ] Other state changes   │
 *   │     [x] Severity changes        [x] Public notes  ...     │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Its question and what every rule posts whatever it picks - the record's
 * first message, a video call's Join button - head the step (the field's
 * sectionTitle and sectionDescription). A new rule, and every rule saved
 * before there was a choice, posts every update.
 *
 * What is stored is the list of updates the rule posts
 * (NotificationRuleUpdates). The list cannot tell "Choose updates" with
 * every box ticked from "Every update", or with Key updates only's boxes
 * ticked from that answer, so the answer picked here is kept while the step
 * is open: ticking every box does not move the radio back to Every update.
 * Picking Choose updates ticks the boxes of what the rule posts so far, and
 * changes nothing until a box is changed.
 */

export interface ComponentProps {
  value: IncidentNotificationRule | undefined;
  onChange: (value: IncidentNotificationRule) => void;
  eventType: UpdatesEventType;
  error?: string | undefined;
}

const NotificationRuleUpdatesForm: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rule: IncidentNotificationRule | undefined = props.value;

  const storedChoice: NotificationRuleUpdatesChoice =
    NotificationRuleUpdates.getChoice({
      rule: rule,
      eventType: props.eventType,
    });

  // The answer picked on the step, while it is open.
  const [pickedChoice, setPickedChoice] =
    useState<NotificationRuleUpdatesChoice | null>(null);

  const choice: NotificationRuleUpdatesChoice = pickedChoice || storedChoice;

  const choosable: Array<NotificationRuleUpdateKind> =
    NotificationRuleUpdates.getChoosableKinds(props.eventType);

  const posted: Array<NotificationRuleUpdateKind> =
    NotificationRuleUpdates.getPostedKinds({
      rule: rule,
      eventType: props.eventType,
    });

  const save: (kinds: ReadonlyArray<NotificationRuleUpdateKind>) => void = (
    kinds: ReadonlyArray<NotificationRuleUpdateKind>,
  ): void => {
    props.onChange(
      NotificationRuleUpdates.withChosenKinds<IncidentNotificationRule>({
        rule: rule,
        eventType: props.eventType,
        kinds: kinds,
      }),
    );
  };

  const pick: (next: NotificationRuleUpdatesChoice) => void = (
    next: NotificationRuleUpdatesChoice,
  ): void => {
    setPickedChoice(next);

    if (next === NotificationRuleUpdatesChoice.ChosenUpdates) {
      // The boxes start as what the rule posts so far: nothing changes yet.
      return;
    }

    props.onChange(
      NotificationRuleUpdates.withChoice<IncidentNotificationRule>({
        rule: rule,
        eventType: props.eventType,
        choice: next,
      }),
    );
  };

  const toggle: (kind: NotificationRuleUpdateKind, isOn: boolean) => void = (
    kind: NotificationRuleUpdateKind,
    isOn: boolean,
  ): void => {
    save(
      isOn
        ? [...posted, kind]
        : posted.filter((candidate: NotificationRuleUpdateKind): boolean => {
            return candidate !== kind;
          }),
    );
  };

  const isChoosing: boolean =
    choice === NotificationRuleUpdatesChoice.ChosenUpdates;

  const checklist: ReactElement = (
    <div data-testid="notification-rule-updates-checklist">
      <div
        role="group"
        aria-label={translator.translateText(CHOOSE_UPDATES_TITLE)}
        className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2"
      >
        {choosable.map((kind: NotificationRuleUpdateKind): ReactElement => {
          const copy: UpdateKindCopy | undefined = getUpdateKindCopy(
            props.eventType,
            kind,
          );

          return (
            <Checkbox
              key={kind}
              title={copy?.title || kind}
              description={copy?.description}
              value={posted.includes(kind)}
              dataTestId={`notification-rule-update-${kind}`}
              onChange={(isOn: boolean) => {
                toggle(kind, isOn);
              }}
            />
          );
        })}
      </div>
      {posted.length === 0 ? (
        <p
          className="mt-3 text-sm text-gray-500"
          data-testid="notification-rule-updates-nothing-chosen"
        >
          {translator.translateText(NOTHING_CHOSEN_NOTES[props.eventType])}
        </p>
      ) : (
        <></>
      )}
    </div>
  );

  return (
    <div data-testid="notification-rule-updates-form" className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <ChoiceRows<NotificationRuleUpdatesChoice>
          ariaLabel={UPDATES_SECTION_TITLE}
          dataTestId="notification-rule-updates"
          value={choice}
          onPick={pick}
          options={[
            {
              value: NotificationRuleUpdatesChoice.EveryUpdate,
              title: EVERY_UPDATE_TITLE,
              description: EVERY_UPDATE_DESCRIPTIONS[props.eventType],
              dataTestId: "notification-rule-updates-every",
            },
            {
              value: NotificationRuleUpdatesChoice.KeyUpdates,
              title: KEY_UPDATES_TITLE,
              description: KEY_UPDATES_DESCRIPTIONS[props.eventType],
              dataTestId: "notification-rule-updates-key",
            },
            {
              value: NotificationRuleUpdatesChoice.ChosenUpdates,
              title: CHOOSE_UPDATES_TITLE,
              description: CHOOSE_UPDATES_DESCRIPTION,
              details: isChoosing ? checklist : undefined,
              dataTestId: "notification-rule-updates-chosen",
            },
          ]}
        />
      </div>

      {props.error ? (
        <FieldError message={props.error} className="text-sm" />
      ) : (
        <></>
      )}
    </div>
  );
};

export default NotificationRuleUpdatesForm;
