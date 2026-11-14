import SelectFormFields from "Common/UI/Types/SelectEntityField";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { toUserOverrideTime } from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import UserOverrideEdit, {
  USER_OVERRIDE_STARTED_REFUSAL,
  USER_OVERRIDE_START_IN_PAST_REFUSAL,
  UserOverrideSavedTimes,
  UserOverrideTimesChange,
} from "Common/Types/OnCallDutyPolicy/UserOverrideEdit";
import { USER_OVERRIDE_CONFLICT_WHAT_TO_DO } from "Common/Types/OnCallDutyPolicy/UserOverrideOverlap";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translateValidationMessage } from "Common/UI/Components/Forms/Validation";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ReactElement } from "react";

/*
 * ADDING AN ON-CALL OVERRIDE ASKS WHO IS AWAY AND WHO COVERS.
 *
 * An override sends the alerts that would page one person to somebody else
 * for a while - someone is on leave, or ill, and a teammate takes their
 * pages. The server reads the override's overrideUserId as the person whose
 * pages are rerouted (OnCallDutyPolicyEscalationRuleService.
 * getRouteAlertToUserId looks overrides up by it, and UserOverrideUtil maps
 * it to the schedule's original user) and routeAlertsToUserId as the person
 * who gets them.
 *
 * The form used to ask "Override User - Select the user who will override
 * the on-call duty", which says the opposite of what the column does, then
 * "Route Alerts To User", over two steps with nothing filled in. Someone
 * covering for a colleague who read it as written set the override up
 * backwards, and the colleague on leave kept getting paged. Now it asks, in
 * the words the schedule screens already use ("Bob (covering Alice)"):
 *
 *   - Who is away? - the person whose alerts go elsewhere, saved as
 *     overrideUserId. It starts as you: booking your own leave is the
 *     commonest case. Change it to book cover for someone else.
 *   - Who covers? - left to the rotation unless somebody is picked: the
 *     picker reads "Next person in the rotation" while it is empty, and an
 *     override saved that way is a SKIP - each of the person's turns goes
 *     to the next person in its rotation who is not away, and they are back
 *     in their usual place when it ends (ScheduleResolution). Pick somebody,
 *     and they get all of the person's pages instead, saved as
 *     routeAlertsToUserId. Whoever is away is left out of its list, and
 *     picking the same person anyway is refused.
 *   - Starts - now, to the minute, unless changed. Like every time a person
 *     picks, it is shown and kept in hours and minutes, never seconds.
 *   - Ends - left empty on purpose: only the person booking knows when the
 *     cover stops, and a guessed end would quietly hand the pages back to
 *     someone still away. It has to come after the start.
 *
 * Four short rows on one page, so the whole override can be read back -
 * who, who instead, from when, until when - before it is saved. The saved
 * columns did not change; only the words, the defaults and the checks did.
 *
 * A customer asked to "skip user X until [date]" for holidays, without
 * naming a replacement. That is this form with nobody picked to cover - one
 * concept for time away, not a second one next to it - and "Skip..." on a
 * person in a schedule layer opens it with them away and the rotation
 * covering (SkipLayerUserModal).
 *
 * The same four rows edit an override (issue #7631), as far as the server
 * lets one change (UserOverrideEdit): who is away is shown, never changed -
 * time away for somebody else is another override - and once the override
 * has started, so is when it starts. Who covers changes until it ends, and
 * when it ends can be moved, down to now to end it now. The times are
 * checked here as the server checks them, so a refusal is said under the
 * field it is about before anything is sent.
 *
 * React-free, so the page, its tests and the server's regression test share
 * one description of the form. What the dialog draws under Ends - what the
 * times picked overlap (UserOverrideOverlapNotice) - is handed in.
 */

// The override's own columns, as the form saves them.
export const USER_OVERRIDE_AWAY_KEY: string = "overrideUserId";
export const USER_OVERRIDE_COVER_KEY: string = "routeAlertsToUserId";
export const USER_OVERRIDE_STARTS_KEY: string = "startsAt";
export const USER_OVERRIDE_ENDS_KEY: string = "endsAt";

export const USER_OVERRIDE_AWAY_REQUIRED_MESSAGE: string = translationKey(
  "Choose who is away.",
);

