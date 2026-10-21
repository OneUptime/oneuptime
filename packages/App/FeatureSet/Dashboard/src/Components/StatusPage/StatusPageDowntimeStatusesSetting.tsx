import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { Yellow } from "Common/Types/BrandColors";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Pill from "Common/UI/Components/Pill/Pill";
import SaveStatus from "Common/UI/Components/SaveStatus/SaveStatus";
import useSaveOnChange, {
  SaveOnChange,
} from "Common/UI/Components/SaveStatus/useSaveOnChange";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import {
  DisplayStatusesColumn,
  DisplayStatusesDefinition,
  getDisplayStatusesDescription,
  getDisplayStatusesProblem,
  getDisplayStatusesWrite,
  isSameStatusList,
} from "./StatusPageDisplaySettingsCopy";
import { getPlanNeededToChange } from "./StatusPageSwitchRow";

/*
 * Which monitor statuses count as downtime on a status page - in every
 * uptime percentage it shows, a resource's, a group's and the overall one -
 * as the statuses themselves: one chip per status, in its own colour, in a
 * picker that saves the moment a status is added or taken off. It was a
 * card of its own, "Downtime Monitor Statuses", whose Edit Statuses dialog
 * held this one picker.
 *
 * - The picker offers every monitor status of the project, in priority
 *   order (Operational first), as the dialog did.
 * - At least one status stays picked: with none, nothing would count as
 *   downtime and every uptime on the page would read 100% (a status page has
 *   no "every non-operational status" fallback; an SLO does). Taking the
 *   last one off is turned down, with why, and the chip stays.
 * - "Saving…" and then "Saved" show beside it; a change the server refuses
 *   goes back to what the page has, with the reason under it.
 * - It is never locked while it saves, so keyboard focus stays on it: a
 *   change made before the last one is saved is saved after it, and the page
 *   ends up with the last one (useSaveOnChange).
 * - Someone who may not change the column sees it locked, with the
 *   permission that is missing.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  definition: DisplayStatusesDefinition;
  /*
   * The statuses the page counts as downtime when the row first draws, with
   * their names and colours.
   */
  initialStatuses: Array<MonitorStatus>;
  // Told after a change is saved, with the statuses now picked.
  onSaved?: ((statuses: Array<MonitorStatus>) => void) | undefined;
  /*
   * The picker's wrapper. The row is `${dataTestId}-row`, the "Saved"
   * status `${dataTestId}-status`, a refusal `${dataTestId}-error` and the
   * line under the picker `${dataTestId}-description`.
   */
  dataTestId: string;
}

const getStatusId: (status: MonitorStatus) => string = (
  status: MonitorStatus,
): string => {
  return status._id?.toString() || status.id?.toString() || "";
};

const getStatusIds: (statuses: Array<MonitorStatus>) => Array<string> = (
  statuses: Array<MonitorStatus>,
): Array<string> => {
  return statuses.map(getStatusId).filter((id: string): boolean => {
    return Boolean(id);
  });
};

