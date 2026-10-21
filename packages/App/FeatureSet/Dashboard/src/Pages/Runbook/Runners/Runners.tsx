import RunnerInstallInstructions from "../../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../../Components/Runner/RunnerStatus";
import GlobalRunnersTable from "../../../Components/Runner/GlobalRunnersTable";
import UseGlobalRunnersCard from "../../../Components/Runner/UseGlobalRunnersCard";
import RunnerChoicesLoader, {
  GlobalRunnerRow,
} from "../../../Components/Runner/RunnerChoices";
import ProjectDefaultRunnerCopy, {
  PROJECT_DEFAULT_REFUSAL_TEXT,
  getMakeDefaultConfirmDescription,
} from "../../../Components/Runner/ProjectDefaultRunnerCopy";
import {
  ProjectDefaultRunnerRefusal,
  getProjectDefaultRunnerRefusal,
} from "Common/Types/Runner/ProjectDefaultRunner";
import { ActionButtonPlacement } from "Common/UI/Components/ActionButton/ActionButtonSchema";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
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
import RunnerLiveStatus, {
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "Common/Types/Runner/RunnerLiveStatus";
import { Gray500, Green } from "Common/Types/BrandColors";
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
 * One of the project's own Runners can be its default (Project Default
 * column; "Set as Project Default" in a Runner's ⋯ menu, as a Twilio config
 * is made the project default): a step that picks no Runner runs on it, in
 * place of the Global Runner. Changing it asks first, saying which steps
 * move.
 *
 * On a server that has no global Runner (a self-hosted install whose admin
 * added none), the page shows the project's own Runners only, as it always
 * did, and tells a master admin where global Runners are added.
 */

