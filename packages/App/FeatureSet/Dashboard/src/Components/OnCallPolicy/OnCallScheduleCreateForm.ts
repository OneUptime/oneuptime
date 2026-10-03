import getLabelsFormField from "../../Utils/Form/LabelsFormField";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OneUptimeDate from "Common/Types/Date";
import EventInterval from "Common/Types/Events/EventInterval";
import Recurring from "Common/Types/Events/Recurring";
import { JSONObject } from "Common/Types/JSON";
import {
  SCHEDULE_FIRST_LAYER_ROTATION_KEY,
  SCHEDULE_FIRST_LAYER_USERS_KEY,
} from "Common/Types/OnCallDutyPolicy/ScheduleFirstLayer";
import {
  DEFAULT_LAYER_ROTATION_INTERVAL_COUNT,
  DEFAULT_LAYER_ROTATION_INTERVAL_TYPE,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import PositiveNumber from "Common/Types/PositiveNumber";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import type Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  getAdvancedFormSection,
  isFormFieldValueSet,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * CREATE ON-CALL SCHEDULE: A NEW SCHEDULE PUTS SOMEONE ON CALL FROM THE START.
 *
 * The form used to ask for a name, a time zone and a description, and the
 * schedule it made covered nobody until someone found its Layers page,
 * pressed Add Layer and added people to the layer one at a time: a policy
 * escalating to it paged no one meanwhile. It now asks the two things that
 * make a schedule work, and folds the rest away - as Create On-Call Policy
 * asks "Who gets paged first?" (OnCallPolicyCreateForm.ts):
 *
 *   - Name.
 *   - Who takes turns? The people picker, people only, optional. The people
 *     picked take turns in the order they were picked, starting now: the
 *     server makes them the schedule's first layer, "Layer 1"
 *     (OnCallDutyPolicyScheduleService.create). Left empty, the schedule is
 *     created without layers, as before.
 *   - Advanced, folded: how long each turn lasts (a week unless changed;
 *     asked once somebody is picked), the time zone (the user's own), the
 *     description and the labels. Folded, with somebody picked and nothing
 *     changed, it says what the defaults will do.
 *
 * Three rows, so no steps. React-free, so tests can read the fields without
 * rendering the page.
 */

// The picker's own key: it names the field in the form, nothing is sent under it.
export const SCHEDULE_TAKES_TURNS_FIELD_KEY: string = "whoTakesTurns";

// The form value the turn length is kept in. Form-only: sent as a rotation.
export const SCHEDULE_TURN_LENGTH_FIELD_KEY: string = "turnLength";

/*
 * Under the folded Advanced header while somebody is picked and nothing in
 * the section is changed: the turn length is a default people should know
 * about without opening Advanced.
 */
export const SCHEDULE_DEFAULT_TURN_SUMMARY: string = translationKey(
  "Each person is on call for a week, then the next one takes over.",
);

// The people picker: project members, picked in the order they take turns.
export const getScheduleTakesTurnsPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        {
          kind: PeoplePickerKind.User,
          valueKey: SCHEDULE_FIRST_LAYER_USERS_KEY,
        },
      ],
      addButtonText: translationKey("Add user"),
      searchPlaceholder: translationKey("Search by name or email…"),
      emptyText: translationKey("No project members"),
    };
  };

// The people a form's values name, in the order they were picked.
export const readScheduleTakesTurnsUserIds: (
  values: unknown,
) => Array<string> = (values: unknown): Array<string> => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  return toPeoplePickerIds(record[SCHEDULE_FIRST_LAYER_USERS_KEY]);
};

/*
 * HOW LONG EACH TURN LASTS: the four lengths on-call teams run, as choices.
 * Any other length (hours, three days, a quarter) is set on the layer
 * itself, on the schedule's Layers page.
 */
export interface ScheduleTurnLength {
  // The dropdown's value.
  value: string;
  label: string;
  intervalType: EventInterval;
  intervalCount: number;
}

export const getScheduleTurnLengthValue: (data: {
  intervalType: EventInterval;
  intervalCount: number;
}) => string = (data: {
  intervalType: EventInterval;
  intervalCount: number;
}): string => {
  return `${data.intervalCount}-${data.intervalType}`;
};

