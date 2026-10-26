import RunnerInstallInstructions from "../../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../../Components/Runner/RunnerStatus";
import RunnerCodeRepositoryList, {
  RunnerCodeRepositoriesCopy,
  RunnerCodeRepositoryRow,
  loadRunnerCodeRepositories,
} from "../../../Components/Runner/RunnerCodeRepositories";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import { isKubernetesAgentRunnerRow } from "../../Kubernetes/Utils/KubernetesAgentRunner";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  NO_RUNNER_FORM_RESTRICTIONS,
  RunnerFormRestrictions,
  getKubernetesAgentRunnerFormNote,
  getRunnerFormFields,
  getRunnerFormRestrictions,
} from "./RunnerFormFields";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerOwnerTeam from "Common/Models/DatabaseModels/RunnerOwnerTeam";
import RunnerOwnerUser from "Common/Models/DatabaseModels/RunnerOwnerUser";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import RunnerChoicesLoader from "../../../Components/Runner/RunnerChoices";
import ProjectDefaultRunnerCopy, {
  PROJECT_DEFAULT_REFUSAL_TEXT,
  getMakeDefaultConfirmDescription,
} from "../../../Components/Runner/ProjectDefaultRunnerCopy";
import {
  ProjectDefaultRunnerRefusal,
  getProjectDefaultRunnerRefusal,
} from "Common/Types/Runner/ProjectDefaultRunner";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import ProjectUtil from "Common/UI/Utils/Project";
import RunnerLiveStatus, {
  getRunnerLiveStatus,
} from "Common/Types/Runner/RunnerLiveStatus";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

// The data-testid of the Project Default card's switch.
export const RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID: string =
  "runner-project-default-switch";

