import { getMonitorOverviewRoute } from "./MonitorOverviewLinks";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/*
 * The hero's More actions (⋯) menu on a manual monitor, beside Refresh.
 *
 * It lists the project's monitor statuses under "Change status to", each
 * with its colour, as an incident's ⋯ lists its states ("Change state to").
 * Picking one asks once - a status change shows on status pages and tells
 * the monitor's owners and chat channels - and then records it the way the
 * Status Timeline's form does: a new status event that starts now.
 *
 * It used to be a "Change status" link under the hero's text that went to
 * the Status Timeline page, where the reader had to find "Create Monitor
 * Status Event" and fill in a form. That page is still where a change that
 * started earlier is recorded, and the menu falls back to it whenever it
 * has no statuses to offer.
 */

export const MONITOR_CHANGE_STATUS_MENU_TEST_ID: string =
  "monitor-overview-more-actions";
export const MONITOR_CHANGE_STATUS_OPTION_TEST_ID: string =
  "monitor-overview-change-status-option";
export const MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID: string =
  "monitor-overview-change-status-fallback";
export const MONITOR_CHANGE_STATUS_LOADING_TEST_ID: string =
  "monitor-overview-change-status-loading";

/*
 * The hero's icon buttons: Refresh and this menu's ⋯ are one pair, drawn
 * like the ⋯ beside an incident's state buttons (EventStatusPanel).
 */
export const HERO_ICON_BUTTON_CLASS_NAME: string =
  "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-500 shadow-sm transition-colors duration-150 hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

// A status the menu can offer.
export interface MonitorStatusChoice {
  id: string;
  name: string;
  color: string | undefined;
}

/*
 * The project's statuses as the menu offers them: in the order they were
 * read (by priority, as every status picker lists them), without the one
 * the monitor is in - the server refuses a change to the status a monitor
 * already has ("Monitor Status cannot be same as previous status.").
 */
export const getMonitorStatusChoices: (data: {
  statuses: Array<MonitorStatusChoice>;
  currentStatusId: string | undefined;
}) => Array<MonitorStatusChoice> = (data: {
  statuses: Array<MonitorStatusChoice>;
  currentStatusId: string | undefined;
}): Array<MonitorStatusChoice> => {
  const currentStatusId: string = (data.currentStatusId || "").toLowerCase();

  return data.statuses.filter((status: MonitorStatusChoice): boolean => {
    return status.id.toLowerCase() !== currentStatusId;
  });
};

// A status row as a choice; a row with no id or no name is not offered.
export const toMonitorStatusChoice: (
  status: MonitorStatus,
) => MonitorStatusChoice | null = (
  status: MonitorStatus,
): MonitorStatusChoice | null => {
  const id: string = (status._id || status.id?.toString() || "").toString();
  const name: string = status.name?.toString().trim() || "";

  if (!id || !name) {
    return null;
  }

  return {
    id: id,
    name: name,
    color: status.color ? status.color.toString() : undefined,
  };
};

type StatusList =
  | { state: "loading" }
  | { state: "loaded"; statuses: Array<MonitorStatusChoice> }
  | { state: "failed" };

export interface ComponentProps {
  monitorId: ObjectID;
  // The status the monitor is in now, which the menu leaves out.
  currentStatusId: string | undefined;
  // Told once the new status is recorded, so the page reads the monitor again.
  onStatusChanged?: (() => void) | undefined;
}

const MonitorChangeStatusMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [statusList, setStatusList] = useState<StatusList>({
    state: "loading",
  });
  // The status the reader picked, while the dialog asks about it.
  const [picked, setPicked] = useState<MonitorStatusChoice | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");

  // Set at once: two presses before the dialog locks must not save twice.
  const isSavingRef: MutableRefObject<boolean> = useRef<boolean>(false);

  const monitorIdString: string = props.monitorId.toString();

  const statusEvent: MonitorStatusTimeline = useMemo(
    (): MonitorStatusTimeline => {
      return new MonitorStatusTimeline();
    },
    [],
  );

  /*
   * A change of status is a new status event, so it is gated on creating
   * one - the rule the server holds the write to, and the reason the Status
   * Timeline's own create button gives.
   */
  const gate: PermissionGateResult = PermissionGate.check(
    statusEvent,
    ModelAction.Create,
  );

  /*
   * Read once per monitor (the hero mounts this per monitor): a project's
   * statuses rarely change, and the overview's poll must not grow a read.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<MonitorStatus> =
          await ModelAPI.getList<MonitorStatus>({
            modelType: MonitorStatus,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            select: {
              _id: true,
              name: true,
              color: true,
            },
            sort: {
              priority: SortOrder.Ascending,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
          });

        if (!isCurrent) {
          return;
        }

        setStatusList({
          state: "loaded",
          statuses: result.data
            .map(toMonitorStatusChoice)
            .filter((choice: MonitorStatusChoice | null): boolean => {
              return choice !== null;
            }) as Array<MonitorStatusChoice>,
        });
      } catch {
        // The menu falls back to the Status Timeline page.
        if (isCurrent) {
          setStatusList({ state: "failed" });
        }
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [monitorIdString]);

  const choices: Array<MonitorStatusChoice> =
    statusList.state === "loaded"
      ? getMonitorStatusChoices({
          statuses: statusList.statuses,
          currentStatusId: props.currentStatusId,
        })
      : [];

  const closeDialog: () => void = (): void => {
    if (isSavingRef.current) {
      return;
    }

    setPicked(null);
    setSaveError("");
  };

  const changeStatus: () => void = (): void => {
    if (!picked || isSavingRef.current || !gate.isAllowed) {
      return;
    }

    isSavingRef.current = true;
    setIsSaving(true);
    setSaveError("");

    const save: () => Promise<void> = async (): Promise<void> => {
      try {
        const event: MonitorStatusTimeline = new MonitorStatusTimeline();
        event.monitorId = new ObjectID(monitorIdString);
        event.monitorStatusId = new ObjectID(picked.id);
        event.projectId = ProjectUtil.getCurrentProjectId()!;

        /*
         * No startsAt: the server starts the change at its own now, as it
         * does for a change sent through the API.
         */
        await ModelAPI.create<MonitorStatusTimeline>({
          model: event,
          modelType: MonitorStatusTimeline,
        });

        isSavingRef.current = false;
        setIsSaving(false);
        setPicked(null);
        props.onStatusChanged?.();
      } catch (err) {
        isSavingRef.current = false;
        setIsSaving(false);
        setSaveError(API.getFriendlyMessage(err));
      }
    };

    void save();
  };

  // Before the permission snapshot lands there is nothing honest to offer.
  if (!gate.isAllowed && !gate.disabledReason) {
    return <></>;
  }

  const getMenuItems: () => Array<ReactElement> = (): Array<ReactElement> => {
    if (statusList.state === "loading") {
      return [
        <MoreMenuItem
          key="loading"
          icon={IconProp.Spinner}
          iconClassName="animate-spin motion-reduce:animate-none"
          text="Loading…"
          isDisabled={true}
          dataTestId={MONITOR_CHANGE_STATUS_LOADING_TEST_ID}
          onClick={() => {}}
        />,
      ];
    }

    /*
     * The statuses could not be read, or there is no other one to pick:
     * the Status Timeline is where a status is changed then, as it was
     * before the menu.
     */
    if (choices.length === 0) {
      return [
        <MoreMenuItem
          key="status-timeline"
          icon={IconProp.Pencil}
          text="Change status"
          dataTestId={MONITOR_CHANGE_STATUS_FALLBACK_TEST_ID}
          onClick={() => {
            Navigation.navigate(
              getMonitorOverviewRoute({
                key: "statusTimeline",
                monitorId: new ObjectID(monitorIdString),
              }),
            );
          }}
        />,
      ];
    }

    return [
      <MoreMenuSection key="change-status" title="Change status to">
        {choices.map((choice: MonitorStatusChoice): ReactElement => {
          return (
            <MoreMenuItem
              key={choice.id}
              text={choice.name}
              color={choice.color}
              isDisabled={!gate.isAllowed}
              tooltip={gate.isAllowed ? undefined : gate.disabledReason}
              dataTestId={MONITOR_CHANGE_STATUS_OPTION_TEST_ID}
              onClick={() => {
                setSaveError("");
                setPicked(choice);
              }}
            />
          );
        })}
      </MoreMenuSection>,
    ];
  };

  return (
    <>
      <MoreMenu
        text="More actions"
        dataTestId={MONITOR_CHANGE_STATUS_MENU_TEST_ID}
        elementToBeShownInsteadOfButton={
          <Icon icon={IconProp.EllipsisHorizontal} className="h-4 w-4" />
        }
        triggerClassName={`${HERO_ICON_BUTTON_CLASS_NAME} cursor-pointer`}
      >
        {getMenuItems()}
      </MoreMenu>

      {picked ? (
        <ConfirmModal
          title={translator.translateTemplate("Change status to {{status}}?", {
            status: translatableTerm(picked.name),
          })}
          description={translator.translateTemplate(
            "The monitor shows {{status}} from now on, here and on every status page that lists it.",
            { status: translatableTerm(picked.name) },
          )}
          submitButtonText="Change status"
          onSubmit={changeStatus}
          onClose={closeDialog}
          isLoading={isSaving}
          error={saveError || undefined}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default MonitorChangeStatusMenu;
