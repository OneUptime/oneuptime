import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
} from "../UserOverrides/UserOverrideForm";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

/*
 * "SKIP UNTIL..." ON A PERSON IN A SCHEDULE LAYER.
 *
 * Where people look when somebody goes on holiday: the person's row in the
 * rotation. It opens the Add User Override form - the one form for time
 * away (UserOverrideForm) - with them as "Who is away?", the rotation as
 * "Who covers?", and starting now, so all that is left is when they are
 * back. Saved as it opens, it skips them: each of their turns, in this
 * schedule and every other one they are in, goes to the next person in the
 * rotation who is not away, and they are back in their usual place
 * afterwards. Picking somebody under "Who covers?" makes it a named cover
 * instead.
 *
 * The override applies to every on-call policy (none is named): somebody on
 * holiday is away from all of them. It is listed with the others under
 * On-Call Duty > User Overrides, where it can be deleted to bring them back
 * early.
 */

export interface ComponentProps {
  // The person to skip, and how the dialog names them.
  userId: string;
  name: string;
  onClose: () => void;
  // Saved: the page reads the overrides again.
  onSkipped: () => void;
}

const SkipLayerUserModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Who "Who is away?" would start as anywhere else: the person signed in.
  const currentUserId: string = UserUtil.getUserId()?.toString() || "";

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
    useMemo((): Array<ModelField<OnCallDutyPolicyUserOverride>> => {
      return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: currentUserId,
        awayUserId: props.userId,
      });
    }, [currentUserId, props.userId]);

  return (
    <ModelFormModal<OnCallDutyPolicyUserOverride>
      title={translator.translateTemplate("Skip {{name}}", {
        name: props.name,
      })}
      name="Skip in the rotation"
      description={translator.translateTemplate(
        "While {{name}} is away, each of their turns goes to the next person in the rotation, and they are back in their usual place when it ends. It applies to every on-call policy, and is listed under On-Call Duty > User Overrides.",
        { name: props.name },
      )}
      modelType={OnCallDutyPolicyUserOverride}
      submitButtonText={translator.translateTemplate("Skip {{name}}", {
        name: props.name,
      })}
      onClose={props.onClose}
      onSuccess={() => {
        props.onSkipped();
      }}
      onBeforeCreate={async (
        item: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        return prepareUserOverrideForCreate(item, {
          projectId: ProjectUtil.getCurrentProjectId()!,
        });
      }}
      formProps={{
        name: "Skip in the rotation",
        modelType: OnCallDutyPolicyUserOverride,
        id: "skip-layer-user-form",
        formType: FormType.Create,
        fields: formFields,
      }}
    />
  );
};

export default SkipLayerUserModal;