export const SCHEDULE_TURN_LENGTHS: Array<ScheduleTurnLength> = [
  {
    value: getScheduleTurnLengthValue({
      intervalType: EventInterval.Day,
      intervalCount: 1,
    }),
    label: translationKey("1 day"),
    intervalType: EventInterval.Day,
    intervalCount: 1,
  },
  {
    value: getScheduleTurnLengthValue({
      intervalType: EventInterval.Week,
      intervalCount: 1,
    }),
    label: translationKey("1 week"),
    intervalType: EventInterval.Week,
    intervalCount: 1,
  },
  {
    value: getScheduleTurnLengthValue({
      intervalType: EventInterval.Week,
      intervalCount: 2,
    }),
    label: translationKey("2 weeks"),
    intervalType: EventInterval.Week,
    intervalCount: 2,
  },
  {
    value: getScheduleTurnLengthValue({
      intervalType: EventInterval.Month,
      intervalCount: 1,
    }),
    label: translationKey("1 month"),
    intervalType: EventInterval.Month,
    intervalCount: 1,
  },
];

// The length a new layer's turns last (ScheduleLayerDefaults): a week.
export const DEFAULT_SCHEDULE_TURN_LENGTH_VALUE: string =
  getScheduleTurnLengthValue({
    intervalType: DEFAULT_LAYER_ROTATION_INTERVAL_TYPE,
    intervalCount: DEFAULT_LAYER_ROTATION_INTERVAL_COUNT,
  });

/*
 * The rotation a turn length stands for: the picked one, or the default when
 * nothing (or something unknown) is picked.
 */
export const getScheduleTurnLengthRotation: (value: unknown) => Recurring = (
  value: unknown,
): Recurring => {
  // A dropdown can hold the option it was picked as ({ label, value }).
  const picked: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)["value"]
      : value;

  const length: ScheduleTurnLength =
    SCHEDULE_TURN_LENGTHS.find((candidate: ScheduleTurnLength): boolean => {
      return candidate.value === picked;
    }) ||
    SCHEDULE_TURN_LENGTHS.find((candidate: ScheduleTurnLength): boolean => {
      return candidate.value === DEFAULT_SCHEDULE_TURN_LENGTH_VALUE;
    })!;

  const rotation: Recurring = new Recurring();
  rotation.intervalType = length.intervalType;
  rotation.intervalCount = new PositiveNumber(length.intervalCount);
  return rotation;
};

/*
 * What a create sends along with the schedule, beyond what ModelForm puts in
 * its misc data by itself (the people picked, under firstLayerUsers): how
 * long each turn lasts, as the rotation of the layer the server makes. Only
 * with somebody picked; with nobody, nothing is added and the request is
 * what it always was. Changes `miscDataProps` in place - it is the request's
 * own (ModelForm onBeforeCreate).
 */
export const addScheduleFirstLayerMiscData: (data: {
  miscDataProps: JSONObject;
  formValues: unknown;
}) => void = (data: {
  miscDataProps: JSONObject;
  formValues: unknown;
}): void => {
  const userIds: Array<string> = readScheduleTakesTurnsUserIds(data.formValues);

  if (userIds.length === 0) {
    delete data.miscDataProps[SCHEDULE_FIRST_LAYER_ROTATION_KEY];
    return;
  }

  const record: Record<string, unknown> =
    data.formValues && typeof data.formValues === "object"
      ? (data.formValues as Record<string, unknown>)
      : {};

  data.miscDataProps[SCHEDULE_FIRST_LAYER_ROTATION_KEY] =
    getScheduleTurnLengthRotation(
      record[SCHEDULE_TURN_LENGTH_FIELD_KEY],
    ).toJSON();
};

/*
 * The settings folded under Advanced, as "Configured" reads them
 * (isFormFieldValueSet): each with the default the form starts it on, so a
 * value the user left alone does not count as changed.
 */
const getScheduleAdvancedValueFields: () => Array<
  Field<OnCallDutyPolicySchedule>
> = (): Array<Field<OnCallDutyPolicySchedule>> => {
  return [
    {
      overrideFieldKey: SCHEDULE_TURN_LENGTH_FIELD_KEY,
      fieldType: FormFieldSchemaType.Dropdown,
      defaultValue: DEFAULT_SCHEDULE_TURN_LENGTH_VALUE,
    },
    {
      field: { timezone: true },
      fieldType: FormFieldSchemaType.Dropdown,
      defaultValue: OneUptimeDate.getCurrentTimezone(),
    },
    {
      field: { description: true },
      fieldType: FormFieldSchemaType.LongText,
    },
    {
      field: { labels: true },
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
    },
  ];
};