const RunnerView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [isRunnerLoaded, setIsRunnerLoaded] = useState<boolean>(false);
  /*
   * What the edit form leaves out: on a Runner the Kubernetes agent chart
   * installed, the name and the runbook switch, which the server refuses
   * (RunnerFormFields). Read from the loaded row.
   */
  const [formRestrictions, setFormRestrictions] =
    useState<RunnerFormRestrictions>(NO_RUNNER_FORM_RESTRICTIONS);
  const kubernetesAgentRunnerNote: string | null =
    getKubernetesAgentRunnerFormNote(formRestrictions);

  /*
   * The code repositories AI works in on this Runner - the ones that pick
   * it, and the ones that follow it while it is the project's default -
   * read once, and again when it becomes or stops being the default:
   * undefined while on their way, null when they cannot be read - by
   * someone who may not read code repositories, or on a plan without Code -
   * and then Runner Details has no row for them.
   */
  const [codeRepositories, setCodeRepositories] = useState<
    Array<RunnerCodeRepositoryRow> | null | undefined
  >(undefined);

  const translator: Translator = useTranslator();

  /*
   * The project's default Runner as it is now - another Runner, this one or
   * none - for the words of the dialog that makes this Runner the default:
   * read on the page's load and after every save of the switch. Undefined
   * while it is unknown.
   */
  const [projectDefaultRunner, setProjectDefaultRunner] = useState<
    { id: string; name: string } | null | undefined
  >(undefined);

  /*
   * This Runner as the Project Default card read it: its name for the
   * dialogs, whether it is the default, and why it may not be one.
   */
  const [defaultCandidate, setDefaultCandidate] = useState<Runner | null>(null);
  const [isProjectDefault, setIsProjectDefault] = useState<boolean>(false);

  useEffect(() => {
    let isMounted: boolean = true;

    loadRunnerCodeRepositories(modelId, { isProjectDefault })
      .then((rows: Array<RunnerCodeRepositoryRow> | null) => {
        if (isMounted) {
          setCodeRepositories(rows);
        }
      })
      .catch(() => {
        if (isMounted) {
          setCodeRepositories(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [modelId.toString(), isProjectDefault]);

  const readProjectDefaultRunner: () => void = (): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    RunnerChoicesLoader.loadProjectDefaultRunner(projectId)
      .then((runner: { id: string; name: string } | null) => {
        setProjectDefaultRunner(runner);
      })
      .catch(() => {
        setProjectDefaultRunner(undefined);
      });
  };

  useEffect(() => {
    readProjectDefaultRunner();
  }, [modelId.toString()]);

  /*
   * The Runner that is the project's default now, when it is another one:
   * named by the dialog that makes this one the default, and by the
   * switch's line while it is off.
   */
  const otherDefaultName: string | undefined =
    projectDefaultRunner &&
    projectDefaultRunner.id.toLowerCase() !== modelId.toString().toLowerCase()
      ? projectDefaultRunner.name
      : undefined;

  /*
   * Why this Runner may not be made the default, while it is not one: an
   * in-cluster Runner the Kubernetes agent chart installed, or one with
   * Runs Runbooks off. The default itself can always stop being one.
   */
  const defaultRefusal: ProjectDefaultRunnerRefusal | null =
    defaultCandidate && !isProjectDefault
      ? getProjectDefaultRunnerRefusal(defaultCandidate)
      : null;

  // Asked before the switch moves, saying which steps move.
  const getProjectDefaultConfirmation: (
    isTurningOn: boolean,
  ) => ModelSwitchConfirmation = (
    isTurningOn: boolean,
  ): ModelSwitchConfirmation => {
    const name: string = defaultCandidate?.name || "";

    if (!isTurningOn) {
      return {
        title: translator.translateTemplate(
          ProjectDefaultRunnerCopy.stopDefaultConfirmTitle,
          { runner: name },
        ),
        description: ProjectDefaultRunnerCopy.stopDefaultConfirmDescription,
        submitButtonText: ProjectDefaultRunnerCopy.stopDefaultConfirmButton,
      };
    }

    const description: { template: string; current?: string | undefined } =
      getMakeDefaultConfirmDescription(otherDefaultName);

    /*
     * A Runner that is not connected is said to be, before it is the
     * default: a warning of its own under what moves.
     */
    const isConnected: boolean =
      getRunnerLiveStatus(defaultCandidate?.lastAlive) ===
      RunnerLiveStatus.Connected;

    return {
      title: translator.translateTemplate(
        ProjectDefaultRunnerCopy.makeDefaultConfirmTitle,
        { runner: name },
      ),
      description: translator.translateTemplate(description.template, {
        current: description.current || "",
      }),
      submitButtonText: ProjectDefaultRunnerCopy.makeDefaultConfirmButton,
      ...(isConnected
        ? {}
        : {
            warning: translator.translateTemplate(
              ProjectDefaultRunnerCopy.makeDefaultNotConnectedWarning,
              { runner: name },
            ),
          }),
    };
  };

  /*
   * The switch's line. On: what it does. Off: why it is locked, on a Runner
   * that may not be the default - said where it is read, not only in a
   * tooltip - or where the steps that pick no Runner run now: on the Runner
   * that is the default, named, or the general rule while there is none.
   */
  const getProjectDefaultSwitchDescription: (isOn: boolean) => string = (
    isOn: boolean,
  ): string => {
    if (isOn) {
      return ProjectDefaultRunnerCopy.switchOnDescription;
    }

    if (defaultRefusal) {
      return PROJECT_DEFAULT_REFUSAL_TEXT[defaultRefusal];
    }

    if (otherDefaultName) {
      return translator.translateTemplate(
        ProjectDefaultRunnerCopy.switchOffDescriptionWithDefault,
        { runner: otherDefaultName },
      );
    }

    return ProjectDefaultRunnerCopy.switchOffDescription;
  };

  /*
   * Reused by the three Status-card fields that have nothing to show until the
   * Runner has checked in at least once. An empty cell reads as "we lost it";
   * this reads as "it has not reported yet", which is what is actually true.
   *
   * A function, not a hoisted element: ModelDetail snapshots these getElement
   * closures into state once on mount, so a single element built up here would
   * carry whatever translation was active at that moment and keep rendering it
   * after the viewer switched language.
   */
  const notReportedYet: GetReactElementFunction = (): ReactElement => {
    return (
      <span className="text-gray-500">
        {translator.translateText("Not reported yet")}
      </span>
    );
  };

  return (
    <Fragment>
      <CardModelDetail<Runner>
        name="Runner Details"
        cardProps={{
          title: "Runner Details",
          /*
           * The title says what the card holds. Only a Runner the Kubernetes
           * agent chart installed has more to say: why its form is short.
           */
          description: kubernetesAgentRunnerNote ? (
            <span data-testid="kubernetes-agent-runner-note">
              {kubernetesAgentRunnerNote}
            </span>
          ) : undefined,
        }}
        isEditable={true}
        /*
         * The form is built from the loaded row, so editing waits for it:
         * before the load the page cannot tell an agent row from any other.
         */
        onBeforeEdit={(): boolean => {
          return isRunnerLoaded;
        }}
        // The list's form, so the two read alike: one page.
        formFields={getRunnerFormFields({
          restrictions: formRestrictions,
        })}
        modelDetailProps={{
          onItemLoaded: (item: Runner) => {
            if (item.key) {
              setAgentKey(item.key as string);
            }
            setFormRestrictions(getRunnerFormRestrictions(item));
            setIsRunnerLoaded(true);
          },
          modelType: Runner,
          id: "model-detail-runbook-agent",
          // The posture: whether this is a Runner the Kubernetes agent chart installed.
          selectMoreFields: { hostInfo: true },
          fields: [
            {
              field: { _id: true },
              title: "Runner ID",
              fieldType: FieldType.ObjectID,
              /*
               * A Runner is installed with its ID and its key
               * (ONEUPTIME_RUNNER_ID, ONEUPTIME_RUNNER_KEY), so the ID stays
               * a field, read beside the key, rather than going to the
               * card's ID line.
               */
              showIdAsField: true,
            },
            {
              field: { name: true },
              title: "Name",
            },
            {
              field: { description: true },
              title: "Description",
            },
            {
              field: { key: true },
              title: "Runner Key",
              fieldType: FieldType.HiddenText,
            },
            {
              field: { canRunRunbooks: true },
              title: "Runs Runbooks",
              fieldType: FieldType.Boolean,
            },
            /*
             * What replaced the "Runs AI Code Fixes" switch, where it was:
             * the code repositories that pick this Runner, each linked to
             * its settings in Code, where a repository picks its Runner -
             * or, with none, where that is done. Not on an in-cluster
             * Runner the Kubernetes agent chart installed, which no
             * repository may pick, nor for someone who cannot read the
             * repositories. "Runs AI Remediation Commands" is gone the same
             * way: an auto remediation rule, or a Kubernetes cluster's AI
             * settings, picks the Runner OneUptime AI runs its commands on.
             */
            {
              field: { _id: true },
              title: RunnerCodeRepositoriesCopy.title,
              fieldType: FieldType.Element,
              showIf: (item: Runner): boolean => {
                return (
                  Array.isArray(codeRepositories) &&
                  !isKubernetesAgentRunnerRow(item)
                );
              },
              getElement: (): ReactElement => {
                return (
                  <RunnerCodeRepositoryList
                    repositories={codeRepositories || []}
                  />
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
              fieldType: FieldType.Element,
              getElement: (item: Runner): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
          ],
          modelId: modelId,
        }}
      />

      <CardModelDetail<Runner>
        name="Runner Status"
        cardProps={{
          title: "Runner Status",
        }}
        isEditable={false}
        modelDetailProps={{
          modelType: Runner,
          id: "model-detail-runbook-agent-status",
          /*
           * lastAlive drives all three fields — it is the only column that
           * tells the truth about a Runner. connectionStatus is written once
           * on create and once on the first heartbeat and never again, so a
           * Runner that died months ago still has it set to "connected".
           *
           * The name and the posture say whether the Kubernetes agent chart
           * installed this Runner, which decides how it is upgraded.
           */
          selectMoreFields: { lastAlive: true, name: true, hostInfo: true },
          fields: [
            {
              field: { connectionStatus: true },
              title: "Connection Status",
              fieldType: FieldType.Element,
              getElement: (item: Runner): ReactElement => {
                return <RunnerStatusElement runner={item} />;
              },
            },
            {
              field: { lastAlive: true },
              title: "Last Heartbeat",
              fieldType: FieldType.Element,
              getElement: (item: Runner): ReactElement => {
                if (!item.lastAlive) {
                  return notReportedYet();
                }

                /*
                 * Relative first because that is the question being asked of
                 * this field; the exact timestamp underneath for anyone
                 * correlating against their own logs.
                 */
                return (
                  <div>
                    <div>{OneUptimeDate.fromNow(item.lastAlive)}</div>
                    <div className="text-xs text-gray-500">
                      {OneUptimeDate.getDateAsLocalFormattedString(
                        item.lastAlive,
                      )}
                    </div>
                  </div>
                );
              },
            },
            {
              field: { agentVersion: true },
              title: "Runner Version",
              fieldType: FieldType.Element,
              getElement: (item: Runner): ReactElement => {
                /*
                 * RunnerService.onBeforeCreate stamps every new row with
                 * 1.0.0 before any Runner has spoken to us, so the column is
                 * never empty and cannot be trusted on its own. lastAlive is
                 * what separates a self-reported version from that
                 * placeholder.
                 */
                if (!item.lastAlive || !item.agentVersion) {
                  return notReportedYet();
                }

                /*
                 * A sign beside an outdated version opens how to upgrade
                 * it: the Runner's image, or - for a Runner the Kubernetes
                 * agent chart installed - the chart.
                 */
                return (
                  <AgentVersion
                    kind={
                      isKubernetesAgentRunnerRow(item)
                        ? AgentKind.KubernetesAgent
                        : AgentKind.Runner
                    }
                    version={item.agentVersion.toString()}
                  />
                );
              },
            },
            {
              field: { hostInfo: true },
              title: "Host",
              fieldType: FieldType.Element,
              getElement: (item: Runner): ReactElement => {
                const hostInfo: JSONObject | undefined | null =
                  item.hostInfo as JSONObject | undefined | null;

                if (!item.lastAlive || !hostInfo) {
                  return notReportedYet();
                }

                /*
                 * Self-reported by the container on each heartbeat. Shown
                 * because "which machine is this actually running on" is the
                 * first thing asked when a Runner misbehaves, and until now
                 * the answer was only in the database.
                 */
                const hostname: string = String(hostInfo["hostname"] || "");

                const platformLine: string = [
                  String(hostInfo["platform"] || ""),
                  String(hostInfo["arch"] || ""),
                  String(hostInfo["release"] || ""),
                ]
                  .filter((part: string): boolean => {
                    return Boolean(part);
                  })
                  .join(" · ");

                if (!hostname && !platformLine) {
                  return notReportedYet();
                }

                return (
                  <div>
                    {hostname ? (
                      <div className="font-mono text-sm">{hostname}</div>
                    ) : (
                      <></>
                    )}
                    {platformLine ? (
                      <div className="text-xs text-gray-500">
                        {platformLine}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />

      {/*
       * Whether this Runner is the project's default: the steps that pick no
       * Runner run on it. After what the Runner is and how it is doing, as a
       * setting of how the project uses it. One switch that saves when it is
       * flipped, asking first which steps move; locked on a Runner that may
       * not be the default, its line saying why.
       */}
      <ModelSwitchCard<Runner>
        modelType={Runner}
        modelId={modelId}
        column="isProjectDefault"
        cardTitle={ProjectDefaultRunnerCopy.switchCardTitle}
        cardDescription={ProjectDefaultRunnerCopy.switchCardDescription}
        title={ProjectDefaultRunnerCopy.switchTitle}
        getDescription={getProjectDefaultSwitchDescription}
        getConfirmation={getProjectDefaultConfirmation}
        select={{
          name: true,
          canRunRunbooks: true,
          hostInfo: true,
          lastAlive: true,
        }}
        onLoaded={(item: Runner): void => {
          setDefaultCandidate(item);
        }}
        onChange={(isOn: boolean): void => {
          setIsProjectDefault(isOn);
        }}
        onSaved={(): void => {
          readProjectDefaultRunner();
        }}
        lockedReason={
          defaultRefusal
            ? PROJECT_DEFAULT_REFUSAL_TEXT[defaultRefusal]
            : undefined
        }
        dataTestId={RUNNER_PROJECT_DEFAULT_SWITCH_TEST_ID}
      />

      {/*
       * Gated on the load, not on the key. A reader who cannot see the key
       * used to get no Setup Instructions card at all and no hint that one
       * exists; now they get the card explaining who can hand them the
       * command. Waiting for the load keeps that explanation from flashing up
       * before we know whether the key is coming.
       *
       * The instructions are the card's body, not its description: a card
       * hides its description below md, which left a phone with the title
       * and no command, and a description is a paragraph, which cannot hold
       * the command's block.
       */}
      {isRunnerLoaded && (
        <Card title="Setup Instructions">
          <RunnerInstallInstructions
            runnerId={modelId}
            runnerKey={agentKey || ""}
          />
        </Card>
      )}

      {/*
       * Its owners, people and teams together, added and removed the way
       * the Owners pages and every owners field do.
       */}
      <OwnersCard<RunnerOwnerUser, RunnerOwnerTeam>
        resourceId={modelId}
        resourceIdField="runnerId"
        resourceDisplayName="runner"
        ownerUserModelType={RunnerOwnerUser}
        ownerTeamModelType={RunnerOwnerTeam}
        description="People and teams who own this runner. They are alerted when its status changes."
        emptyDescription="Add a teammate or a team so they are alerted when this runner's status changes."
      />

      <ResetObjectID<Runner>
        modelType={Runner}
        onUpdateComplete={async () => {
          Navigation.reload();
        }}
        fieldName={"key"}
        title={"Reset Runner Key"}
        description={
          <p className="mt-2">
            {translator.translateText(
              "Resetting the secret key will generate a new key. The secret is used to authenticate this Runner's requests. This Runner will stop connecting until the new key is configured on it, so re-run the setup command on its host afterwards.",
            )}
          </p>
        }
        modelId={modelId}
      />

      <ModelDelete
        modelType={Runner}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.RUNBOOKS_RUNNERS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default RunnerView;
