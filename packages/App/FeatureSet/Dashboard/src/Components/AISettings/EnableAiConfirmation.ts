import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import { EnableAiCopy } from "./ProjectAiSettingsCopy";

/*
 * The dialog before Enable AI is turned off, wherever its switch is drawn
 * (Project Settings → AI Features, and the notice on the other AI settings
 * pages). Turning AI off stops every AI feature in the project at once, so
 * it asks first, as a danger. Turning it on saves at once.
 */
export const getEnableAiConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (isTurningOn) {
    return undefined;
  }

  return {
    title: EnableAiCopy.turnOffConfirmTitle,
    description: EnableAiCopy.turnOffConfirmDescription,
    submitButtonText: EnableAiCopy.turnOffConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

export default getEnableAiConfirmation;