/*
 * What the folded Advanced section says: with somebody taking turns and
 * nothing in it changed, what the defaults will do - each person on call
 * for a week. Nothing otherwise, and the header says "Configured" once
 * something is changed, as for any other setting.
 */
export const getScheduleAdvancedSummary: (
  values: FormValues<OnCallDutyPolicySchedule>,
) => Array<string> | undefined = (
  values: FormValues<OnCallDutyPolicySchedule>,
): Array<string> | undefined => {
  if (readScheduleTakesTurnsUserIds(values).length === 0) {
    return undefined;
  }

  const isChanged: boolean = getScheduleAdvancedValueFields().some(
    (field: Field<OnCallDutyPolicySchedule>): boolean => {
      return isFormFieldValueSet(field, values);
    },
  );

  return isChanged ? undefined : [SCHEDULE_DEFAULT_TURN_SUMMARY];
};

export interface OnCallScheduleCreateFormOptions {
  /*
   * Whether the user may add layers and people to them, which "Who takes
   * turns?" does for them: the first layer is created as the user. Without
   * that permission the question is not asked and the form is what it was.
   */
  canAddLayers: () => boolean;
}

export const getOnCallScheduleCreateFormFields: (
  options: OnCallScheduleCreateFormOptions,
) => Array<ModelField<OnCallDutyPolicySchedule>> = (
  options: OnCallScheduleCreateFormOptions,
): Array<ModelField<OnCallDutyPolicySchedule>> => {
  const advanced: FormFieldCollapsibleSection<OnCallDutyPolicySchedule> =
    getAdvancedFormSection<OnCallDutyPolicySchedule>({
      getSummary: getScheduleAdvancedSummary,
    });

  return [
    {
      field: {
        name: true,
      },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Schedule Name",
      validation: {
        minLength: 2,
      },
    },
    {
      field: {
        [SCHEDULE_TAKES_TURNS_FIELD_KEY]: true,
      } as SelectFormFields<OnCallDutyPolicySchedule>,
      title: "Who takes turns?",
      description:
        "On call one at a time, in the order you add them, starting now.",
      fieldType: FormFieldSchemaType.PeoplePicker,
      peoplePicker: getScheduleTakesTurnsPickerConfig(),
      formOnly: true,
      required: false,
      showIf: (): boolean => {
        return options.canAddLayers();
      },
    },
    {
      /*
       * Not a column of the schedule: it becomes the first layer's rotation,
       * sent as misc data (addScheduleFirstLayerMiscData).
       */
      overrideField: {
        [SCHEDULE_TURN_LENGTH_FIELD_KEY]: true,
      },
      overrideFieldKey: SCHEDULE_TURN_LENGTH_FIELD_KEY,
      formOnly: true,
      showEvenIfPermissionDoesNotExist: true,
      title: "Each turn lasts",
      description: "Then the next person takes over.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: SCHEDULE_TURN_LENGTHS.map(
        (length: ScheduleTurnLength): { label: string; value: string } => {
          return { label: length.label, value: length.value };
        },
      ),
      defaultValue: DEFAULT_SCHEDULE_TURN_LENGTH_VALUE,
      required: true,
      // Asked once somebody takes turns: with nobody, no layer is made.
      showIf: (values: FormValues<OnCallDutyPolicySchedule>): boolean => {
        return (
          options.canAddLayers() &&
          readScheduleTakesTurnsUserIds(values).length > 0
        );
      },
      collapsibleSection: advanced,
    },
    {
      field: {
        timezone: true,
      },
      title: "Timezone",
      description:
        "The timezone this schedule's active-hour restrictions and hand-off times are interpreted in. Defaults to your current timezone.",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: TimezoneUtil.getTimezoneDropdownOptions(),
      defaultValue: OneUptimeDate.getCurrentTimezone(),
      required: false,
      placeholder: "Select Timezone",
      collapsibleSection: advanced,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Description",
      collapsibleSection: advanced,
    },
    getLabelsFormField<OnCallDutyPolicySchedule>({
      collapsibleSection: advanced,
    }),
  ];
};
