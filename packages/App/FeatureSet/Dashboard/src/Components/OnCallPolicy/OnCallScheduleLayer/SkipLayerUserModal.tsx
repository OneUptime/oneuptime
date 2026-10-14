import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
  readUserOverridePeople,
} from "../UserOverrides/UserOverrideForm";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

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
 *
 * The dialog names the person "Who is away?" holds - "Skip Alex Kim" - and
 * follows it when it is changed, so the title and the button never name
 * somebody the form will not skip. The description says only what the
 * fields do not: how far it reaches, what happens when it ends, and how to
 * end it early. It is true whoever covers.
 */

export interface ComponentProps {
  // The person to skip, and how the dialog names them.
  userId: string;
  name: string;
  /*
   * The names of the other people the page knows - everybody on the
   * schedule's layers - by user id, so the dialog can name whoever "Who is
   * away?" is changed to.
   */
  nameById?: Record<string, string> | undefined;
  onClose: () => void;
  // Saved: the page reads the overrides again.
  onSkipped: () => void;
}

/*
 * The name of the person the dialog skips: whoever "Who is away?" holds -
 * the person whose row it was opened from, or somebody it was changed to -
 * or null while it holds nobody, or somebody the page cannot name.
 */
export function getSkippedPersonName(data: {
  awayUserId: string | null;
  person: { userId: string; name: string };
  nameById?: Record<string, string> | undefined;
}): string | null {
  if (!data.awayUserId) {
    return null;
  }

  const awayUserId: string = data.awayUserId.toLowerCase();

  if (awayUserId === data.person.userId.toLowerCase()) {
    return data.person.name || null;
  }

  const nameById: Record<string, string> = data.nameById || {};

  for (const userId in nameById) {
    if (userId.toLowerCase() === awayUserId) {
      return nameById[userId] || null;
    }
  }

  return null;
}

const SkipLayerUserModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Who "Who is away?" would start as anywhere else: the person signed in.
  const currentUserId: string = UserUtil.getUserId()?.toString() || "";

  // Who "Who is away?" holds now: the person whose row it was, until changed.
  const [awayUserId, setAwayUserId] = useState<string | null>(props.userId);

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
    useMemo((): Array<ModelField<OnCallDutyPolicyUserOverride>> => {
      return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: currentUserId,
        awayUserId: props.userId,
      });
    }, [currentUserId, props.userId]);

  const skippedName: string | null = getSkippedPersonName({
    awayUserId,
    person: { userId: props.userId, name: props.name },
    nameById: props.nameById,
  });

  /*
   * "Skip Alex Kim" on the title and the button. With nobody under "Who is
   * away?", or somebody the page cannot name, the title is the button the
   * dialog was opened with, and the button saves.
   */
  const skipText: string | null = skippedName
    ? translator.translateTemplate("Skip {{name}}", { name: skippedName })
    : null;

  return (
    <ModelFormModal<OnCallDutyPolicyUserOverride>
      title={skipText || "Skip until…"}
      name="Skip in the rotation"
      description="This applies to every on-call policy. When it ends, they are back in their usual place in the rotation. To end it early, delete it under On-Call Duty > User Overrides."
      modelType={OnCallDutyPolicyUserOverride}
      submitButtonText={skipText || "Save"}
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
        onChange: (values: unknown): void => {
          setAwayUserId(readUserOverridePeople(values).awayUserId);
        },
      }}
    />
  );
};

export default SkipLayerUserModal;
