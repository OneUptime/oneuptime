import {
  getUserOverrideFormFields,
  prepareUserOverrideForCreate,
  prepareUserOverrideForUpdate,
} from "./UserOverrideForm";
import {
  UserOverrideDialogTarget,
  getUserOverrideOverlapCandidate,
  getUserOverrideOverlapKey,
} from "./UserOverrideOverlapCheck";
import UserOverrideOverlapNotice, {
  USER_OVERRIDE_SOMEONE_ELSE,
} from "./UserOverrideOverlapNotice";
import UserOverrideEndNowModal, {
  USER_OVERRIDE_END_NOW_ACTION,
  UserOverrideEndNowTarget,
  canEndUserOverrideNow,
  toUserOverrideEndNowTarget,
} from "./UserOverrideEndNow";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserOverrideEdit, {
  UserOverrideSavedTimes,
} from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import { UserOverrideTimes } from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import { FormType, ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { translateCreateAction } from "Common/UI/Components/ModelTable/BaseModelTable";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  Translator,
  translateNamedAction,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
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
 * ADD OR EDIT ONE USER OVERRIDE (issues #7630, #7631).
 *
 * The one dialog for an override's four rows (UserOverrideForm): Add User
 * Override on a policy's User Overrides page or on the global one, and Edit
 * on each of their rows and on a schedule's active overrides card.
 *
 *   - Adding, it asks the four, with you away and starting now - or on the
 *     window a "Get cover" link asked for.
 *   - Editing, it opens on the override as saved. Who covers changes, and
 *     so do the times as far as the server lets them (UserOverrideEdit):
 *     who is away is shown, never changed, and so is when it starts once it
 *     has started. An override that has ended is never opened: its Edit is
 *     locked, saying why.
 *
 * Under Ends it says what the times picked overlap (UserOverrideOverlap-
 * Notice): another override of the same person in the same scope keeps it
 * from being saved - the form says to change the times, and is not sent -
 * and "Edit that override" opens that one instead, in this dialog's place
 * (onEditOverride). One of the other scope is allowed, and said plainly.
 */

// The override an Edit dialog opens on, as the list it was opened from read it.
export interface UserOverrideEditTarget {
  id: string;
  // Its policy, or null for a global override.
  onCallDutyPolicyId: string | null;
  startsAt: Date;
  endsAt: Date;
  /*
   * Who is away, and who covers - none for a skip - by name, as the list
   * shows them: End Now under Ends asks about them (UserOverrideEndNow).
   */
  awayName?: string | undefined;
  coverName?: string | null | undefined;
}

export const USER_OVERRIDE_ITEM_NAME: string = translationKey("User Override");

// An override, as read, for the Edit dialog to open on.
export const toUserOverrideEditTarget: (
  override: OnCallDutyPolicyUserOverride,
) => UserOverrideEditTarget | null = (
  override: OnCallDutyPolicyUserOverride,
): UserOverrideEditTarget | null => {
  const id: string = override._id?.toString() || "";

  if (!id || !override.startsAt || !override.endsAt) {
    return null;
  }

  const endNow: UserOverrideEndNowTarget | null =
    toUserOverrideEndNowTarget(override);

  return {
    id: id,
    onCallDutyPolicyId: override.onCallDutyPolicyId?.toString() || null,
    startsAt: OneUptimeDate.fromString(override.startsAt),
    endsAt: OneUptimeDate.fromString(override.endsAt),
    awayName: endNow?.awayName,
    coverName: endNow?.coverName,
  };
};

export interface ComponentProps {
  // Editing this override; adding one when left out.
  overrideToEdit?: UserOverrideEditTarget | undefined;
  // Where an added override goes: this policy, or every policy when left out.
  onCallDutyPolicyId?: ObjectID | undefined;
  // What an Add starts on instead of now: a Get cover link's window.
  initialTimes?: { startsAt: Date; endsAt: Date } | undefined;
  onClose: () => void;
  // Saved: the list reads its overrides again.
  onSaved: () => void;
  /*
   * "Edit that override" under Ends: the list opens that one's Edit in this
   * dialog's place. Left out, it is not offered.
   */
  onEditOverride?: ((target: UserOverrideEditTarget) => void) | undefined;
  /*
   * The zone End Now's question writes the override's end in: the
   * schedule's, on its card. The reader's when left out, as the lists.
   */
  timezone?: string | undefined;
}

const UserOverrideFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Who "Who is away?" starts as when adding: the person signed in.
  const currentUserId: string = UserUtil.getUserId()?.toString() || "";

  // When the dialog opened: whether an edited override has started yet.
  const [openedAt] = useState<Date>(() => {
    return OneUptimeDate.getCurrentDate();
  });

  const editTarget: UserOverrideEditTarget | undefined = props.overrideToEdit;

  const saved: UserOverrideSavedTimes | undefined = editTarget
    ? { startsAt: editTarget.startsAt, endsAt: editTarget.endsAt }
    : undefined;

  const isStartLocked: boolean = Boolean(
    saved && UserOverrideEdit.hasStarted(saved, openedAt),
  );

  const target: UserOverrideDialogTarget = editTarget
    ? {
        id: editTarget.id,
        onCallDutyPolicyId: editTarget.onCallDutyPolicyId,
        saved: saved,
      }
    : {
        onCallDutyPolicyId: props.onCallDutyPolicyId?.toString() || null,
      };

  /*
   * What each question asked under Ends found: whether those times overlap
   * an override they may not. Ends is checked against it when the form is
   * sent.
   */
  const knownConflicts: MutableRefObject<Map<string, boolean>> = useRef<
    Map<string, boolean>
  >(new Map<string, boolean>());

  // The latest callback, for the fields made once per override.
  const onEditOverrideRef: MutableRefObject<ComponentProps["onEditOverride"]> =
    useRef<ComponentProps["onEditOverride"]>(props.onEditOverride);
  onEditOverrideRef.current = props.onEditOverride;

  /*
   * End Now under Ends (issue #7899): an override under way, ended at once
   * after one question, asked in this dialog's place. Cancelled, the
   * dialog opens on the override again; ended, the list reads its
   * overrides again.
   */
  const [isAskingEndNow, setIsAskingEndNow] = useState<boolean>(false);

  const endNowTarget: UserOverrideEndNowTarget | null =
    editTarget && saved && canEndUserOverrideNow(saved, openedAt)
      ? {
          id: editTarget.id,
          startsAt: saved.startsAt,
          endsAt: saved.endsAt,
          awayName:
            editTarget.awayName ||
            translator.translateText(USER_OVERRIDE_SOMEONE_ELSE) ||
            USER_OVERRIDE_SOMEONE_ELSE,
          coverName: editTarget.coverName || null,
        }
      : null;

  const formFields: Array<ModelField<OnCallDutyPolicyUserOverride>> =
    useMemo((): Array<ModelField<OnCallDutyPolicyUserOverride>> => {
      const candidateOf: (values: unknown) => UserOverrideTimes | null = (
        values: unknown,
      ): UserOverrideTimes | null => {
        return getUserOverrideOverlapCandidate({
          values: values,
          target: target,
        });
      };

      return getUserOverrideFormFields<OnCallDutyPolicyUserOverride>({
        currentUserId: currentUserId,
        editing: saved ? { saved: saved, now: openedAt } : undefined,
        isKnownOverlap: (values: unknown): boolean => {
          const candidate: UserOverrideTimes | null = candidateOf(values);

          return Boolean(
            candidate &&
              knownConflicts.current.get(getUserOverrideOverlapKey(candidate)),
          );
        },
        getEndsFooter: (values: unknown, error?: string): ReactElement => {
          return (
            <>
              {endNowTarget ? (
                <div className="mt-2">
                  <Button
                    dataTestId="user-override-end-now"
                    title={USER_OVERRIDE_END_NOW_ACTION}
                    icon={IconProp.StopCircle}
                    buttonStyle={ButtonStyleType.LINK}
                    buttonSize={ButtonSize.ExtraSmall}
                    onClick={() => {
                      setIsAskingEndNow(true);
                    }}
                  />
                </div>
              ) : (
                <></>
              )}
              <UserOverrideOverlapNotice
                candidate={candidateOf(values)}
                saved={saved}
                fieldError={error}
                onChecked={(key: string, isConflict: boolean) => {
                  knownConflicts.current.set(key, isConflict);
                }}
                onEditOverride={
                  onEditOverrideRef.current
                    ? (other: OnCallDutyPolicyUserOverride) => {
                        const otherTarget: UserOverrideEditTarget | null =
                          toUserOverrideEditTarget(other);

                        if (otherTarget) {
                          onEditOverrideRef.current?.(otherTarget);
                        }
                      }
                    : undefined
                }
              />
            </>
          );
        },
      });
    }, [currentUserId, editTarget?.id, props.onCallDutyPolicyId?.toString()]);

  const title: string = translateNamedAction(translator, {
    template: editTarget ? "Edit {{itemName}}" : "Add New {{itemName}}",
    itemName: USER_OVERRIDE_ITEM_NAME,
  });

  if (isAskingEndNow && endNowTarget) {
    return (
      <UserOverrideEndNowModal
        target={endNowTarget}
        timezone={props.timezone}
        onClose={() => {
          setIsAskingEndNow(false);
        }}
        onEnded={() => {
          props.onSaved();
        }}
      />
    );
  }

  return (
    <ModelFormModal<OnCallDutyPolicyUserOverride>
      title={title}
      isTitleTranslated={true}
      name="On-Call Policy > User Overrides"
      modelType={OnCallDutyPolicyUserOverride}
      modelIdToEdit={editTarget ? new ObjectID(editTarget.id) : undefined}
      initialValues={
        !editTarget && props.initialTimes
          ? ({
              startsAt: props.initialTimes.startsAt,
              endsAt: props.initialTimes.endsAt,
            } as FormValues<OnCallDutyPolicyUserOverride>)
          : undefined
      }
      submitButtonText={
        editTarget
          ? "Save Changes"
          : translateCreateAction(translator, {
              verb: "Add",
              itemName: USER_OVERRIDE_ITEM_NAME,
            })
      }
      onClose={props.onClose}
      onSuccess={() => {
        props.onSaved();
      }}
      onBeforeCreate={async (
        item: OnCallDutyPolicyUserOverride,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        return prepareUserOverrideForCreate(item, {
          projectId: ProjectUtil.getCurrentProjectId()!,
          onCallDutyPolicyId: props.onCallDutyPolicyId,
        });
      }}
      onBeforeUpdate={async (
        item: OnCallDutyPolicyUserOverride,
        _miscDataProps: JSONObject,
      ): Promise<OnCallDutyPolicyUserOverride> => {
        return prepareUserOverrideForUpdate(item, {
          isStartLocked: isStartLocked,
        });
      }}
      formProps={{
        name: "On-Call Policy > User Overrides",
        modelType: OnCallDutyPolicyUserOverride,
        id: "user-override-form",
        formType: editTarget ? FormType.Update : FormType.Create,
        fields: formFields,
      }}
    />
  );
};

export default UserOverrideFormModal;
