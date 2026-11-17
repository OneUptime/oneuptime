import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
  readUserOverridePeople,
} from "../UserOverrides/UserOverrideForm";
import {
  UserOverrideEditTarget,
  toUserOverrideEditTarget,
} from "../UserOverrides/UserOverrideFormModal";
import {
  getUserOverrideOverlapKey,
  getUserOverrideSkipCandidates,
} from "../UserOverrides/UserOverrideOverlapCheck";
import UserOverrideOverlapNotice from "../UserOverrides/UserOverrideOverlapNotice";
import {
  UserOverridePolicy,
  addUserOverrideOnPolicies,
} from "../UserOverrides/UserOverridePolicies";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { UserOverrideTimes } from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import { CategoryCheckboxOption } from "Common/UI/Components/CategoryCheckbox/CategoryCheckboxTypes";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useMemo,
  useRef,
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
 * On-Call Duty > Advanced > User Overrides, where it can be deleted to bring
 * them back early. Advanced is a folded section of that menu, so the way
 * there names it. So it takes a permission to add overrides over the whole
 * project (GlobalUserOverrideLock).
 *
 * A reader whose permission covers only some policies is handed the
 * policies that page through this schedule that the server says they may
 * cover (`policies`, UserOverridePolicies), and the skip is added on those
 * instead, one override on each: on the one policy, named in the
 * description, or on the ones ticked under "On-call policies", every one
 * ticked to start with. Each is listed, and deleted, on its policy's own
 * User Overrides page. Where the server allows none, the page locks each
 * row's button and says why, and this dialog never opens.
 *
 * The dialog names the person "Who is away?" holds - "Skip Alex Kim" - and
 * follows it when it is changed, so the title and the button never name
 * somebody the form will not skip. The description says only what the
 * fields do not: how far it reaches, what happens when it ends, and how to
 * end it early. It is true whoever covers.
 *
 * Under Ends it says, as the times are picked, what they overlap (issue
 * #7898), as Add User Override does (UserOverrideOverlapNotice): another
 * override of the same person in the same scope - global, or on a policy
 * it is added on - holds the form back, with "Edit that override", which
 * the page opens in this dialog's place (onEditOverride); a global skip
 * under a policy's own override is said plainly. Added on several policies,
 * each is asked about, and a conflict names its policy.
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
  /*
   * The policies to add the skip on, one override each, for a reader whose
   * permission to add overrides covers only some policies. Left out, the
   * skip is a global override, as it always was.
   */
  policies?: Array<UserOverridePolicy> | undefined;
  onClose: () => void;
  // Saved: the page reads the overrides again.
  onSkipped: () => void;
  /*
   * "Edit that override" under Ends, on a conflict: the page opens that
   * override's Edit in this dialog's place. Left out, it is not offered.
   */
  onEditOverride?: ((target: UserOverrideEditTarget) => void) | undefined;
}

// The form value that holds the policies ticked under "On-call policies".
export const SKIP_POLICIES_FIELD_KEY: string = "onCallDutyPolicyIds";

export const SKIP_NO_POLICY_PICKED_MESSAGE: string = translationKey(
  "Tick at least one on-call policy.",
);

/*
 * The policies a form's values have ticked, of `policies`, in their order:
 * every one of them when the form asks nothing (a single policy).
 */
