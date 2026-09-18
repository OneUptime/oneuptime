import RunnerInstallInstructions from "../../Components/Runner/InstallInstructions";
import RunnerStatusElement from "../../Components/Runner/RunnerStatus";
import TeamElement from "../../Components/Team/Team";
import UserElement from "../../Components/User/User";
import PageMap from "../../Utils/PageMap";
import ProjectUser from "../../Utils/ProjectUser";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import LabelsElement from "Common/UI/Components/Label/Labels";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import ResetObjectID from "Common/UI/Components/ResetObjectID/ResetObjectID";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue, {
  UseTranslateValueResult,
} from "Common/UI/Utils/Translation";
import Label from "Common/Models/DatabaseModels/Label";
import Runner from "Common/Models/DatabaseModels/Runner";
import RunnerOwnerTeam from "Common/Models/DatabaseModels/RunnerOwnerTeam";
import RunnerOwnerUser from "Common/Models/DatabaseModels/RunnerOwnerUser";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

const RunnerView: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const [modelId] = useState<ObjectID>(Navigation.getLastParamAsObjectID());
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [isRunnerLoaded, setIsRunnerLoaded] = useState<boolean>(false);

  const { translateString }: UseTranslateValueResult = useTranslateValue();

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
        {translateString("Not reported yet") || "Not reported yet"}
      </span>
    );
  };

  return (
    <Fragment>
      <CardModelDetail<Runner>
        name="Runner Details"
        cardProps={{
          title: "Runner Details",
          description: "Here are more details for this Runner.",
        }}
        isEditable={true}
        formFields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "prod-eu-runner",
            validation: { minLength: 2 },
          },
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder:
              "Runs inside the production EU cluster. Can reach internal services.",
          },
          {
            field: { canRunRunbooks: true },
            title: "Runs Runbooks",
            description:
              "Let this Runner execute runbook Bash and JavaScript steps on the host it runs on. On by default — this is why most Runners are installed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: true,
          },
          {
            field: { canRunCodeFixTasks: true },
            title: "Runs AI Code Fixes",
            description:
              "Let this Runner work in the code repositories connected to this project and open pull requests for review. Off by default; it needs a connected repository. The Runner picks this up on its next heartbeat — no restart needed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
          },
          {
            field: { canRunAiCommands: true },
            title: "Runs AI Remediation Commands",
            description:
              "Let AI auto-remediation execute policy-checked commands on this Runner. Off by default — commands either match the rule's allowlist or wait for one-click human approval, and destructive commands are always refused. Takes effect on the Runner's next heartbeat, no restart needed.",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            defaultValue: false,
          },
          {
            field: { labels: true },
            title: "Labels",
            description:
              "Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.",
            fieldType: FormFieldSchemaType.MultiSelectDropdown,
            dropdownModal: {
              type: Label,
              labelField: "name",
              valueField: "_id",
            },
            required: false,
            placeholder: "Labels",
          },
        ]}
        modelDetailProps={{
          onItemLoaded: (item: Runner) => {
            if (item.key) {
              setAgentKey(item.key as string);
            }
            setIsRunnerLoaded(true);
          },
          modelType: Runner,
          id: "model-detail-runbook-agent",
          fields: [
            {
              field: { _id: true },
              title: "Runner ID",
              fieldType: FieldType.ObjectID,
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
          description:
            "Here is more details on the connection status for this Runner.",
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

      <ModelTable<RunnerOwnerTeam>
        modelType={RunnerOwnerTeam}
        id="table-runbook-agent-owner-team"
        userPreferencesKey="runbook-agent-owner-team-table"
        name="Runner > Owner Team"
        saveFilterProps={{
          tableId: "runbook-agent-owner-team-table",
        }}
        singularName="Team"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          runnerId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: RunnerOwnerTeam): Promise<RunnerOwnerTeam> => {
          item.runnerId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Teams)",
          description:
            "Here is the list of teams that own this Runner. They will be alerted when this Runner's status changes.",
        }}
        noItemsMessage={"No teams associated with this Runner so far."}
        formFields={[
          {
            field: { team: true },
            title: "Team",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select Team",
            dropdownModal: {
              type: Team,
              labelField: "name",
              valueField: "_id",
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: { team: true },
            type: FieldType.Entity,
            title: "Team",
            filterEntityType: Team,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              team: {
                name: true,
              },
            },
            title: "Team",
            type: FieldType.Entity,
            getElement: (item: RunnerOwnerTeam): ReactElement => {
              if (!item["team"]) {
                throw new BadDataException("Team not found");
              }
              return <TeamElement team={item["team"] as Team} />;
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
      />

      <ModelTable<RunnerOwnerUser>
        modelType={RunnerOwnerUser}
        id="table-runbook-agent-owner-user"
        userPreferencesKey="runbook-agent-owner-user-table"
        name="Runner > Owner User"
        saveFilterProps={{
          tableId: "runbook-agent-owner-user-table",
        }}
        singularName="User"
        isDeleteable={true}
        createVerb={"Add"}
        isCreateable={true}
        isViewable={false}
        showViewIdButton={true}
        query={{
          runnerId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(item: RunnerOwnerUser): Promise<RunnerOwnerUser> => {
          item.runnerId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: "Owners (Users)",
          description:
            "Here is the list of users that own this Runner. They will be alerted when this Runner's status changes.",
        }}
        noItemsMessage={"No users associated with this Runner so far."}
        formFields={[
          {
            field: { user: true },
            title: "User",
            fieldType: FormFieldSchemaType.Dropdown,
            required: true,
            placeholder: "Select User",
            fetchDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
          },
        ]}
        showRefreshButton={true}
        viewPageRoute={Navigation.getCurrentRoute()}
        filters={[
          {
            field: { user: true },
            title: "User",
            type: FieldType.Entity,
            filterEntityType: User,
            fetchFilterDropdownOptions: async () => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              user: {
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            title: "User",
            type: FieldType.Entity,
            getElement: (item: RunnerOwnerUser): ReactElement => {
              if (!item["user"]) {
                throw new BadDataException("User not found");
              }
              return <UserElement user={item["user"] as User} />;
            },
          },
          {
            field: { createdAt: true },
            title: "Owner since",
            type: FieldType.DateTime,
          },
        ]}
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
            Resetting the secret key will generate a new key. The secret is used
            to authenticate this Runner&apos;s requests. This Runner will stop
            connecting until the new key is configured on it, so re-run the
            setup command on its host afterwards.
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
              RouteMap[PageMap.SETTINGS_RUNNERS] as Route,
            ),
          );
        }}
      />
    </Fragment>
  );
};

export default RunnerView;
