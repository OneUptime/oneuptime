import SelectFormFields from "Common/UI/Types/SelectEntityField";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { toUserOverrideTime } from "Common/Types/OnCallDutyPolicy/UserOverrideCoverRequest";
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
 *   - Who covers? - the person who gets those alerts, saved as
 *     routeAlertsToUserId. Whoever is away is left out of its list, and
 *     picking the same person anyway is refused.
 *   - Starts - now, unless changed.
 *   - Ends - left empty on purpose: only the person booking knows when the
 *     cover stops, and a guessed end would quietly hand the pages back to
 *     someone still away. It has to come after the start.
 *
 * Four short rows on one page, so the whole override can be read back -
 * who, who instead, from when, until when - before it is saved. The saved
 * columns did not change; only the words, the defaults and the checks did.
 *
 * React-free, so the page, its tests and the server's regression test share
 * one description of the form.
 */

// The override's own columns, as the form saves them.
export const USER_OVERRIDE_AWAY_KEY: string = "overrideUserId";
export const USER_OVERRIDE_COVER_KEY: string = "routeAlertsToUserId";
export const USER_OVERRIDE_STARTS_KEY: string = "startsAt";
export const USER_OVERRIDE_ENDS_KEY: string = "endsAt";

export const USER_OVERRIDE_AWAY_REQUIRED_MESSAGE: string = translationKey(
  "Choose who is away.",
);

export const USER_OVERRIDE_COVER_REQUIRED_MESSAGE: string =
  translationKey("Choose who covers.");

export const USER_OVERRIDE_SAME_PERSON_MESSAGE: string = translationKey(
  "Choose someone other than the person who is away.",
);

export const USER_OVERRIDE_ENDS_BEFORE_START_MESSAGE: string = translationKey(
  "The override has to end after it starts.",
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
 * away, written to the override's routeAlertsToUserId column.
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
      addButtonText: translationKey("Choose who covers"),
      searchPlaceholder: translationKey("Search by name or email…"),
      emptyText: translationKey("There is no one else in this project."),
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
  // The person who gets them (routeAlertsToUserId).
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
 * "Who covers?": somebody, and not the person who is away - an override
 * from someone to themselves would reroute nothing.
 */
export const getUserOverrideCoverError: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  const people: UserOverridePeople = readUserOverridePeople(values);

  if (!people.coverUserId) {
    return translateValidationMessage(USER_OVERRIDE_COVER_REQUIRED_MESSAGE);
  }

  if (isSamePerson(people.awayUserId, people.coverUserId)) {
    return translateValidationMessage(USER_OVERRIDE_SAME_PERSON_MESSAGE);
  }

  return null;
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

// When a new override starts: now.
export const getDefaultUserOverrideStartsAt: () => string = (): string => {
  return OneUptimeDate.toString(OneUptimeDate.getCurrentDate());
};

export interface UserOverrideFormOptions {
  /*
   * Who "Who is away?" starts as: the person filling the form in. Left out
   * (nobody is signed in, as in a test), it starts empty.
   */
  currentUserId?: string | null | undefined;
}

/*
 * The Add User Override form, in order: Who is away?, Who covers?, Starts,
 * Ends. One page, no steps: four short rows, two of them filled in.
 */
export const getUserOverrideFormFields: <TEntity>(
  options?: UserOverrideFormOptions,
) => Array<Field<TEntity>> = <TEntity>(
  options?: UserOverrideFormOptions,
): Array<Field<TEntity>> => {
  const currentUserId: string | null = readPersonId(options?.currentUserId);

  return [
    {
      field: { overrideUserId: true } as SelectFormFields<TEntity>,
      title: "Who is away?",
      description: "Alerts that would page them go to the person who covers.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getUserOverrideAwayPickerConfig(),
      required: true,
      defaultValue: currentUserId || undefined,
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getUserOverrideAwayError(values);
      },
    },
    {
      field: { routeAlertsToUserId: true } as SelectFormFields<TEntity>,
      title: "Who covers?",
      description: "They get those alerts until the override ends.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getUserOverrideCoverPickerConfig(),
      required: true,
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getUserOverrideCoverError(values);
      },
    },
    {
      field: { startsAt: true } as SelectFormFields<TEntity>,
      title: "Starts",
      description: "It starts now unless you pick another time.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Pick Date and Time",
      getDefaultValue: (): string => {
        return getDefaultUserOverrideStartsAt();
      },
    },
    {
      field: { endsAt: true } as SelectFormFields<TEntity>,
      title: "Ends",
      description: "From then on, alerts page the person who is away again.",
      fieldType: FormFieldSchemaType.DateTime,
      required: true,
      placeholder: "Pick Date and Time",
      customValidation: (values: FormValues<TEntity>): string | null => {
        return getUserOverrideEndsError(values);
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
 * A new override as it is sent: the two people as ids in their own columns,
 * in the project, and - from a policy's own User Overrides page - for that
 * policy only (a global override has none). Refuses an override that names
 * nobody, or the same person twice, which the form never lets through.
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

  if (!people.coverUserId) {
    throw new BadDataException(
      translateValidationMessage(USER_OVERRIDE_COVER_REQUIRED_MESSAGE),
    );
  }

  if (isSamePerson(people.awayUserId, people.coverUserId)) {
    throw new BadDataException(
      translateValidationMessage(USER_OVERRIDE_SAME_PERSON_MESSAGE),
    );
  }

  override.overrideUserId = new ObjectID(people.awayUserId);
  override.routeAlertsToUserId = new ObjectID(people.coverUserId);
  override.projectId = scope.projectId;

  if (scope.onCallDutyPolicyId) {
    override.onCallDutyPolicyId = scope.onCallDutyPolicyId;
  }

  return override;
};