export function getPickedSkipPolicies(data: {
  values: unknown;
  policies: Array<UserOverridePolicy>;
}): Array<UserOverridePolicy> {
  if (data.policies.length < 2) {
    return data.policies;
  }

  const record: Record<string, unknown> =
    data.values && typeof data.values === "object"
      ? (data.values as Record<string, unknown>)
      : {};
  const ticked: unknown = record[SKIP_POLICIES_FIELD_KEY];

  if (!Array.isArray(ticked)) {
    return [];
  }

  return data.policies.filter((policy: UserOverridePolicy): boolean => {
    return ticked.some((value: unknown): boolean => {
      return (
        typeof value === "string" &&
        value.toLowerCase() === policy.id.toLowerCase()
      );
    });
  });
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

  // The policies to add the skip on, or none: a global override.
  const policies: Array<UserOverridePolicy> = props.policies || [];

  /*
   * The policies a save has added the skip on so far. A save that fails
   * part way says why in place of the form; closed then, the page reads
   * the overrides again, so the ones added show.
   */
  const savedPolicyIds: MutableRefObject<Set<string>> = useRef<Set<string>>(
    new Set<string>(),
  );

  /*
   * What each question asked under Ends found (issue #7898): whether the
   * skip, on each policy it is added on, overlaps an override it may not.
   * Ends is checked against it when the form is sent.
   */
  const knownConflicts: MutableRefObject<Map<string, boolean>> = useRef<
    Map<string, boolean>
  >(new Map<string, boolean>());

  // The latest callback, for the fields made once per person.
  const onEditOverrideRef: MutableRefObject<ComponentProps["onEditOverride"]> =
    useRef<ComponentProps["onEditOverride"]>(props.onEditOverride);
  onEditOverrideRef.current = props.onEditOverride;

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
    useMemo((): Array<ModelField<OnCallDutyPolicyUserOverride>> => {
      // The overrides the values would add: one, global, or one per policy.
      const candidatesOf: (values: unknown) => Array<UserOverrideTimes> = (
        values: unknown,
      ): Array<UserOverrideTimes> => {
        return getUserOverrideSkipCandidates({
          values: values,
          onCallDutyPolicyIds: getPickedSkipPolicies({
            values,
            policies,
          }).map((policy: UserOverridePolicy): string => {
            return policy.id;
          }),
        });
      };

      const fields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
        getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
          currentUserId: currentUserId,
          awayUserId: props.userId,
          /*
           * Under Ends, as Add User Override says it: what the times picked
           * overlap, as soon as they are picked - a conflict holds the form
           * back, with Edit that override; a global skip under a policy's
           * own override is said plainly.
           */
          isKnownOverlap: (values: unknown): boolean => {
            return candidatesOf(values).some(
              (candidate: UserOverrideTimes): boolean => {
                return Boolean(
                  knownConflicts.current.get(
                    getUserOverrideOverlapKey(candidate),
                  ),
                );
              },
            );
          },
          getEndsFooter: (values: unknown, error?: string): ReactElement => {
            return (
              <UserOverrideOverlapNotice
                candidates={candidatesOf(values)}
                fieldError={error}
                onChecked={(key: string, isConflict: boolean) => {
                  knownConflicts.current.set(key, isConflict);
                }}
                onEditOverride={
                  onEditOverrideRef.current
                    ? (other: OnCallDutyPolicyUserOverride) => {
                        const target: UserOverrideEditTarget | null =
                          toUserOverrideEditTarget(other);

                        if (target) {
                          onEditOverrideRef.current?.(target);
                        }
                      }
                    : undefined
                }
              />
            );
          },
        });

      // One policy is named in the description; there is nothing to pick.
      if (policies.length < 2) {
        return fields;
      }

      fields.push({
        overrideField: { onCallDutyPolicyId: true },
        overrideFieldKey: SKIP_POLICIES_FIELD_KEY,
        formOnly: true,
        title: "On-call policies",
        description:
          "The ones you may add user overrides on. Untick any it should leave alone.",
        fieldType: FormFieldSchemaType.CategoryCheckbox,
        required: true,
        dataTestId: "skip-layer-user-policies",
        categoryCheckboxProps: {
          categories: [],
          // A policy's name is the project's own: shown as written.
          options: policies.map(
            (policy: UserOverridePolicy): CategoryCheckboxOption => {
              return {
                value: policy.id,
                label: <span>{policy.name}</span>,
              };
            },
          ),
        },
        customValidation: (values: unknown): string | null => {
          return getPickedSkipPolicies({ values, policies }).length > 0
            ? null
            : translateValidationMessage(SKIP_NO_POLICY_PICKED_MESSAGE);
        },
      });

      return fields;
    }, [currentUserId, props.userId, props.policies]);

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

  /*
   * How far it reaches: every policy; the one policy it is added on; or the
   * policies ticked below.
   */
  let description: string = translationKey(
    "This applies to every on-call policy. To end it early, delete it under On-Call > Advanced > User Overrides.",
  );

  if (policies.length === 1) {
    description = translator.translateTemplate(
      "This applies to the on-call policy {{policy}}. To end it early, delete it on that policy's User Overrides page, under Advanced.",
      { policy: policies[0]!.name },
    );
  } else if (policies.length > 1) {
    description = translationKey(
      "This applies to the on-call policies you tick. To end it early, delete it on each policy's User Overrides page, under Advanced.",
    );
  }

  return (
    <ModelFormModal<OnCallDutyPolicyUserOverride>
      title={skipText || (translator.translateText("Skip until…") as string)}
      isTitleTranslated={true}
      name="Skip in the rotation"
      description={description}
      modelType={OnCallDutyPolicyUserOverride}
      submitButtonText={skipText || "Save"}
      onClose={() => {
        if (savedPolicyIds.current.size > 0) {
          props.onSkipped();
          return;
        }

        props.onClose();
      }}
      onSuccess={() => {
        props.onSkipped();
      }}
      initialValues={
        policies.length > 1
          ? ({
              [SKIP_POLICIES_FIELD_KEY]: policies.map(
                (policy: UserOverridePolicy): string => {
                  return policy.id;
                },
              ),
            } as unknown as JSONObject)
          : undefined
      }
      onBeforeCreate={async (
        item: OnCallDutyPolicyUserOverride,
        _miscDataProps: JSONObject,
        values: JSONObject,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        const override: OnCallDutyPolicyUserOverride =
          prepareUserOverrideForCreate(item, {
            projectId: ProjectUtil.getCurrentProjectId()!,
          });

        if (policies.length === 0) {
          return override;
        }

        /*
         * One override on each policy: those before the last are added
         * here, and the form adds the last, as it adds any override.
         */
        const picked: Array<UserOverridePolicy> = getPickedSkipPolicies({
          values,
          policies,
        });

        if (picked.length === 0) {
          throw new BadDataException(
            translateValidationMessage(SKIP_NO_POLICY_PICKED_MESSAGE),
          );
        }

        await addUserOverrideOnPolicies({
          override: override,
          onCallDutyPolicyIds: picked
            .slice(0, -1)
            .map((policy: UserOverridePolicy): string => {
              return policy.id;
            }),
          saved: savedPolicyIds.current,
        });

        override.onCallDutyPolicyId = new ObjectID(
          picked[picked.length - 1]!.id,
        );

        return override;
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
