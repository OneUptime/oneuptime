import {
  UserOverrideOverlapAnswer,
  getUserOverrideOverlapAnswer,
  getUserOverrideOverlapKey,
} from "./UserOverrideOverlapCheck";
import { isUserOverrideOverlapRefusal } from "./UserOverrideForm";
import { formatHandOffInstant } from "../OnCallScheduleLayer/LayerSummary";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { UserOverrideSavedTimes } from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import UserOverrideOverlap, {
  UserOverrideSentence,
  UserOverrideTimes,
} from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import { LABEL_WITH_COLON } from "Common/UI/Utils/LabelWithColon";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * UNDER ENDS: WHAT THE TIMES PICKED OVERLAP (issue #7630).
 *
 * As soon as who is away and both times are picked, the dialog reads that
 * person's other overrides in the project at those times, and says:
 *
 *   - one in the same scope - both on this policy, or both global - keeps
 *     this one from being saved: "Jane Doe is already covered by Bob Lee on
 *     this policy from ... to ...", with "Edit that override" to change that
 *     one instead (the form says to change the times, and is not sent);
 *   - one of the other scope is allowed, and said plainly: which of the two
 *     is used while both apply (a policy's own over a global one).
 *
 * The names and times are the reader's: their language, their time zone.
 * Only the overrides the reader may read are weighed; the server weighs
 * every one, and its refusal is said under Ends too (ownsServerError), when
 * the check is asked again. Nothing is said while the check has not
 * answered, or could not be made.
 *
 * An edit is asked about the time it adds, as the server asks it: an
 * overlap saved before the rule never stops an override from being ended
 * early. A Skip until... added on several policies at once asks about each
 * of them, and a conflict names the policy it is on (issue #7898).
 */

// A person the reader cannot be told the name of.
export const USER_OVERRIDE_SOMEONE_ELSE: string =
  translationKey("Someone else");

export const USER_OVERRIDE_EDIT_THAT_OVERRIDE: string =
  translationKey("Edit that override");

// How long the picks must stay put before they are asked about.
export const USER_OVERRIDE_OVERLAP_CHECK_DELAY_MS: number = 300;

// The columns an overlap is read and said with.
export const OVERLAP_SELECT: Select<OnCallDutyPolicyUserOverride> = {
  _id: true,
  overrideUserId: true,
  routeAlertsToUserId: true,
  onCallDutyPolicyId: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  overrideUser: { name: true, email: true },
  routeAlertsToUser: { name: true, email: true },
  onCallDutyPolicy: { name: true },
};

// An override as it was read, with the times and ids an overlap is weighed by.
export interface ReadUserOverride extends UserOverrideTimes {
  override: OnCallDutyPolicyUserOverride;
}

export const toReadUserOverride: (
  override: OnCallDutyPolicyUserOverride,
) => ReadUserOverride = (
  override: OnCallDutyPolicyUserOverride,
): ReadUserOverride => {
  return {
    override: override,
    id: override._id?.toString() || null,
    overrideUserId: override.overrideUserId?.toString() || "",
    routeAlertsToUserId: override.routeAlertsToUserId?.toString() || null,
    onCallDutyPolicyId: override.onCallDutyPolicyId?.toString() || null,
    startsAt: OneUptimeDate.fromString(override.startsAt!),
    endsAt: OneUptimeDate.fromString(override.endsAt!),
    createdAt: override.createdAt
      ? OneUptimeDate.fromString(override.createdAt)
      : null,
  };
};

// The same person's overrides in the project that share a moment with `candidate`.
export const fetchUserOverrideOverlaps: (
  candidate: UserOverrideTimes,
) => Promise<Array<ReadUserOverride>> = async (
  candidate: UserOverrideTimes,
): Promise<Array<ReadUserOverride>> => {
  const result: ListResult<OnCallDutyPolicyUserOverride> =
    await ModelAPI.getList<OnCallDutyPolicyUserOverride>({
      modelType: OnCallDutyPolicyUserOverride,
      query: {
        projectId: ProjectUtil.getCurrentProjectId()!,
        overrideUserId: new ObjectID(candidate.overrideUserId),
        // Back to back is no overlap: one that ends as this one starts.
        startsAt: new LessThan<Date>(new Date(candidate.endsAt)),
        endsAt: new GreaterThan<Date>(new Date(candidate.startsAt)),
      },
      limit: 50,
      skip: 0,
      select: OVERLAP_SELECT,
      sort: {
        startsAt: SortOrder.Ascending,
      },
    });

  return result.data
    .filter((override: OnCallDutyPolicyUserOverride): boolean => {
      return Boolean(override.startsAt && override.endsAt);
    })
    .map(toReadUserOverride);
};

export interface ComponentProps {
  // The override the form would save, or null while there is nothing to ask.
  candidate?: UserOverrideTimes | null | undefined;
  /*
   * Or the overrides it would save, one per policy, the same person at the
   * same times: a Skip until... added on several policies (issue #7898).
   * With more than one, a conflict names its policy first.
   */
  candidates?: Array<UserOverrideTimes> | undefined;
  /*
   * The override edited, as saved: only the time the edit adds can conflict
   * (UserOverrideOverlap.getAddedTimes), as the server holds it.
   */
  saved?: UserOverrideSavedTimes | undefined;
  // Told what each question found: whether it overlaps one it may not.
  onChecked?: ((key: string, isConflict: boolean) => void) | undefined;
  /*
   * "Edit that override": opens that one instead. Left out, or for one
   * that has ended, it is not offered.
   */
  onEditOverride?:
    | ((override: OnCallDutyPolicyUserOverride) => void)
    | undefined;
  // The error Ends shows: when it is the server's refusal of an overlap, the check is asked again.
  fieldError?: string | undefined;
}

const UserOverrideOverlapNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  // Each override the form would save; they differ only in their policy.
  const candidates: Array<UserOverrideTimes> =
    props.candidates || (props.candidate ? [props.candidate] : []);

  const candidateKeys: Array<string> = candidates.map(
    (candidate: UserOverrideTimes): string => {
      return getUserOverrideOverlapKey(candidate);
    },
  );

  const key: string = candidateKeys.join(",");

  // The server refused an overlap the check had not seen: ask again.
  const serverRefusal: string =
    props.fieldError && isUserOverrideOverlapRefusal(props.fieldError)
      ? props.fieldError
      : "";

  const [answer, setAnswer] = useState<{
    key: string;
    // What each candidate overlaps, in their order.
    overlaps: Array<UserOverrideOverlapAnswer<ReadUserOverride>>;
  } | null>(null);

  useEffect(() => {
    const first: UserOverrideTimes | undefined = candidates[0];

    if (!first || !key) {
      return;
    }

    let isCancelled: boolean = false;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      // One read answers for all of them: the same person at the same times.
      fetchUserOverrideOverlaps(first)
        .then((overrides: Array<ReadUserOverride>) => {
          if (isCancelled) {
            return;
          }

          const overlaps: Array<UserOverrideOverlapAnswer<ReadUserOverride>> =
            candidates.map(
              (
                candidate: UserOverrideTimes,
                index: number,
              ): UserOverrideOverlapAnswer<ReadUserOverride> => {
                const found: UserOverrideOverlapAnswer<ReadUserOverride> =
                  getUserOverrideOverlapAnswer(
                    candidate,
                    overrides,
                    props.saved,
                  );

                props.onChecked?.(
                  candidateKeys[index]!,
                  found.conflicts.length > 0,
                );

                return found;
              },
            );

          setAnswer({ key: key, overlaps: overlaps });
        })
        .catch(() => {
          // Not known: the server decides, and says why if it refuses.
          if (!isCancelled) {
            for (const candidateKey of candidateKeys) {
              props.onChecked?.(candidateKey, false);
            }
            setAnswer(null);
          }
        });
    }, USER_OVERRIDE_OVERLAP_CHECK_DELAY_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [key, serverRefusal]);

  if (candidates.length === 0 || !answer || answer.key !== key) {
    return <></>;
  }

  const nameOf: (
    person: { name?: unknown; email?: unknown } | undefined,
  ) => string = (
    person: { name?: unknown; email?: unknown } | undefined,
  ): string => {
    return (
      person?.name?.toString() ||
      person?.email?.toString() ||
      translator.translateText(USER_OVERRIDE_SOMEONE_ELSE) ||
      USER_OVERRIDE_SOMEONE_ELSE
    );
  };

  /*
   * "Sat, Nov 14, 1:10 AM": in the reader's zone, which Starts and Ends say
   * just above, so without it - and without the year while it is this year.
   */
  const timeOf: (date: Date) => string = (date: Date): string => {
    return formatHandOffInstant(
      date,
      undefined,
      OneUptimeDate.getCurrentDate(),
    );
  };

  const say: (sentence: UserOverrideSentence) => string = (
    sentence: UserOverrideSentence,
  ): string => {
    return translator.translateTemplate(sentence.template, sentence.values);
  };

  // The first candidate's conflict, in their order: the one the form names.
  const conflict: ReadUserOverride | undefined = answer.overlaps
    .map(
      (
        overlaps: UserOverrideOverlapAnswer<ReadUserOverride>,
      ): ReadUserOverride | undefined => {
        return overlaps.conflicts[0];
      },
    )
    .find((found: ReadUserOverride | undefined): boolean => {
      return Boolean(found);
    });

  if (conflict) {
    const isOver: boolean = OneUptimeDate.isOnOrBefore(
      conflict.endsAt,
      OneUptimeDate.getCurrentDate(),
    );

    /*
     * Added on several policies, the sentence's "this policy" is the one
     * named before it, as the policy's own name: the project's words.
     */
    const policyName: string =
      candidates.length > 1
        ? conflict.override.onCallDutyPolicy?.name?.toString() || ""
        : "";

    return (
      <div
        data-testid="user-override-overlap-conflict"
        role="alert"
        className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200"
      >
        <p>
          {policyName ? (
            <>
              <span
                data-testid="user-override-overlap-conflict-policy"
                className="font-medium"
              >
                {translator.translateTemplate(LABEL_WITH_COLON, {
                  label: policyName,
                })}
              </span>{" "}
            </>
          ) : (
            <></>
          )}
          {say(
            UserOverrideOverlap.getConflictSentence({
              conflict: conflict,
              awayName: nameOf(conflict.override.overrideUser),
              coverName: nameOf(conflict.override.routeAlertsToUser),
              from: timeOf(conflict.startsAt),
              until: timeOf(conflict.endsAt),
            }),
          )}
        </p>
        {props.onEditOverride && !isOver ? (
          <div className="mt-1">
            <Button
              dataTestId="user-override-overlap-edit"
              title={USER_OVERRIDE_EDIT_THAT_OVERRIDE}
              buttonStyle={ButtonStyleType.LINK}
              buttonSize={ButtonSize.ExtraSmall}
              onClick={() => {
                props.onEditOverride?.(conflict.override);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  }

  // Said of one override only: added on several, "this policy" would be any of them.
  const other: ReadUserOverride | undefined =
    candidates.length === 1 ? answer.overlaps[0]?.otherScope[0] : undefined;

  if (!other) {
    return <></>;
  }

  // A div: Icon draws one, and a div may not sit in a paragraph.
  return (
    <div
      data-testid="user-override-overlap-note"
      className="mt-2 flex items-start gap-1.5 text-sm text-gray-600"
    >
      <Icon
        icon={IconProp.InformationCircle}
        className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <span>
        {say(
          UserOverrideOverlap.getOtherScopeNote({
            other: other,
            awayName: nameOf(other.override.overrideUser),
            policyName: other.override.onCallDutyPolicy?.name?.toString() || "",
            from: timeOf(other.startsAt),
            until: timeOf(other.endsAt),
          }),
        )}
      </span>
    </div>
  );
};

export default UserOverrideOverlapNotice;