// What "Who covers?" says while nobody is picked: the rotation covers.
export const USER_OVERRIDE_ROTATION_COVERS_TEXT: string = translationKey(
  "Next person in the rotation",
);

export const USER_OVERRIDE_SAME_PERSON_MESSAGE: string = translationKey(
  "Choose someone other than the person who is away.",
);

export const USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE: string = translationKey(
  "The override has to end after it starts.",
);

// What the Edit form says of the rows it shows but does not change.
export const USER_OVERRIDE_AWAY_LOCKED_TEXT: string = translationKey(
  "Who is away can't be changed. For somebody else, add a new override.",
);

export const USER_OVERRIDE_START_LOCKED_TEXT: string = translationKey(
  "It has already started, so when it starts can't be changed.",
);

export const USER_OVERRIDE_END_NOW_TEXT: string = translationKey(
  "From then on, alerts page the person who is away again. To end it now, pick the current time.",
);

/*
 * Edited before it starts: what Starts may be moved to, and that it stays
 * put once the override starts. Without words of its own the field said
 * its column's description, which names the columns, in English.
 */
export const USER_OVERRIDE_START_MOVABLE_TEXT: string = translationKey(
  "Pick any time from now on. Once the override starts, its start can't be changed.",
);

/*
 * The person who is away: one project member, written to the override's
 * overrideUserId column.
 */
export const getUserOverrideAwayPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        { kind: PeoplePickerKind.User, valueKey: USER_OVERRIDE_AWAY_KEY },
      ],
      isSinglePick: true,
      addButtonText: translationKey("Choose who is away"),
      searchPlaceholder: translationKey("Search by name or email…"),
      emptyText: translationKey("No project members"),
    };
  };

/*
 * The person who covers: one project member other than the person who is
 * away, written to the override's routeAlertsToUserId column - or nobody,
 * which the picker shows as the rotation covering.
 */
export const getUserOverrideCoverPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        { kind: PeoplePickerKind.User, valueKey: USER_OVERRIDE_COVER_KEY },
      ],
      isSinglePick: true,
      excludePicksOf: [
        { kind: PeoplePickerKind.User, valueKey: USER_OVERRIDE_AWAY_KEY },
      ],
      addButtonText: translationKey("Choose someone"),
      searchPlaceholder: translationKey("Search by name or email…"),
      emptyText: translationKey("There is no one else in this project."),
      whenNobodyPicked: {
        text: USER_OVERRIDE_ROTATION_COVERS_TEXT,
        icon: IconProp.Refresh,
      },
    };
  };

const asRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

// The one person a form value names, or null: a picker's id, an ObjectID.
const readPersonId: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return toPeoplePickerIds(value)[0] || null;
};

/*
 * A time as a form holds it is read with the one reader of override times
 * (UserOverrideCoverRequest), so a "Get cover" link's window and the form's
 * own check agree on what a time is.
 */
export { toUserOverrideTime };

export interface UserOverridePeople {
  // The person whose alerts go elsewhere (overrideUserId).
  awayUserId: string | null;
  // The person who gets them (routeAlertsToUserId); null when the rotation covers.
  coverUserId: string | null;
}

// Who a form's values (or an override) say is away, and who covers.
export const readUserOverridePeople: (values: unknown) => UserOverridePeople = (
  values: unknown,
): UserOverridePeople => {
  const record: Record<string, unknown> = asRecord(values);

  return {
    awayUserId: readPersonId(record[USER_OVERRIDE_AWAY_KEY]),
    coverUserId: readPersonId(record[USER_OVERRIDE_COVER_KEY]),
  };
};

const isSamePerson: (a: string | null, b: string | null) => boolean = (
  a: string | null,
  b: string | null,
): boolean => {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
};

// "Who is away?" has its own words for nobody picked.
export const getUserOverrideAwayError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  if (readUserOverridePeople(values).awayUserId) {
    return null;
  }

  return translateValidationMessage(USER_OVERRIDE_AWAY_REQUIRED_MESSAGE);
};

/*
 * "Who covers?": nobody (the rotation covers), or somebody other than the
 * person who is away - an override from someone to themselves would reroute
 * nothing.
 */
