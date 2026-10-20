/*
 * The keys of a create wizard that starts from a template - Create a
 * workflow and Create a dashboard - read the same way in both.
 *
 * Their template picker answers to Enter (it uses the template picked), and
 * their Name step's one-line field does too: Enter there goes on, as the
 * footer's button does, so a name can be typed and taken without reaching
 * for the mouse - Start from scratch, a name, Enter.
 *
 * No React here (App's tests read it, and App has no React): the events are
 * described by the few fields read from them, which React's keyboard events
 * have.
 */

/** What these rules read of a key press. */
export interface WizardKeyEvent {
  key: string;
  // A held key's repeats.
  repeat: boolean;
  /*
   * 229 while an input method is busy. Safari ends the composition before
   * the keydown of the Enter that commits it, so only this says so there.
   */
  keyCode: number;
  nativeEvent: {
    isComposing: boolean;
  };
}

type WizardKeyRuleFunction = (event: WizardKeyEvent) => boolean;

/**
 * A key the input method is still handling: typing a Japanese, Chinese or
 * Korean name, the Enter that commits the characters is the input method's,
 * not the wizard's.
 */
export const isComposingKey: WizardKeyRuleFunction = (
  event: WizardKeyEvent,
): boolean => {
  return event.nativeEvent.isComposing || event.keyCode === 229;
};

/**
 * Enter that goes on from a step's one-line field: not one an input method
 * is composing with, and not the repeats of a held key - one press creates
 * one record, never one after another.
 */
export const isEnterToSubmit: WizardKeyRuleFunction = (
  event: WizardKeyEvent,
): boolean => {
  return event.key === "Enter" && !event.repeat && !isComposingKey(event);
};
