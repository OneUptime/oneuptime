import RunnerStatusElement from "./RunnerStatus";
import { getGlobalRunnersUrl } from "./RunnerChoices";
import GlobalRunnersCopy from "./GlobalRunnersCopy";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The global Runners - the Runners OneUptime runs for every project - on
 * Runbooks -> Runners, read-only, as Monitors -> Settings -> Probes lists
 * the global probes: from their own endpoint (no project owns them), with
 * their name, what they are for and whether they are connected. Nobody in a
 * project creates, edits or deletes one; a master admin does, under Admin
 * Dashboard -> Settings -> Global Runners.
 */

export interface ComponentProps {
  // Whether the project uses them (Project.useGlobalRunners), for the description.
  projectUsesGlobalRunners: boolean;
}

export const GLOBAL_RUNNERS_TABLE_ID: string = "global-runners-table";

const GlobalRunnersTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelTable<Runner>
      modelType={Runner}
      id={GLOBAL_RUNNERS_TABLE_ID}
      name="Runbooks > Global Runners"
      userPreferencesKey="global-runners-table"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      showRefreshButton={true}
      cardProps={{
        title: GlobalRunnersCopy.globalCardTitle,
        description: props.projectUsesGlobalRunners
          ? GlobalRunnersCopy.globalCardDescription
          : GlobalRunnersCopy.globalCardDescriptionWhenOff,
      }}
      fetchRequestOptions={{
        overrideRequestUrl: getGlobalRunnersUrl(),
      }}
      selectMoreFields={{
        // The Status cell renders from lastAlive.
        lastAlive: true,
      }}
      noItemsMessage={GlobalRunnersCopy.globalCardDescription}
      filters={[]}
      columns={[
        {
          field: { name: true },
          title: "Name",
          type: FieldType.Text,
        },
        {
          field: { description: true },
          title: "Description",
          type: FieldType.Text,
          hideOnMobile: true,
        },
        {
          field: { lastAlive: true },
          title: "Status",
          type: FieldType.Element,
          disableSort: true,
          getExportValue: (item: Runner): string => {
            return getRunnerLiveStatusLabel(getRunnerLiveStatus(item.lastAlive));
          },
          getElement: (item: Runner): ReactElement => {
            return <RunnerStatusElement runner={item} />;
          },
        },
      ]}
    />
  );
};

export default GlobalRunnersTable;