export const getUserOverrideCoverError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const people: UserOverridePeople = readUserOverridePeople(values);

  if (isSamePerson(people.awayUserId, people.coverUserId)) {
    return translateValidationMessage(USER_OVERRIDE_SAME_PERSON_MESSAGE);
  }

  return null;
};

// True when the form's values leave covering to the rotation: a skip.
export const isUserOverrideSkip: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return !readUserOverridePeople(values).coverUserId;
};

/*
 * Ends has to come after Starts. A time not filled in yet is the field's
 * own required check, not this one.
 */
export const getUserOverrideEndsError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const record: Record<string, unknown> = asRecord(values);
  const startsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_STARTS_KEY],
  );
  const endsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_ENDS_KEY],
  );

  if (!startsAt || !endsAt) {
    return null;
  }

  if (endsAt.getTime() > startsAt.getTime()) {
    return null;
  }

  return translateValidationMessage(USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE);
};

// The times a form's values hold, as an edit would send them.
const readTimesChange: (values: unknown) => UserOverrideTimesChange = (
  values: unknown,
): UserOverrideTimesChange => {
  const record: Record<string, unknown> = asRecord(values);
  const change: UserOverrideTimesChange = {};
  const startsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_STARTS_KEY],
  );
  const endsAt: Date | null = toUserOverrideTime(
    record[USER_OVERRIDE_ENDS_KEY],
  );

  if (startsAt) {
    change.startsAt = startsAt;
  }

  if (endsAt) {
    change.endsAt = endsAt;
  }

  return change;
};

/*
 * An edit's times, held to what may change as the server holds them
 * (UserOverrideEdit), at the moment the form is checked: the refusal the
 * field `key` shows - Starts, for a start moved after it started or to the
 * past; Ends, for an end moved to the past, or an override that has ended
 * while the form was open - or null.
 */
export const getUserOverrideEditTimeError: (data: {
  values: unknown;
  saved: UserOverrideSavedTimes;
  key: string;
  now?: Date | undefined;
}) => string | null = (data: {
  values: unknown;
  saved: UserOverrideSavedTimes;
  key: string;
  now?: Date | undefined;
}): string | null => {
  const refusal: string | null = UserOverrideEdit.getRefusal({
    saved: data.saved,
    change: readTimesChange(data.values),
    now: data.now || OneUptimeDate.getCurrentDate(),
  });

  if (!refusal) {
    return null;
  }

  const isAboutStart: boolean =
    refusal === USER_OVERRIDE_STARTED_REFUSAL ||
    refusal === USER_OVERRIDE_START_IN_PAST_REFUSAL;

  if ((data.key === USER_OVERRIDE_STARTS_KEY) !== isAboutStart) {
    return null;
  }

  return translateValidationMessage(refusal);
};

/*
 * Whether the server refused a save because its times overlap another
 * override of the same person (UserOverrideOverlap): Ends shows it. Read
 * with indexOf, as every server message is.
 */
export const isUserOverrideOverlapRefusal: (message: string) => boolean = (
  message: string,
): boolean => {
  return message.indexOf(USER_OVERRIDE_CONFLICT_WHAT_TO_DO) !== -1;
};

/*
 * When a new override starts: now, to the minute Starts shows - 11:15, not
 * 11:15:52 - so what is saved is what was read. That minute has already
 * begun, so the override is in force at once, never a minute late.
 */
export const getDefaultUserOverrideStartsAt: () => string = (): string => {
  return OneUptimeDate.toString(
    OneUptimeDate.getStartOfMinute(OneUptimeDate.getCurrentDate()),
  );
};

export interface UserOverrideFormOptions {
  /*
   * Who "Who is away?" starts as: the person filling the form in. Left out
   * (nobody is signed in, as in a test), it starts empty.
   */
  currentUserId?: string | null | undefined;
  /*
   * Who "Who is away?" starts as instead, when the form is opened for a
   * particular person: "Skip..." on somebody in a schedule layer.
   */
  awayUserId?: string | null | undefined;
  /*
   * The form edits an override saved with these times (issue #7631): who is
   * away is shown and never changed, and so is when it starts once it has
   * started (at `now`, when the form opens). Left out, the form adds one.
   */
  editing?:
    | {
        saved: UserOverrideSavedTimes;
        now?: Date | undefined;
      }
    | undefined;
  /*
   * Drawn under Ends from the form's values, and the error Ends shows: what
   * the times picked overlap (the dialog's UserOverrideOverlapNotice).
   */
  getEndsFooter?:
    | ((values: unknown, error?: string) => ReactElement | undefined)
    | undefined;
  /*
   * Whether the times the values hold are known to overlap another override
   * of the same person in its scope, which the server refuses: Ends says to
   * change them, and the form is not sent.
   */
  isKnownOverlap?: ((values: unknown) => boolean) | undefined;
}

