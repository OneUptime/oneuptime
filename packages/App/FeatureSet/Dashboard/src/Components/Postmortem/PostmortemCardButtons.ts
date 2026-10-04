import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
} from "Common/UI/Utils/PermissionGate";

export interface PostmortemCardButtonsOptions {
  // The incident or episode the postmortem is written on.
  model: PermissionCheckableModel;
  // Whether the project has a postmortem template to apply.
  hasTemplates: boolean;
  onGenerateWithAI: () => void;
  onApplyTemplate: () => void;
}

/*
 * The Postmortem card's own buttons, beside its Edit button.
 *
 * Apply Template is offered only once the project has a postmortem template:
 * with none it opened a dialog that said so and pointed at a settings page
 * that does not exist. Templates are made in Incidents → Settings →
 * Postmortem Templates; the button appears as soon as there is one.
 *
 * Both buttons end in saving the postmortem, so they follow the Edit
 * button's rule: locked, with the reason, for someone who may not edit it,
 * and not drawn before the permissions are known. Without that, a viewer
 * could have AI write a whole postmortem only to be refused the save.
 */
export function getPostmortemCardButtons(
  options: PostmortemCardButtonsOptions,
): Array<CardButtonSchema> {
  const buttons: Array<CardButtonSchema> = [
    {
      title: "Generate with AI",
      icon: IconProp.Bolt,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: () => {
        options.onGenerateWithAI();
      },
    },
  ];

  if (options.hasTemplates) {
    buttons.push({
      title: "Apply Template",
      icon: IconProp.Template,
      buttonStyle: ButtonStyleType.OUTLINE,
      onClick: () => {
        options.onApplyTemplate();
      },
    });
  }

  return buttons
    .map((button: CardButtonSchema): CardButtonSchema | null => {
      return PermissionGate.gateCardButton(
        button,
        options.model,
        ModelAction.Update,
      );
    })
    .filter((button: CardButtonSchema | null): button is CardButtonSchema => {
      return button !== null;
    });
}
