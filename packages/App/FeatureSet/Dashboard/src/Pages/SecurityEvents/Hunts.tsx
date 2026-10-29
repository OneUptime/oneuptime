import PageComponentProps from "../PageComponentProps";
import {
  HUNTS_EMPTY_DESCRIPTION,
  HUNTS_EMPTY_TITLE,
  HUNTS_TABLE_DESCRIPTION,
  HUNTS_TABLE_TITLE,
  HUNTS_TEST_IDS,
  HUNT_COLUMN_TITLE,
  HUNT_PLURAL,
  HUNT_SINGULAR,
  LAST_FOUND_COLUMN_TITLE,
  SCHEDULE_COLUMN_TITLE,
  SCHEDULE_LABELS,
  SEARCH_EVENTS,
} from "../../Components/SecurityEvents/Hunts/HuntsCopy";
import {
  HuntLastFoundCell,
  HuntNameCell,
  HuntScheduleCell,
  getHuntRecipientNames,
} from "../../Components/SecurityEvents/Hunts/HuntCells";
import {
  HUNT_FORM_STEPS,
  getHuntFormFields,
  getHuntScheduleDropdownOptions,
  getNewHuntInitialValues,
} from "../../Components/SecurityEvents/Hunts/HuntFormFields";
import {
  getHuntViewRoute,
  getHuntsRoute,
  getSecurityEventsRoute,
} from "../../Components/SecurityEvents/Hunts/HuntsModel";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityHuntSchedule } from "Common/Types/SecurityEvent/SecurityHunt";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { ModalTableBulkDefaultActions } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * SECURITY EVENTS > EVENTS > HUNTS: the searches the team saved, each with
 * its search, how often it runs on its own and who it tells, and what its
 * last run found.
 *
 * A row opens the hunt's page - its search, opened on the Events explorer.
 * Create Hunt asks what it searches for, then whether it runs on a
 * schedule; most hunts are saved from Events instead (Save as Hunt), with
 * the search on screen, and the empty list says so.
 */
const SecurityHuntsPage: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  // Same reseller-telemetry gate as every other Security Events page.
  if (props.currentProject?.reseller?.enableTelemetryFeatures === false) {
    return (
      <ErrorMessage message="Looks like you have bought this plan from a reseller. It did not include telemetry features in your plan. Telemetry features are disabled for this project." />
    );
  }

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelTable<SecurityHunt>
      modelType={SecurityHunt}
      id={HUNTS_TEST_IDS.table}
      name="Security Events > Hunts"
      userPreferencesKey={HUNTS_TEST_IDS.table}
      singularName={HUNT_SINGULAR}
      pluralName={HUNT_PLURAL}
      // A row is named as the team named it: Delete asks about it by name.
      getItemName={(item: SecurityHunt): string => {
        return item.name || "";
      }}
      query={{ projectId }}
      isDeleteable={true}
      bulkActions={{
        buttons: [ModalTableBulkDefaultActions.Delete],
      }}
      isEditable={true}
      isCreateable={true}
      isViewable={true}
      viewButtonText="View"
      viewPageRoute={getHuntsRoute()}
      onCreateSuccess={(item: SecurityHunt): Promise<SecurityHunt> => {
        // A new hunt opens on its search, to see what it finds.
        if (item._id) {
          Navigation.navigate(getHuntViewRoute(item._id.toString()));
        }

        return Promise.resolve(item);
      }}
      sortBy="name"
      sortOrder={SortOrder.Ascending}
      cardProps={{
        title: HUNTS_TABLE_TITLE,
        description: HUNTS_TABLE_DESCRIPTION,
      }}
      emptyState={{
        title: HUNTS_EMPTY_TITLE,
        description: HUNTS_EMPTY_DESCRIPTION,
        icon: IconProp.ViewfinderCircle,
        actions: [
          {
            title: SEARCH_EVENTS,
            icon: IconProp.List,
            dataTestId: "security-hunts-search-events",
            onClick: (): void => {
              Navigation.navigate(getSecurityEventsRoute());
            },
          },
        ],
      }}
      createInitialValues={getNewHuntInitialValues({
        userId: UserUtil.getUserId(),
      })}
      formSteps={HUNT_FORM_STEPS}
      formFields={getHuntFormFields({ translator })}
      showRefreshButton={true}
      searchableFields={["name", "description", "searchQuery"]}
      filters={[
        {
          field: { schedule: true },
          title: SCHEDULE_COLUMN_TITLE,
          type: FieldType.Dropdown,
          filterDropdownOptions: getHuntScheduleDropdownOptions(),
        },
      ]}
      selectMoreFields={{
        description: true,
        searchQuery: true,
        filters: true,
        schedule: true,
        nextRunAt: true,
        lastRunAt: true,
        lastRunError: true,
        lastFoundAt: true,
        lastFoundEventCount: true,
        notifyUsers: {
          _id: true,
          name: true,
          email: true,
        },
        notifyTeams: {
          _id: true,
          name: true,
        },
      }}
      /*
       * Three columns that wrap inside their caps, so the list fits its
       * card beside the side menu: the hunt (its name, its search under
       * it, what it is for), how often it runs and who it tells, and what
       * it last found. Below lg the two short ones fold away and the name
       * carries the hunt.
       */
      columns={[
        {
          field: { name: true },
          title: HUNT_COLUMN_TITLE,
          type: FieldType.Element,
          hideTitleOnMobile: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[24rem]",
          contentClassName: "min-w-[10rem]",
          getExportValue: (item: SecurityHunt): string => {
            return item.name || "";
          },
          getElement: (item: SecurityHunt): ReactElement => {
            return <HuntNameCell hunt={item} />;
          },
        },
        {
          field: { schedule: true },
          title: SCHEDULE_COLUMN_TITLE,
          type: FieldType.Element,
          hideBelowLargeScreen: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[14rem]",
          contentClassName: "min-w-[8rem]",
          getExportValue: (item: SecurityHunt): string => {
            const schedule: SecurityHuntSchedule =
              item.schedule || SecurityHuntSchedule.NotScheduled;

            return [
              translator.translateText(SCHEDULE_LABELS[schedule]) ||
                SCHEDULE_LABELS[schedule],
              ...getHuntRecipientNames(item),
            ].join(" · ");
          },
          getElement: (item: SecurityHunt): ReactElement => {
            return <HuntScheduleCell hunt={item} />;
          },
        },
        {
          field: { lastFoundAt: true },
          title: LAST_FOUND_COLUMN_TITLE,
          type: FieldType.Element,
          hideBelowLargeScreen: true,
          wrapContent: true,
          wrapMaxWidthClassName: "max-w-[14rem]",
          contentClassName: "min-w-[7rem]",
          getExportValue: (item: SecurityHunt): string => {
            return item.lastFoundEventCount
              ? String(item.lastFoundEventCount)
              : "";
          },
          getElement: (item: SecurityHunt): ReactElement => {
            return <HuntLastFoundCell hunt={item} />;
          },
        },
      ]}
    />
  );
};

export default SecurityHuntsPage;