const StatusPageDowntimeStatusesSetting: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const id: string = useId();
  const labelId: string = `downtime-statuses-label-${id}`;
  const column: DisplayStatusesColumn = props.definition.column;

  // The project's monitor statuses, once read: what the picker offers.
  const [projectStatuses, setProjectStatuses] =
    useState<Array<MonitorStatus> | null>(null);
  const [loadError, setLoadError] = useState<string>("");

  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<MonitorStatus> =
          await ModelAPI.getList<MonitorStatus>({
            modelType: MonitorStatus,
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              name: true,
              color: true,
              priority: true,
            },
            sort: {
              priority: SortOrder.Ascending,
            },
          });

        if (isCurrent) {
          setProjectStatuses(result.data || []);
        }
      } catch (err) {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, []);

  // Every status known here, by id: the page's own, then the project's.
  const knownStatuses: Map<string, MonitorStatus> = useMemo((): Map<
    string,
    MonitorStatus
  > => {
    const known: Map<string, MonitorStatus> = new Map();

    for (const status of [
      ...props.initialStatuses,
      ...(projectStatuses || []),
    ]) {
      const statusId: string = getStatusId(status);

      if (statusId) {
        known.set(statusId, status);
      }
    }

    return known;
  }, [props.initialStatuses, projectStatuses]);

  const setting: SaveOnChange<Array<string>> = useSaveOnChange<Array<string>>({
    initialValue: getStatusIds(props.initialStatuses),
    isSame: isSameStatusList,
    save: async (statusIds: Array<string>): Promise<void> => {
      await ModelAPI.updateById<StatusPage>({
        modelType: StatusPage,
        id: props.statusPageId,
        data: getDisplayStatusesWrite(column, statusIds),
      });
    },
    onSaved: (statusIds: Array<string>): void => {
      props.onSaved?.(
        statusIds
          .map((statusId: string): MonitorStatus | undefined => {
            return knownStatuses.get(statusId);
          })
          .filter((status: MonitorStatus | undefined): boolean => {
            return Boolean(status);
          }) as Array<MonitorStatus>,
      );
    },
  });

  const statusPage: StatusPage = useMemo((): StatusPage => {
    return new StatusPage();
  }, []);

  /*
   * Read on every render, as a settings switch does: the permissions arrive
   * after the first paint of a fresh sign-in.
   */
  const updateGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    statusPage,
    column,
  );

  const planNeeded: PlanType | null = getPlanNeededToChange(column);

  /*
   * One option per status, in its colour: the project's, in priority order,
   * once they are read (until then, the page's own, so its chips show), and
   * any status the page has that the project's list leaves out.
   */
  const options: Array<DropdownOption> = useMemo((): Array<DropdownOption> => {
    const listed: Array<MonitorStatus> =
      projectStatuses || props.initialStatuses;

    const offered: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEntityArray<MonitorStatus>({
        array: listed,
        labelField: "name",
        valueField: "_id",
      });

    const offeredIds: Set<string> = new Set(
      offered.map((option: DropdownOption): string => {
        return String(option.value);
      }),
    );

    const missing: Array<MonitorStatus> = getStatusIds(props.initialStatuses)
      .filter((statusId: string): boolean => {
        return !offeredIds.has(statusId);
      })
      .map((statusId: string): MonitorStatus => {
        return knownStatuses.get(statusId)!;
      });

    return [
      ...offered,
      ...DropdownUtil.getDropdownOptionsFromEntityArray<MonitorStatus>({
        array: missing,
        labelField: "name",
        valueField: "_id",
      }),
    ];
  }, [projectStatuses, props.initialStatuses, knownStatuses]);

  /*
   * The chips. A new array whenever the picker must follow (a refusal puts
   * the last chip back), since it keeps its own copy of what is picked.
   */
  const selectedOptions: Array<DropdownOption> =
    useMemo((): Array<DropdownOption> => {
      return setting.value.map((statusId: string): DropdownOption => {
        return (
          options.find((option: DropdownOption): boolean => {
            return String(option.value) === statusId;
          }) || { value: statusId, label: statusId }
        );
      });
    }, [setting.value, options, setting.revision]);

  const description: string = getDisplayStatusesDescription(
    props.definition,
    setting.value.length,
  );

  const picker: ReactElement = (
    <div className="w-full sm:max-w-md" data-testid={props.dataTestId}>
      <Dropdown
        options={options}
        value={selectedOptions}
        isMultiSelect={true}
        isClearable={false}
        ariaLabelledby={labelId}
        placeholder={props.definition.placeholder}
        disabled={!updateGate.isAllowed}
        className="relative w-full overflow-visible rounded-md"
        onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
          if (!updateGate.isAllowed) {
            return;
          }

          const statusIds: Array<string> = (
            Array.isArray(value) ? value : []
          ).map((statusId: DropdownValue): string => {
            return String(statusId);
          });

          const problem: string | null = getDisplayStatusesProblem(
            props.definition,
            statusIds,
          );

          if (problem) {
            setting.refuse(translator.translateText(problem) || problem);
            return;
          }

          setting.change(statusIds);
        }}
      />
    </div>
  );

  return (
    <div data-testid={`${props.dataTestId}-row`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div
            id={labelId}
            className="text-sm font-medium leading-6 text-gray-900"
          >
            {translator.translateText(props.definition.label)}
          </div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            {updateGate.isAllowed ? (
              picker
            ) : (
              <Tooltip text={updateGate.disabledReason}>{picker}</Tooltip>
            )}
            <SaveStatus
              state={setting.saveState}
              dataTestId={`${props.dataTestId}-status`}
            />
          </div>
          <p
            className="mt-1 text-sm text-gray-500"
            data-testid={`${props.dataTestId}-description`}
          >
            {translator.translateText(description)}
          </p>
          {setting.error ? (
            <p
              className="mt-1 text-sm text-red-600"
              role="alert"
              data-testid={`${props.dataTestId}-error`}
            >
              {setting.error}
            </p>
          ) : (
            <></>
          )}
          {loadError ? (
            <p
              className="mt-1 text-sm text-red-600"
              role="alert"
              data-testid={`${props.dataTestId}-load-error`}
            >
              {loadError}
            </p>
          ) : (
            <></>
          )}
        </div>
        {planNeeded ? (
          <div className="flex-shrink-0 sm:pt-0.5">
            <Pill
              text={translator.translateTemplate("{{planName}} Plan", {
                planName: planNeeded,
              })}
              color={Yellow}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default StatusPageDowntimeStatusesSetting;
