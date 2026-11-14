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
  EVERY_UPDATE_TITLE,
  getUpdateKindCopy,
  KEY_UPDATES_TITLE,
  UPDATES_COPY,
  UPDATES_SECTION_TITLE,
  UpdateKindCopy,
  UpdatesCopy,
  UpdatesEventType,
} from "./NotificationRuleUpdatesCopy";

/*
 * THE RULE'S UPDATES STEP: WHICH UPDATES IT POSTS (issue #7581).
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ (o) Every update                                          │
 *   │     State changes, notes, owners, paging, edits and ...   │
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
 * Its question and what the rule posts whatever it picks - the record's
 * first message - head the step (the field's sectionTitle and
 * sectionDescription). A new rule, and every rule saved before there was
 * a choice, posts every update.
 *
 * What is stored is the list of updates the rule posts
 * (NotificationRuleUpdates). The list cannot tell "Choose updates" with
 * every box ticked from "Every update", or with Key updates only's boxes
 * ticked from that answer, so the answer picked here is kept while the step
 * is open: ticking every box does not move the radio back to Every update,
 * on a new rule or on one saved with boxes of its own. Picking Choose
 * updates ticks the boxes of what the rule posts so far, and changes
 * nothing until a box is changed.
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
  const copy: UpdatesCopy = UPDATES_COPY[props.eventType];

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
    /*
     * The boxes are the person's own choice now, whatever they add up to: a
     * rule saved on Choose updates whose boxes come to every update, or to
     * the key updates, keeps its boxes open under the pointer.
     */
    setPickedChoice(NotificationRuleUpdatesChoice.ChosenUpdates);

    props.onChange(
      NotificationRuleUpdates.withChosenKinds<IncidentNotificationRule>({
        rule: rule,
        eventType: props.eventType,
        kinds: isOn
          ? [...posted, kind]
          : posted.filter((candidate: NotificationRuleUpdateKind): boolean => {
              return candidate !== kind;
            }),
      }),
    );
  };

  const checklist: ReactElement = (
    <div className="pt-1" data-testid="notification-rule-updates-checklist">
      <div
        role="group"
        aria-label={translator.translateText(CHOOSE_UPDATES_TITLE)}
        className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2"
      >
        {choosable.map((kind: NotificationRuleUpdateKind): ReactElement => {
          const kindCopy: UpdateKindCopy | undefined = getUpdateKindCopy(
            props.eventType,
            kind,
          );

          return (
            <Checkbox
              key={kind}
              title={kindCopy?.title || kind}
              description={kindCopy?.description}
              value={posted.includes(kind)}
              dataTestId={`notification-rule-update-${kind}`}
              onChange={(isOn: boolean) => {
                toggle(kind, isOn);
              }}
            />
          );
        })}
      </div>
      {/* Read out as the last box is cleared, below the box just clicked. */}
      <div aria-live="polite">
        {posted.length === 0 ? (
          <p
            className="mt-3 text-sm text-gray-500"
            data-testid="notification-rule-updates-nothing-chosen"
          >
            {translator.translateText(copy.nothingChosenNote)}
          </p>
        ) : (
          <></>
        )}
      </div>
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
              description: copy.everyUpdateDescription,
              dataTestId: "notification-rule-updates-every",
            },
            {
              value: NotificationRuleUpdatesChoice.KeyUpdates,
              title: KEY_UPDATES_TITLE,
              description: copy.keyUpdatesDescription,
              dataTestId: "notification-rule-updates-key",
            },
            {
              value: NotificationRuleUpdatesChoice.ChosenUpdates,
              title: CHOOSE_UPDATES_TITLE,
              description: CHOOSE_UPDATES_DESCRIPTION,
              details:
                choice === NotificationRuleUpdatesChoice.ChosenUpdates
                  ? checklist
                  : undefined,
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
