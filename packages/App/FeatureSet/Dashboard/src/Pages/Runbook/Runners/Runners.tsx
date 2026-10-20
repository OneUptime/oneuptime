import RunnerInstallInstructions from "../../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../../Components/Runner/RunnerStatus";
import GlobalRunnersTable from "../../../Components/Runner/GlobalRunnersTable";
import UseGlobalRunnersCard from "../../../Components/Runner/UseGlobalRunnersCard";
import RunnerChoicesLoader, {
  GlobalRunnerRow,
} from "../../../Components/Runner/RunnerChoices";
import GlobalRunnersCopy, {
  ADMIN_GLOBAL_RUNNERS_ROUTE,
} from "../../../Components/Runner/GlobalRunnersCopy";
import PageComponentProps from "../../PageComponentProps";
import { getRunnerCreateFormFields } from "./RunnerFormFields";
import ProjectUtil from "Common/UI/Utils/Project";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import LabelsElement from "Common/UI/Components/Label/Labels";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill, { PillSize } from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import UserUtil from "Common/UI/Utils/User";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import URL from "Common/Types/API/URL";
import { ADMIN_DASHBOARD_URL } from "Common/UI/Config";
import { useAsyncEffect } from "use-async-effect";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import Label from "Common/Models/DatabaseModels/Label";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import { Gray500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Runbooks -> Runners, read like Monitors -> Settings -> Probes:
 *
 *   - Global Runners: the Runners OneUptime runs for every project, on top
 *     and read-only. A JavaScript step that picks no Runner of its own runs
 *     on one.
 *   - Custom Runners: the project's own, installed in its own
 *     infrastructure - for Bash, SSH and Kubernetes steps, anything on its
 *     network, and for a team that keeps every step on its own hosts. With
 *     none yet, one plain sentence says why to add one.
 *   - Use global Runners: the project's one switch for the global ones.
 *
 * On a server that has no global Runner (a self-hosted install whose admin
 * added none), the page shows the project's own Runners only, as it always
 * did, and tells a master admin where global Runners are added.
 */
const RunnersPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showSetupAgent, setShowSetupAgent] = useState<Runner | null>(null);

  // Null until read: the page draws once it knows whether there are any.
  const [globalRunners, setGlobalRunners] =
    useState<Array<GlobalRunnerRow> | null>(null);

  const [projectUsesGlobalRunners, setProjectUsesGlobalRunners] =
    useState<boolean>(true);

  const { translateString }: UseTranslateValueResult = useTranslateValue();
  const translator: Translator = useTranslator();

  useAsyncEffect(async () => {
    setGlobalRunners(await RunnerChoicesLoader.loadGlobalRunners());
  }, []);

  if (globalRunners === null) {
    return <ComponentLoader />;
  }

  const hasGlobalRunners: boolean = globalRunners.length > 0;

  /*
   * A master admin on a server with no global Runner is told where to add
   * them, under the description everyone reads.
   */
  const customCardDescription: string | ReactElement = hasGlobalRunners ? (
    GlobalRunnersCopy.customCardDescription
  ) : UserUtil.isMasterAdmin() ? (
    <span>
      {translator.translateText(GlobalRunnersCopy.onlyCardDescription)}{" "}
      <span data-testid="add-global-runners-hint">
        <TranslatedSentence
          template={GlobalRunnersCopy.addGlobalRunnersHint}
          slots={{
            location: (
              <Link
                to={URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
                  ADMIN_GLOBAL_RUNNERS_ROUTE,
                )}
                openInNewTab={true}
                className="underline"
              >
                {translator.translateText(
                  GlobalRunnersCopy.addGlobalRunnersLink,
                )}
              </Link>
            ),
          }}
        />
      </span>
    </span>
  ) : (
    GlobalRunnersCopy.onlyCardDescription
  );

  return (
    <Fragment>
      {hasGlobalRunners ? (
        <GlobalRunnersTable
          projectUsesGlobalRunners={projectUsesGlobalRunners}
        />
      ) : (
        <></>
      )}

      <ModelTable<Runner>
        modelType={Runner}
        id="runbook-agents-table"
        userPreferencesKey="runbook-agents-table"
        saveFilterProps={{
          tableId: "runbook-agents-table",
        }}
        name="Runners"
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        isDeleteable={true}
        /*
         * No Edit on the rows: a Runner is edited in one place, the Runner
         * Details card on its own page (View), whose form follows the row -
         * an in-cluster Runner the Kubernetes agent installed keeps its name
         * and switches. This form is the Create form, never restricted.
         */
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        showRefreshButton={true}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: hasGlobalRunners
            ? GlobalRunnersCopy.customCardTitle
            : GlobalRunnersCopy.onlyCardTitle,
          description: customCardDescription,
        }}
        selectMoreFields={{
          _id: true,
          key: true,
          // The posture: whether a row is a Runner the Kubernetes agent chart installed.
          hostInfo: true,
          /*
           * The Status column renders from lastAlive, so it has to be
           * selected here and not only by the Last Seen column — a Runner
           * fetched without it reads as never connected.
           */
          lastAlive: true,
        }}
        noItemsMessage={
          hasGlobalRunners
            ? GlobalRunnersCopy.customEmptyMessage
            : GlobalRunnersCopy.onlyEmptyMessage
        }
        viewPageRoute={Navigation.getCurrentRoute()}
        // One page: Name, Description and More fields (RunnerFormFields).
        formFields={getRunnerCreateFormFields()}
        searchableFields={["name", "description"]}
        actionButtons={[
          {
            title: "Show setup instructions",
            icon: IconProp.CommandLine,
            buttonStyleType: ButtonStyleType.NORMAL,
            onClick: async (
              item: Runner,
              onCompleteAction: VoidFunction,
              onError: ErrorFunction,
            ) => {
              try {
                setShowSetupAgent(item);
                onCompleteAction();
              } catch (err) {
                onCompleteAction();
                onError(err as Error);
              }
            },
          },
        ]}
        filters={[
          {
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
          },
          {
            title: "Labels",
            type: FieldType.EntityArray,
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
        ]}
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
          },
          {
            /*
             * Rendered from lastAlive, not from connectionStatus — the column
             * this field names is written on create and on the first heartbeat
             * and never again, so it reports every Runner that ever connected
             * as connected forever. lastAlive comes in via selectMoreFields.
             */
            field: { connectionStatus: true },
            title: "Status",
            type: FieldType.Element,
            /*
             * Sorting and CSV export both go straight to the named column and
             * never through getElement, so leaving them on the default would
             * order and export the stale value this cell exists to stop
             * showing. Sorting is disabled outright — Last Seen next to it
             * sorts on lastAlive, which is the ordering "sort by status"
             * actually means — and the export is given the derived text.
             */
            disableSort: true,
            getExportValue: (item: Runner): string => {
              return getRunnerLiveStatusLabel(
                getRunnerLiveStatus(item.lastAlive),
              );
            },
            getElement: (item: Runner): ReactElement => {
              return <RunnerStatusElement runner={item} showLastSeen={false} />;
            },
          },
          {
            field: { lastAlive: true },
            title: "Last Seen",
            type: FieldType.Element,
            /*
             * Without this the export writes a raw Date toString next to a
             * column that reads "3 months ago" on screen.
             */
            getExportValue: (item: Runner): string => {
              if (!item.lastAlive) {
                return "Never";
              }

              return OneUptimeDate.fromNow(item.lastAlive);
            },
            getElement: (item: Runner): ReactElement => {
              if (!item.lastAlive) {
                return (
                  <span className="text-gray-500">
                    {translator.translateText("Never")}
                  </span>
                );
              }
              return <span>{OneUptimeDate.fromNow(item.lastAlive)}</span>;
            },
          },
          {
            field: { canRunRunbooks: true },
            title: "Capabilities",
            type: FieldType.Element,
            getElement: (item: Runner): ReactElement => {
              const capabilities: Array<string> = [];

              if (item.canRunRunbooks !== false) {
                capabilities.push("Runbooks");
              }

              if (capabilities.length === 0) {
                return (
                  <span className="text-gray-500">
                    {translator.translateText("None")}
                  </span>
                );
              }

              /*
               * Pills rather than a comma-joined sentence, so the column can
               * be scanned down. AI code fixes and AI remediation commands
               * are not ones: a code repository picks its Runner in Code,
               * and an auto remediation rule (or a cluster's AI settings)
               * picks the Runner OneUptime AI runs its commands on.
               */
              return (
                <div className="flex flex-wrap gap-1">
                  {capabilities.map((capability: string): ReactElement => {
                    return (
                      <Pill
                        key={capability}
                        text={translateString(capability) || capability}
                        color={Gray500}
                        size={PillSize.Small}
                      />
                    );
                  })}
                </div>
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            getElement: (item: Runner): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
        ]}
      />

      {hasGlobalRunners ? (
        <UseGlobalRunnersCard
          projectId={ProjectUtil.getCurrentProjectId()!}
          onChange={setProjectUsesGlobalRunners}
        />
      ) : (
        <></>
      )}

      {showSetupAgent ? (
        <Modal
          title="Runner setup"
          modalWidth={ModalWidth.Medium}
          onClose={() => {
            setShowSetupAgent(null);
          }}
          closeButtonText="Done"
        >
          <RunnerInstallInstructions
            runnerId={new ObjectID(showSetupAgent._id!.toString())}
            runnerKey={(showSetupAgent.key as string) || ""}
          />
        </Modal>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default RunnersPage;