// A change of the project's default Runner, waiting on its dialog.
interface DefaultRunnerChange {
  runner: Runner;
  // True: make it the default. False: stop using it as the default.
  makeDefault: boolean;
}
const RunnersPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [showSetupAgent, setShowSetupAgent] = useState<Runner | null>(null);

  // Null until read: the page draws once it knows whether there are any.
  const [globalRunners, setGlobalRunners] =
    useState<Array<GlobalRunnerRow> | null>(null);

  const [projectUsesGlobalRunners, setProjectUsesGlobalRunners] =
    useState<boolean>(true);

  /*
   * The project's default Runner, read on its own (the table's rows can be
   * filtered and paged): null for none, undefined until it is read - and
   * when it cannot be read, so nothing is claimed about it.
   */
  const [projectDefaultRunner, setProjectDefaultRunner] = useState<
    { id: string; name: string } | null | undefined
  >(undefined);

  // Whether the project's own Runners table lists any (as last fetched).
  const [hasProjectRunners, setHasProjectRunners] = useState<boolean>(false);

  const [defaultRunnerChange, setDefaultRunnerChange] =
    useState<DefaultRunnerChange | null>(null);
  const [isChangingDefault, setIsChangingDefault] = useState<boolean>(false);
  const [defaultChangeError, setDefaultChangeError] = useState<string>("");
  const [refreshToggle, setRefreshToggle] = useState<string>("0");

  const { translateString }: UseTranslateValueResult = useTranslateValue();
  const translator: Translator = useTranslator();

  const readProjectDefaultRunner: () => Promise<void> =
    async (): Promise<void> => {
      try {
        setProjectDefaultRunner(
          await RunnerChoicesLoader.loadProjectDefaultRunner(
            ProjectUtil.getCurrentProjectId()!,
          ),
        );
      } catch {
        setProjectDefaultRunner(undefined);
      }
    };

  useAsyncEffect(async () => {
    setGlobalRunners(await RunnerChoicesLoader.loadGlobalRunners());
  }, []);

  useAsyncEffect(async () => {
    await readProjectDefaultRunner();
  }, []);

  /*
   * Making a Runner the default writes one column, which a role may be
   * allowed to edit or not: the ⋯ menu's actions are locked, with the
   * reason, for someone who may not.
   */
  const setDefaultGate: PermissionGateResult = PermissionGate.checkColumnUpdate(
    new Runner(),
    "isProjectDefault",
  );

  const isDefaultActionShown: boolean =
    setDefaultGate.isAllowed || Boolean(setDefaultGate.disabledReason);

  // Writes the change the dialog asked about; the server moves the default.
  const saveDefaultRunnerChange: () => Promise<void> =
    async (): Promise<void> => {
      if (!defaultRunnerChange) {
        return;
      }

      setIsChangingDefault(true);
      setDefaultChangeError("");

      try {
        await ModelAPI.updateById<Runner>({
          modelType: Runner,
          id: new ObjectID(defaultRunnerChange.runner._id?.toString() || ""),
          data: {
            isProjectDefault: defaultRunnerChange.makeDefault,
          },
        });

        setDefaultRunnerChange(null);
        setRefreshToggle((value: string): string => {
          return String(Number(value) + 1);
        });
        await readProjectDefaultRunner();
      } catch (err) {
        setDefaultChangeError(API.getFriendlyMessage(err));
      } finally {
        setIsChangingDefault(false);
      }
    };

  // The dialog that asks before the default moves.
  const renderDefaultRunnerChangeDialog: () => ReactElement =
    (): ReactElement => {
      if (!defaultRunnerChange) {
        return <></>;
      }

      const name: string = defaultRunnerChange.runner.name || "";

      if (!defaultRunnerChange.makeDefault) {
        return (
          <ConfirmModal
            title={translator.translateTemplate(
              ProjectDefaultRunnerCopy.stopDefaultConfirmTitle,
              { runner: name },
            )}
            description={ProjectDefaultRunnerCopy.stopDefaultConfirmDescription}
            submitButtonText={ProjectDefaultRunnerCopy.stopDefaultConfirmButton}
            submitButtonType={ButtonStyleType.PRIMARY}
            isLoading={isChangingDefault}
            error={defaultChangeError}
            onClose={() => {
              setDefaultRunnerChange(null);
              setDefaultChangeError("");
            }}
            onSubmit={() => {
              void saveDefaultRunnerChange();
            }}
          />
        );
      }

      const currentDefaultName: string | undefined =
        projectDefaultRunner &&
        projectDefaultRunner.id.toLowerCase() !==
          (defaultRunnerChange.runner._id?.toString() || "").toLowerCase()
          ? projectDefaultRunner.name
          : undefined;

      const description: { template: string; current?: string | undefined } =
        getMakeDefaultConfirmDescription(currentDefaultName);

      // A Runner that is not connected is said to be, before it is the default.
      const isConnected: boolean =
        getRunnerLiveStatus(defaultRunnerChange.runner.lastAlive) ===
        RunnerLiveStatus.Connected;

      return (
        <ConfirmModal
          title={translator.translateTemplate(
            ProjectDefaultRunnerCopy.makeDefaultConfirmTitle,
            { runner: name },
          )}
          description={[
            translator.translateTemplate(description.template, {
              current: description.current || "",
            }),
            ...(isConnected
              ? []
              : [
                  translator.translateTemplate(
                    ProjectDefaultRunnerCopy.makeDefaultNotConnectedWarning,
                    { runner: name },
                  ),
                ]),
          ].join(" ")}
          submitButtonText={ProjectDefaultRunnerCopy.makeDefaultConfirmButton}
          submitButtonType={ButtonStyleType.PRIMARY}
          isLoading={isChangingDefault}
          error={defaultChangeError}
          onClose={() => {
            setDefaultRunnerChange(null);
            setDefaultChangeError("");
          }}
          onSubmit={() => {
            void saveDefaultRunnerChange();
          }}
        />
      );
    };

  if (globalRunners === null) {
    return <ComponentLoader />;
  }

  const hasGlobalRunners: boolean = globalRunners.length > 0;

  /*
   * A master admin on a server with no global Runner is told where to add
   * them, under the description everyone reads.
   */
  const baseCardDescription: string | ReactElement = hasGlobalRunners ? (
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

  /*
   * Then, while the project has Runners and none of them is its default,
   * that one can be made the default - the ⋯ menu's action, said where the
   * Runners are. With a default, its row says so instead; with no Runner
   * yet, adding one comes first.
   */
  const cardDescription: string | ReactElement =
    projectDefaultRunner === null && hasProjectRunners ? (
      <span>
        {typeof baseCardDescription === "string"
          ? translator.translateText(baseCardDescription)
          : baseCardDescription}{" "}
        <span data-testid="project-default-runner-hint">
          {translator.translateText(
            ProjectDefaultRunnerCopy.customCardSentence,
          )}
        </span>
      </span>
    ) : (
      baseCardDescription
    );

  return (
    <Fragment>
      {hasGlobalRunners ? (
        <GlobalRunnersTable
          projectUsesGlobalRunners={projectUsesGlobalRunners}
          hasProjectDefaultRunner={Boolean(projectDefaultRunner)}
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
        refreshToggle={refreshToggle}
        onFetchSuccess={(_items: Array<Runner>, totalCount: number): void => {
          setHasProjectRunners(totalCount > 0);
        }}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: hasGlobalRunners
            ? GlobalRunnersCopy.customCardTitle
            : GlobalRunnersCopy.onlyCardTitle,
          description: cardDescription,
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
          // Whether it may be the project default (the ⋯ menu's action).
          canRunRunbooks: true,
          // The default says so beside its name.
          isProjectDefault: true,
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
          {
            /*
             * Steps that pick no Runner run on this one instead: on every
             * row but the default's, in the ⋯ menu, locked with why on a
             * Runner that may not be it.
             */
            title: ProjectDefaultRunnerCopy.setDefaultTitle,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Check,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !setDefaultGate.isAllowed,
            tooltip: setDefaultGate.disabledReason,
            isVisible: (item: Runner): boolean => {
              return item.isProjectDefault !== true && isDefaultActionShown;
            },
            getDisabledReason: (item: Runner): string | undefined => {
              const refusal: ProjectDefaultRunnerRefusal | null =
                getProjectDefaultRunnerRefusal(item);

              return refusal
                ? translator.translateText(
                    PROJECT_DEFAULT_REFUSAL_TEXT[refusal],
                  )
                : undefined;
            },
            onClick: (item: Runner, onCompleteAction: VoidFunction): void => {
              setDefaultChangeError("");
              setDefaultRunnerChange({ runner: item, makeDefault: true });
              onCompleteAction();
            },
          },
          {
            // Back to the Global Runner for the steps that pick no Runner.
            title: ProjectDefaultRunnerCopy.stopDefaultTitle,
            buttonStyleType: ButtonStyleType.OUTLINE,
            icon: IconProp.Close,
            placement: ActionButtonPlacement.MoreMenu,
            disabled: !setDefaultGate.isAllowed,
            tooltip: setDefaultGate.disabledReason,
            isVisible: (item: Runner): boolean => {
              return item.isProjectDefault === true && isDefaultActionShown;
            },
            onClick: (item: Runner, onCompleteAction: VoidFunction): void => {
              setDefaultChangeError("");
              setDefaultRunnerChange({ runner: item, makeDefault: false });
              onCompleteAction();
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
            /*
             * The project's default Runner - the one the steps that pick no
             * Runner run on - says so beside its name, where a reader looks
             * first, rather than in a column of its own that would push
             * Last Seen under the row's buttons.
             */
            field: { name: true },
            title: "Name",
            type: FieldType.Text,
            getElement: (item: Runner): ReactElement => {
              return (
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{item.name}</span>
                  {item.isProjectDefault ? (
                    <span data-testid="runner-project-default-pill">
                      <Pill
                        text={ProjectDefaultRunnerCopy.pillText}
                        color={Green}
                        size={PillSize.Small}
                      />
                    </span>
                  ) : (
                    <></>
                  )}
                </span>
              );
            },
            getExportValue: (item: Runner): string => {
              return item.name || "";
            },
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
          hasProjectDefaultRunner={Boolean(projectDefaultRunner)}
        />
      ) : (
        <></>
      )}

      {renderDefaultRunnerChangeDialog()}

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
