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
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The global Runners - the Runners OneUptime runs for every project - on
 * Runbooks -> Runners, read-only, as Monitors -> Settings -> Probes lists
 * the global probes: from their own endpoint (no project owns them), with
 * their name, what they are for and whether they are connected. Nobody in a
 * project creates, edits or deletes one; a master admin does, under Admin
 * Dashboard -> Settings -> Global Runners.
 *
 * The card says they run AI code fixes, so one that takes none says so
 * under its status (the boolean the server works out, RunnerService
 * .findGlobalRunners): connected, it runs JavaScript steps, but no
 * repository on the Global Runner gets its fix done there.
 */

export const GLOBAL_RUNNER_ROW_TAKES_NO_CODE_FIXES_TEST_ID: string =
  "global-runner-row-takes-no-code-fixes";

export interface ComponentProps {
  // Whether the project uses them (Project.useGlobalRunners), for the description.
  projectUsesGlobalRunners: boolean;
  /*
   * Whether the project has a default Runner: steps that pick no Runner run
   * on it, not on a global one - the description says so.
   */
  hasProjectDefaultRunner?: boolean | undefined;
}

export const GLOBAL_RUNNERS_TABLE_ID: string = "global-runners-table";

const GlobalRunnersTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

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
        description: !props.projectUsesGlobalRunners
          ? GlobalRunnersCopy.globalCardDescriptionWhenOff
          : props.hasProjectDefaultRunner
            ? GlobalRunnersCopy.globalCardDescriptionWithDefault
            : GlobalRunnersCopy.globalCardDescription,
      }}
      fetchRequestOptions={{
        overrideRequestUrl: getGlobalRunnersUrl(),
      }}
      selectMoreFields={{
        // The Status cell renders from lastAlive.
        lastAlive: true,
        // And says when it takes no AI code fixes.
        takesCodeFixes: true,
      }}
      noItemsMessage={GlobalRunnersCopy.globalEmptyMessage}
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
            return getRunnerLiveStatusLabel(
              getRunnerLiveStatus(item.lastAlive),
            );
          },
          getElement: (item: Runner): ReactElement => {
            if (item.takesCodeFixes !== false) {
              return <RunnerStatusElement runner={item} />;
            }

            return (
              <div>
                <RunnerStatusElement runner={item} />
                <p
                  className="mt-1 text-xs text-amber-700"
                  data-testid={GLOBAL_RUNNER_ROW_TAKES_NO_CODE_FIXES_TEST_ID}
                >
                  {translator.translateText(
                    GlobalRunnersCopy.globalRunnerTakesNoCodeFixes,
                  )}
                </p>
              </div>
            );
          },
        },
      ]}
    />
  );
};

export default GlobalRunnersTable;
