import {
  LeadTimeValidation,
  REMINDER_PRESETS,
  ReminderPreset,
  formatLeadTime,
  validateCustomLeadMinutes,
} from "./CalendarFeedUtil";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import UserOnCallShiftReminder from "Common/Models/DatabaseModels/UserOnCallShiftReminder";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * "Remind me before shifts": one chip per lead time, backed by one
 * UserOnCallShiftReminder row each. Clicking a chip that is off creates the
 * row; clicking one that is on deletes it. "Custom" opens a modal for a lead
 * time that is not on the chip row, and a custom row shows up as its own chip
 * so it can be removed the same way.
 *
 * The reminder itself is delivered by the worker through the reader's
 * Notification Settings (the two "Before my on-call shift starts" and "My
 * upcoming on-call shift is reassigned" rows), so the card links there rather
 * than duplicating the channel switches.
 */
export interface ComponentProps {
  projectId: ObjectID | null;
  userId: ObjectID | null;
}

const ShiftRemindersCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [reminders, setReminders] = useState<Array<UserOnCallShiftReminder>>(
    [],
  );
  const [busyMinutes, setBusyMinutes] = useState<number | null>(null);
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [customValue, setCustomValue] = useState<string>("");
  const [customError, setCustomError] = useState<string>("");
  const [isSavingCustom, setIsSavingCustom] = useState<boolean>(false);

  const load: () => Promise<void> = async (): Promise<void> => {
    if (!props.projectId || !props.userId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const result: ListResult<UserOnCallShiftReminder> =
        await ModelAPI.getList<UserOnCallShiftReminder>({
          modelType: UserOnCallShiftReminder,
          query: {
            projectId: props.projectId,
            userId: props.userId,
          },
          select: {
            _id: true,
            minutesBeforeShift: true,
          },
          sort: {
            minutesBeforeShift: SortOrder.Descending,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      setReminders(result.data);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => {
      // load routes every failure into the error state.
    });
  }, [props.projectId?.toString(), props.userId?.toString()]);

  const findReminder: (
    minutes: number,
  ) => UserOnCallShiftReminder | undefined = (
    minutes: number,
  ): UserOnCallShiftReminder | undefined => {
    return reminders.find((reminder: UserOnCallShiftReminder): boolean => {
      return Number(reminder.minutesBeforeShift) === minutes;
    });
  };

  const addReminder: (minutes: number) => Promise<void> = async (
    minutes: number,
  ): Promise<void> => {
    if (!props.projectId) {
      return;
    }

    const reminder: UserOnCallShiftReminder = new UserOnCallShiftReminder();
    reminder.projectId = props.projectId;
    /*
     * userId is left for the service to default to the session user - the
     * service refuses a userId that is not the caller's anyway.
     */
    reminder.minutesBeforeShift = minutes;

    await ModelAPI.create<UserOnCallShiftReminder>({
      model: reminder,
      modelType: UserOnCallShiftReminder,
    });
  };

  const removeReminder: (
    reminder: UserOnCallShiftReminder,
  ) => Promise<void> = async (
    reminder: UserOnCallShiftReminder,
  ): Promise<void> => {
    if (!reminder.id) {
      return;
    }

    await ModelAPI.deleteItem<UserOnCallShiftReminder>({
      modelType: UserOnCallShiftReminder,
      id: reminder.id,
    });
  };

  const toggle: (minutes: number) => Promise<void> = async (
    minutes: number,
  ): Promise<void> => {
    setBusyMinutes(minutes);
    setError("");

    try {
      const existing: UserOnCallShiftReminder | undefined =
        findReminder(minutes);

      if (existing) {
        await removeReminder(existing);
      } else {
        await addReminder(minutes);
      }

      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setBusyMinutes(null);
    }
  };

  const saveCustom: () => Promise<void> = async (): Promise<void> => {
    const validation: LeadTimeValidation =
      validateCustomLeadMinutes(customValue);

    if (validation.error || validation.minutes === null) {
      setCustomError(
        translateString(validation.error || "") || validation.error || "",
      );
      return;
    }

    if (findReminder(validation.minutes)) {
      setCustomError(
        translateString("You already have a reminder at that lead time.") ||
          "You already have a reminder at that lead time.",
      );
      return;
    }

    setIsSavingCustom(true);
    setCustomError("");

    try {
      await addReminder(validation.minutes);
      setShowCustomModal(false);
      setCustomValue("");
      await load();
    } catch (err) {
      setCustomError(API.getFriendlyMessage(err));
    } finally {
      setIsSavingCustom(false);
    }
  };

  const notificationSettingsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS] as Route,
  );

  const presetMinutes: Array<number> = REMINDER_PRESETS.map(
    (preset: ReminderPreset): number => {
      return preset.minutes;
    },
  );

  const customReminders: Array<UserOnCallShiftReminder> = reminders.filter(
    (reminder: UserOnCallShiftReminder): boolean => {
      return !presetMinutes.includes(Number(reminder.minutesBeforeShift));
    },
  );

  const renderChip: (data: {
    minutes: number;
    label: string;
    isOn: boolean;
  }) => ReactElement = (data: {
    minutes: number;
    label: string;
    isOn: boolean;
  }): ReactElement => {
    const isBusy: boolean = busyMinutes === data.minutes;

    return (
      <button
        key={data.minutes}
        type="button"
        data-testid={`shift-reminder-chip-${data.minutes}`}
        aria-pressed={data.isOn}
        disabled={isBusy || !props.projectId || !props.userId}
        onClick={() => {
          toggle(data.minutes).catch(() => {
            // toggle routes every failure into the error state.
          });
        }}
        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors ${
          data.isOn
            ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-500"
            : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
        } ${isBusy ? "opacity-60" : ""}`}
      >
        {data.isOn && <Icon icon={IconProp.Check} size={SizeProp.Small} />}
        <span>{data.label}</span>
      </button>
    );
  };

  let body: ReactElement;

  if (isLoading) {
    body = <ComponentLoader />;
  } else {
    body = (
      <div className="space-y-3">
        {error && <ErrorMessage message={error} />}
        <div className="flex flex-wrap items-center gap-2">
          {REMINDER_PRESETS.map((preset: ReminderPreset): ReactElement => {
            return renderChip({
              minutes: preset.minutes,
              label: translateString(preset.label) || preset.label,
              isOn: Boolean(findReminder(preset.minutes)),
            });
          })}
          {customReminders.map(
            (reminder: UserOnCallShiftReminder): ReactElement => {
              const minutes: number = Number(reminder.minutesBeforeShift);
              return renderChip({
                minutes: minutes,
                label: formatLeadTime(minutes),
                isOn: true,
              });
            },
          )}
          <button
            type="button"
            data-testid="shift-reminder-chip-custom"
            disabled={!props.projectId || !props.userId}
            onClick={() => {
              setCustomValue("");
              setCustomError("");
              setShowCustomModal(true);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Icon icon={IconProp.Add} size={SizeProp.Small} />
            <span>{translateString("Custom")}</span>
          </button>
        </div>
        <div className="text-sm text-gray-500">
          {translateString(
            "You will also be told if a shift inside these windows is reassigned to someone else.",
          )}{" "}
          <Link
            to={notificationSettingsRoute}
            className="text-indigo-600 hover:underline"
          >
            {translateString("Choose how reminders reach you")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Card
      title="Remind me before shifts"
      description="Pick how far ahead OneUptime should remind you of a shift that is about to start. Calendar apps drop the reminders inside a subscribed calendar, so these come from OneUptime instead."
    >
      <>
        {body}
        {showCustomModal && (
          <ConfirmModal
            title="Custom reminder"
            description={
              translateString(
                "How many minutes before a shift starts should the reminder be sent? Between 15 minutes and 14 days (20160 minutes).",
              ) || ""
            }
            submitButtonText="Add reminder"
            submitButtonType={ButtonStyleType.PRIMARY}
            isLoading={isSavingCustom}
            error={customError || undefined}
            onClose={() => {
              setShowCustomModal(false);
            }}
            onSubmit={() => {
              saveCustom().catch(() => {
                // saveCustom routes every failure into the modal error.
              });
            }}
          >
            <div className="mt-3">
              <Input
                type={InputType.NUMBER}
                dataTestId="shift-reminder-custom-minutes"
                placeholder="90"
                value={customValue}
                onChange={(value: string) => {
                  setCustomValue(value);
                  setCustomError("");
                }}
                ariaLabel={
                  translateString("Minutes before shift") ||
                  "Minutes before shift"
                }
              />
            </div>
          </ConfirmModal>
        )}
      </>
    </Card>
  );
};

export default ShiftRemindersCard;