/*
 * The Add User Override form, in order: Who is away?, Who covers?, Starts,
 * Ends. One page, no steps: four short rows, two of them filled in. The
 * same four rows edit an override (options.editing).
 */
export const getUserOverrideFormFields: <TEntity>(
  options?: UserOverrideFormOptions,
) => Array<Field<TEntity>> = <TEntity>(
  options?: UserOverrideFormOptions,
): Array<Field<TEntity>> => {
  const currentUserId: string | null = readPersonId(options?.currentUserId);

  /*
   * Who "Who is away?" starts as: the person it was opened for, or else you.
   */
  const awayUserId: string | null =
    readPersonId(options?.awayUserId) || currentUserId;

  const editing: UserOverrideFormOptions["editing"] = options?.editing;

  // Once an edited override has started, when it starts is what happened.
  const isStartLocked: boolean = Boolean(
    editing &&
      UserOverrideEdit.hasStarted(
        editing.saved,
        editing.now || OneUptimeDate.getCurrentDate(),
      ),
  );

  // An edit's own refusal of the times, for Starts or for Ends.
  const getEditError: (values: unknown, key: string) => string | null = (
    values: unknown,
    key: string,
  ): string | null => {
    return editing
      ? getUserOverrideEditTimeError({
          values: values,
          saved: editing.saved,
          key: key,
        })
      : null;
  };

  return [
    {
      field: { overrideUserId: true } as SelectFormFields<TEntity>,
      title: "Who is away?",
      description: editing
        ? USER_OVERRIDE_AWAY_LOCKED_TEXT
        : "They are not paged while they are away.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      /*
       * Edited, the person alone, with no Change button: a locked one
       * offered a change the description says is not made here.
       */
      peoplePicker: {
        ...getUserOverrideAwayPickerConfig(),
        isReadOnly: Boolean(editing),
      },
      required: true,
      defaultValue: awayUserId || undefined,
      /*
       * Edited, it is shown as saved, never changed: its column takes no
       * change, so the edit form would otherwise leave the row out.
       */
      disabled: Boolean(editing),
      showEvenIfPermissionDoesNotExist: Boolean(editing),
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getUserOverrideAwayError(values);
      },
    },
    {
      /*
       * Optional: nobody picked is an answer - the rotation covers - and the
       * picker says so in place of a pick, so "(Optional)" would only add
       * noise to a question that already shows its answer.
       */
      field: { routeAlertsToUserId: true } as SelectFormFields<TEntity>,
      title: "Who covers?",
      description:
        "Each of their turns goes to the next person in the rotation who is not away. Or pick someone to take all of their pages instead.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getUserOverrideCoverPickerConfig(),
      required: false,
      hideOptionalLabel: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getUserOverrideCoverError(values);
      },
    },
    {
      field: { startsAt: true } as SelectFormFields<TEntity>,
      title: "Starts",
      /*
       * Never empty: a field with no description of its own says its
       * column's (BasicModelForm), which names the columns, in English.
       */
      description: isStartLocked
        ? USER_OVERRIDE_START_LOCKED_TEXT
        : editing
          ? USER_OVERRIDE_START_MOVABLE_TEXT
          : "It starts now unless you pick another time.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Pick Date and Time",
      disabled: isStartLocked,
      getDefaultValue: (): string => {
        return getDefaultUserOverrideStartsAt();
      },
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getEditError(values, USER_OVERRIDE_STARTS_KEY);
      },
    },
    {
      field: { endsAt: true } as SelectFormFields<TEntity>,
      title: "Ends",
      description: isStartLocked
        ? USER_OVERRIDE_END_NOW_TEXT
        : "From then on, alerts page the person who is away again.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Pick Date and Time",
      customValidation: (values: FormValues<TEntity>): string | null => {
        return (
          getUserOverrideEndsError(values) ||
          getEditError(values, USER_OVERRIDE_ENDS_KEY) ||
          (options?.isKnownOverlap?.(values)
            ? translateValidationMessage(USER_OVERRIDE_CONFLICT_WHAT_TO_DO)
            : null)
        );
      },
      // The server's refusal of an overlap is about the times: said here.
      ownsServerError: isUserOverrideOverlapRefusal,
      getFooterElement: (
        values: FormValues<TEntity>,
        error?: string,
      ): ReactElement | undefined => {
        return options?.getEndsFooter?.(values, error);
      },
    },
  ];
};

