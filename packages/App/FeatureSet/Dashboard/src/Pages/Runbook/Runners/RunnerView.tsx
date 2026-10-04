import RunnerInstallInstructions from "../../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../../Components/Runner/RunnerStatus";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  NO_RUNNER_FORM_RESTRICTIONS,
  RUNNER_FORM_STEPS,
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
  useState,
} from "react";
import OwnersCard from "../../../Components/Owners/OwnersCard";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const RunnerView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [isRunnerLoaded, setIsRunnerLoaded] = useState<boolean>(false);
  /*
   * What the edit form leaves out: on a Runner the Kubernetes agent chart
   * installed, the name and the runbook / code-fix switches, which the
   * server refuses (RunnerFormFields). Read from the loaded row.
   */
  const [formRestrictions, setFormRestrictions] =
    useState<RunnerFormRestrictions>(NO_RUNNER_FORM_RESTRICTIONS);
  const kubernetesAgentRunnerNote: string | null =
    getKubernetesAgentRunnerFormNote(formRestrictions);

  const translator: Translator = useTranslator();

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
        // The list's steps, so the two forms read alike.
        formSteps={RUNNER_FORM_STEPS}
        formFields={getRunnerFormFields({
          withSteps: true,
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
            {
              field: { canRunCodeFixTasks: true },
              title: "Runs AI Code Fixes",
              fieldType: FieldType.Boolean,
            },
            {
              field: { canRunAiCommands: true },
              title: "Runs AI Remediation Commands",
              fieldType: FieldType.Boolean,
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
           */
          selectMoreFields: { lastAlive: true },
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

                return <span>{item.agentVersion.toString()}</span>;
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
       * Gated on the load, not on the key. A reader who cannot see the key
       * used to get no Setup Instructions card at all and no hint that one
       * exists; now they get the card explaining who can hand them the
       * command. Waiting for the load keeps that explanation from flashing up
       * before we know whether the key is coming.
       */}
      {isRunnerLoaded && (
        <Card
          title="Setup Instructions"
          description={
            <div className="mt-5">
              <RunnerInstallInstructions
                runnerId={modelId}
                runnerKey={agentKey || ""}
              />
            </div>
          }
        />
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
