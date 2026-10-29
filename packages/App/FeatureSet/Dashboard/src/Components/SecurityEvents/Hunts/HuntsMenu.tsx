import {
  HUNTS_MENU_EMPTY,
  HUNTS_MENU_LOADING,
  HUNTS_MENU_NOT_LOADED,
  HUNTS_MENU_SAVE_AS_HUNT,
  HUNTS_MENU_SEARCH,
  HUNTS_TABLE_TITLE,
  HUNTS_TEST_IDS,
  SAVES_THIS_SEARCH,
  SAVE_AS_HUNT,
  SAVE_AS_HUNT_DESCRIPTION,
  SAVE_AS_HUNT_NOTHING_TO_SAVE,
  SAVE_HUNT,
  SCHEDULE_LABELS,
} from "./HuntsCopy";
import { HuntSearchLine } from "./HuntCells";
import {
  getNewHuntInitialValues,
  getSaveAsHuntFormFields,
} from "./HuntFormFields";
import {
  HuntSearchState,
  getHuntValuesToSave,
  getHuntViewRoute,
  hasHuntSearchToSave,
} from "./HuntsModel";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_HUNTS_PER_PROJECT_MAX,
  SecurityHuntFilters,
  SecurityHuntSchedule,
  isScheduledSecurityHunt,
} from "Common/Types/SecurityEvent/SecurityHunt";
import TimeRange from "Common/Types/Time/TimeRange";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import SavedViewsDropdown from "Common/UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { SavedViewOption } from "Common/UI/Components/TelemetryViewer/types";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  // What the Events explorer is searching right now.
  state: HuntSearchState;
  // The hunt open on this page, ticked in the list: on a hunt's page.
  currentHuntId?: string | undefined;
}

// What Save as Hunt saves, held from the moment the dialog opens.
interface ValuesToSave {
  searchQuery: string;
  filters: SecurityHuntFilters;
  timeRange: TimeRange;
}

enum ListState {
  Loading = "Loading",
  Loaded = "Loaded",
  NotLoaded = "NotLoaded",
}

// A hunt as the list names it: its name, and how often it runs when it does.
export const toHuntMenuOption: (data: {
  hunt: SecurityHunt;
  translator: Translator;
}) => SavedViewOption = (data: {
  hunt: SecurityHunt;
  translator: Translator;
}): SavedViewOption => {
  const schedule: SecurityHuntSchedule =
    data.hunt.schedule || SecurityHuntSchedule.NotScheduled;
  const label: string = SCHEDULE_LABELS[schedule] || schedule;

  return {
    id: data.hunt._id?.toString() || "",
    name: data.hunt.name || "",
    detail: isScheduledSecurityHunt(schedule)
      ? data.translator.translateText(label) || label
      : undefined,
  };
};

/*
 * "Hunts", on the Events explorer's toolbar where Traces and Metrics keep
 * their saved views (the same dropdown): the project's hunts, each opening
 * on its page, and "+ Save as Hunt" under them - the search on screen, its
 * text, its chips and how far back it looks, kept with a name, and run on
 * a schedule if the person chooses one. The dialog says what it saves over
 * its fields, and a new hunt opens on its page. The save is locked, saying
 * why, with nothing on screen to save or for a role that may not.
 *
 * The list is read as the toolbar draws and again as it opens, so a hunt
 * saved in another tab is in it. A role that may not read hunts has none
 * to list: the toolbar leaves the dropdown out.
 */
const HuntsMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [hunts, setHunts] = useState<Array<SecurityHunt>>([]);
  const [listState, setListState] = useState<ListState>(ListState.Loading);
  const [toSave, setToSave] = useState<ValuesToSave | null>(null);

  const readGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Read,
  );
  const createGate: PermissionGateResult = PermissionGate.check(
    new SecurityHunt(),
    ModelAction.Create,
  );

  const loadHunts: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

      if (!projectId) {
        return;
      }

      try {
        const result: ListResult<SecurityHunt> =
          await ModelAPI.getList<SecurityHunt>({
            modelType: SecurityHunt,
            query: { projectId: projectId },
            limit: SECURITY_HUNTS_PER_PROJECT_MAX,
            skip: 0,
            select: { _id: true, name: true, schedule: true },
            sort: { name: SortOrder.Ascending },
          });

        setHunts(result.data);
        setListState(ListState.Loaded);
      } catch {
        // Said in the list, which reads again as it next opens.
        setListState(ListState.NotLoaded);
      }
    }, []);

  useEffect(() => {
    if (readGate.isAllowed) {
      void loadHunts();
    }
  }, [readGate.isAllowed, loadHunts]);

  if (!readGate.isAllowed) {
    return <></>;
  }

  const hasSearch: boolean = hasHuntSearchToSave(props.state);

  let createDisabledReason: string | undefined = undefined;

  if (!createGate.isAllowed) {
    createDisabledReason = createGate.disabledReason;
  } else if (!hasSearch) {
    createDisabledReason =
      translator.translateText(SAVE_AS_HUNT_NOTHING_TO_SAVE) ||
      SAVE_AS_HUNT_NOTHING_TO_SAVE;
  }

  let emptyLabel: string = HUNTS_MENU_EMPTY;

  if (listState === ListState.Loading) {
    emptyLabel = HUNTS_MENU_LOADING;
  } else if (listState === ListState.NotLoaded) {
    emptyLabel = HUNTS_MENU_NOT_LOADED;
  }

  return (
    <>
      <SavedViewsDropdown
        dataTestId={HUNTS_TEST_IDS.huntsMenu}
        savedViews={
          listState === ListState.Loaded
            ? hunts.map((hunt: SecurityHunt): SavedViewOption => {
                return toHuntMenuOption({ hunt, translator });
              })
            : []
        }
        selectedSavedViewId={props.currentHuntId || null}
        // A hunt's page names the hunt in its header; the toolbar says Hunts.
        showSelectedNameInTrigger={false}
        showTriggerIcon={true}
        triggerIcon={IconProp.ViewfinderCircle}
        labels={{
          trigger: HUNTS_TABLE_TITLE,
          panel: HUNTS_TABLE_TITLE,
          empty: emptyLabel,
          create: HUNTS_MENU_SAVE_AS_HUNT,
          search: HUNTS_MENU_SEARCH,
        }}
        onOpen={() => {
          if (listState === ListState.NotLoaded) {
            setListState(ListState.Loading);
          }

          void loadHunts();
        }}
        onSelect={(huntId: string) => {
          if (huntId !== props.currentHuntId) {
            Navigation.navigate(getHuntViewRoute(huntId));
          }
        }}
        onCreate={() => {
          setToSave(getHuntValuesToSave(props.state));
        }}
        createDisabledReason={createDisabledReason}
      />
      {toSave ? (
        <ModelFormModal<SecurityHunt>
          modelType={SecurityHunt}
          name="security-events-save-as-hunt"
          title={SAVE_AS_HUNT}
          // The modal draws its description in a <p>: spans, laid out as blocks.
          description={
            <span className="block">
              <span className="block">
                {translator.translateText(SAVE_AS_HUNT_DESCRIPTION) ||
                  SAVE_AS_HUNT_DESCRIPTION}
              </span>
              <span
                className="mt-3 block rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
                data-testid={HUNTS_TEST_IDS.saveSummary}
              >
                <span className="block text-xs font-medium text-gray-500">
                  {translator.translateText(SAVES_THIS_SEARCH) ||
                    SAVES_THIS_SEARCH}
                </span>
                <span className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <HuntSearchLine
                    searchQuery={toSave.searchQuery}
                    filters={toSave.filters}
                  />
                  <span className="whitespace-nowrap text-xs text-gray-500">
                    {translator.translateText(toSave.timeRange) ||
                      toSave.timeRange}
                  </span>
                </span>
              </span>
            </span>
          }
          submitButtonText={SAVE_HUNT}
          onClose={() => {
            setToSave(null);
          }}
          onBeforeCreate={async (item: SecurityHunt): Promise<SecurityHunt> => {
            const projectId: ObjectID | null =
              ProjectUtil.getCurrentProjectId();

            if (projectId) {
              item.projectId = projectId;
            }

            item.searchQuery = toSave.searchQuery;
            item.filters = toSave.filters as unknown as JSONObject;
            item.timeRange = toSave.timeRange;

            return item;
          }}
          onSuccess={(created: SecurityHunt) => {
            setToSave(null);

            if (created._id) {
              Navigation.navigate(getHuntViewRoute(created._id.toString()));
            }
          }}
          /*
           * The modal's own: it hands the form these, in place of any its
           * form props carry - so the person saving it is in Notify as a
           * schedule is chosen.
           */
          initialValues={getNewHuntInitialValues({
            userId: UserUtil.getUserId(),
            timeRange: toSave.timeRange,
          })}
          formProps={{
            name: "security-events-save-as-hunt-form",
            modelType: SecurityHunt,
            id: "security-events-save-as-hunt-form",
            formType: FormType.Create,
            fields: getSaveAsHuntFormFields({ translator }),
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default HuntsMenu;