// The columns of an override the form fills in.
export interface UserOverrideColumns {
  projectId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  overrideUserId?: ObjectID | undefined;
  routeAlertsToUserId?: ObjectID | undefined;
}

/*
 * A new override as it is sent: the person away, and who covers - or no one,
 * for the rotation to cover - as ids in their own columns, in the project,
 * and - from a policy's own User Overrides page - for that policy only (a
 * global override has none). Refuses an override with nobody away, or the
 * same person twice, which the form never lets through.
 */
export const prepareUserOverrideForCreate: <
  TOverride extends UserOverrideColumns,
>(
  override: TOverride,
  scope: {
    projectId: ObjectID;
    onCallDutyPolicyId?: ObjectID | null | undefined;
  },
) => TOverride = <TOverride extends UserOverrideColumns>(
  override: TOverride,
  scope: {
    projectId: ObjectID;
    onCallDutyPolicyId?: ObjectID | null | undefined;
  },
): TOverride => {
  const people: UserOverridePeople = readUserOverridePeople(
    override as unknown as JSONObject,
  );

  if (!people.awayUserId) {
    throw new BadDataException(
      translateValidationMessage(USER_OVERRIDE_AWAY_REQUIRED_MESSAGE),
    );
  }

  if (isSamePerson(people.awayUserId, people.coverUserId)) {
    throw new BadDataException(
      translateValidationMessage(USER_OVERRIDE_SAME_PERSON_MESSAGE),
    );
  }

  override.overrideUserId = new ObjectID(people.awayUserId);

  if (people.coverUserId) {
    override.routeAlertsToUserId = new ObjectID(people.coverUserId);
  } else {
    // The rotation covers: the column is left out, not sent empty.
    delete override.routeAlertsToUserId;
  }

  override.projectId = scope.projectId;

  if (scope.onCallDutyPolicyId) {
    override.onCallDutyPolicyId = scope.onCallDutyPolicyId;
  }

  return override;
};

// The columns of an override an edit may send, and the ones it never does.
export interface UserOverrideEditColumns {
  projectId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
  overrideUserId?: ObjectID | undefined;
  overrideUser?: unknown;
  routeAlertsToUserId?: ObjectID | null | undefined;
  routeAlertsToUser?: unknown;
  startsAt?: Date | undefined;
}

/*
 * An edited override as it is sent: who covers - somebody, or nobody, sent
 * as none so that the rotation covers - and its times. Who is away and its
 * policy are never sent: their columns take no change, and the form only
 * shows them. Nor is when it starts, once it has started (`isStartLocked`).
 * Refuses the same person twice, which the form never lets through.
 */
export const prepareUserOverrideForUpdate: <
  TOverride extends UserOverrideEditColumns,
>(
  override: TOverride,
  options: { isStartLocked: boolean },
) => TOverride = <TOverride extends UserOverrideEditColumns>(
  override: TOverride,
  options: { isStartLocked: boolean },
): TOverride => {
  const people: UserOverridePeople = readUserOverridePeople(
    override as unknown as JSONObject,
  );

  if (isSamePerson(people.awayUserId, people.coverUserId)) {
    throw new BadDataException(
      translateValidationMessage(USER_OVERRIDE_SAME_PERSON_MESSAGE),
    );
  }

  delete override.overrideUserId;
  delete override.overrideUser;
  delete override.onCallDutyPolicyId;
  delete override.projectId;
  delete override.routeAlertsToUser;

  override.routeAlertsToUserId = people.coverUserId
    ? new ObjectID(people.coverUserId)
    : null;

  if (options.isStartLocked) {
    delete override.startsAt;
  }

  return override;
};
