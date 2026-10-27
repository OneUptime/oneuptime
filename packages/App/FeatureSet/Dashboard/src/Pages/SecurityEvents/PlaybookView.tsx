import PageComponentProps from "../PageComponentProps";
import AppLink from "../../Components/AppLink/AppLink";
import { PlaybookConnectionOption } from "../../Components/SecurityPlaybook/SecurityPlaybookStepDialog";
import SecurityPlaybookRunCard from "../../Components/SecurityPlaybook/SecurityPlaybookRunCard";
import SecurityPlaybookStepsEditor from "../../Components/SecurityPlaybook/SecurityPlaybookStepsEditor";
import {
  StepNameLookup,
  emptyStepNameLookup,
} from "../../Components/SecurityPlaybook/SecurityPlaybookStepSummary";
import useSecurityPlaybookRuns, {
  UseSecurityPlaybookRunsResult,
} from "../../Components/SecurityPlaybook/useSecurityPlaybookRuns";
import { SecurityCaseValueLists } from "../../Components/SecurityCase/SecurityCaseValues";
import { getSecurityCasePriorityOptions } from "../../Components/SecurityCase/SecurityCaseValueOptions";
import useSecurityCaseValues from "../../Components/SecurityCase/useSecurityCaseValues";
import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "Common/Models/DatabaseModels/SecurityPlaybookRun";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import Route from "Common/Types/API/Route";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityPlaybookStep,
  parseSecurityPlaybookSteps,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
  getSecurityPlaybookTriggerOptions,
} from "../../Components/SecurityPlaybook/SecurityPlaybookTriggerOptions";
import { Green, Gray500 } from "Common/Types/BrandColors";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { DetailStyle } from "Common/UI/Components/Detail/Detail";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Page from "Common/UI/Components/Page/Page";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Link from "Common/Types/Link";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { readFormIdList } from "../../Components/SecurityPlaybook/SecurityPlaybookStepForm";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

async function readNames<TModel extends BaseModel>(modelType: {
  new (): TModel;
}): Promise<Map<string, string>> {
  const names: Map<string, string> = new Map();

  try {
    const result: ListResult<TModel> = await ModelAPI.getList<TModel>({
      modelType,
      query: {},
      select: { _id: true, name: true } as never,
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    for (const item of result.data) {
      const record: JSONObject = item as unknown as JSONObject;
      names.set(
        String(record["_id"] || item.id?.toString() || ""),
        String(record["name"] || ""),
      );
    }
  } catch {
    // A list the reader may not see leaves its names out: the step says "a removed ...".
  }

  return names;
}

/*
 * One playbook: when it runs (its settings), what it does (its steps, edited
 * in place) and what it did (its latest runs, with their cases).
 */
const SecurityPlaybookViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const playbookId: ObjectID = Navigation.getLastParamAsObjectID();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [playbook, setPlaybook] = useState<SecurityPlaybook | null>(null);
  const [error, setError] = useState<string>("");
  const [lookup, setLookup] = useState<StepNameLookup>(emptyStepNameLookup());
  const [connections, setConnections] = useState<
    Array<PlaybookConnectionOption>
  >([]);
  const [rules, setRules] = useState<Map<string, string>>(new Map());
  const [showRules, setShowRules] = useState<boolean>(false);
  // Why the rules the playbook is held to could not be saved, in their card.
  const [rulesError, setRulesError] = useState<string>("");

  const updateGate: PermissionGateResult = PermissionGate.check(
    new SecurityPlaybook(),
    ModelAction.Update,
  );

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const item: SecurityPlaybook | null =
        await ModelAPI.getItem<SecurityPlaybook>({
          modelType: SecurityPlaybook,
          id: playbookId,
          select: {
            _id: true,
            name: true,
            description: true,
            isEnabled: true,
            trigger: true,
            minimumSecurityCasePriorityId: true,
            detectionSource: true,
            detectionRuleIds: true,
            steps: true,
            runCount: true,
            lastRunAt: true,
          },
        });

      if (!item) {
        setError(
          translator.translateText("This playbook does not exist.") || "",
        );
        return;
      }

      setPlaybook(item);
      setError("");
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  }, [playbookId.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // The names a step's ids stand for, and the connections the contain steps may use.
  useEffect(() => {
    const loadLookups: () => Promise<void> = async (): Promise<void> => {
      const [
        onCallPolicies,
        incidentSeverities,
        labels,
        workflows,
        ruleNames,
        runbooks,
        statusPages,
      ]: Array<Map<string, string>> = await Promise.all([
        readNames(OnCallDutyPolicy),
        readNames(IncidentSeverity),
        readNames(Label),
        readNames(Workflow),
        readNames(DetectionRule),
        readNames(Runbook),
        readNames(StatusPage),
      ]);

      let connectionList: Array<PlaybookConnectionOption> = [];

      try {
        const result: ListResult<SecurityEventConnection> =
          await ModelAPI.getList<SecurityEventConnection>({
            modelType: SecurityEventConnection,
            query: {},
            select: { _id: true, name: true, provider: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        connectionList = result.data.map(
          (connection: SecurityEventConnection): PlaybookConnectionOption => {
            return {
              id: connection._id!.toString(),
              name: connection.name || "",
              provider: connection.provider as SecurityEventConnectorProvider,
            };
          },
        );
      } catch {
        // Without connections, the contain steps offer nothing to pick.
      }

      setConnections(connectionList);
      setRules(ruleNames || new Map());
      setLookup({
        ...emptyStepNameLookup(),
        onCallPolicies: onCallPolicies || new Map(),
        incidentSeverities: incidentSeverities || new Map(),
        labels: labels || new Map(),
        workflows: workflows || new Map(),
        runbooks: runbooks || new Map(),
        statusPages: statusPages || new Map(),
        connections: new Map(
          connectionList.map(
            (connection: PlaybookConnectionOption): [string, string] => {
              return [connection.id, connection.name];
            },
          ),
        ),
      });
    };

    void loadLookups();
  }, []);

  /*
   * The project's case priorities and statuses: what the minimum and the
   * case steps pick from, and the names their ids stand for.
   */
  const { values: caseValues } = useSecurityCaseValues();
  const caseLists: SecurityCaseValueLists = caseValues || {
    priorities: [],
    statuses: [],
  };
  const lookupWithCaseValues: StepNameLookup = {
    ...lookup,
    casePriorities: new Map(
      caseLists.priorities.map(
        (priority: SecurityCasePriority): [string, string] => {
          return [priority.id?.toString() || "", priority.name || ""];
        },
      ),
    ),
    caseStatuses: new Map(
      caseLists.statuses.map((status: SecurityCaseStatus): [string, string] => {
        return [status.id?.toString() || "", status.name || ""];
      }),
    ),
  };

  const runs: UseSecurityPlaybookRunsResult = useSecurityPlaybookRuns({
    query: { securityPlaybookId: playbookId },
    queryKey: playbookId.toString(),
    limit: 10,
  });

  /*
   * "Security Events > Playbooks > Contain Compromised Okta Users", not
   * "View Playbook": the trail and the browser tab name the playbook once
   * it is read, as a monitor's or an incident's page names its record.
   */
  const breadcrumbs: Array<Link> | undefined = nameRecordInTrail({
    links: getSecurityEventsBreadcrumbs(path),
    recordId: playbookId.toString(),
    recordName: playbook?.name,
  });

  if (error) {
    return (
      <Page title="Playbook" breadcrumbLinks={breadcrumbs}>
        <ErrorMessage message={error} />
      </Page>
    );
  }

  if (!playbook) {
    return (
      <Page title="Playbook" breadcrumbLinks={breadcrumbs} isLoading={true}>
        <></>
      </Page>
    );
  }

  let steps: Array<SecurityPlaybookStep> = [];
  let stepsError: string = "";

  try {
    steps = parseSecurityPlaybookSteps(playbook.steps || []);
  } catch (err) {
    stepsError = err instanceof Error ? err.message : String(err);
  }

  const ruleIds: Array<string> = playbook.detectionRuleIds || [];

  return (
    <Page title={playbook.name || "Playbook"} breadcrumbLinks={breadcrumbs}>
      <div className="space-y-6">
        <CardModelDetail<SecurityPlaybook>
          name="Playbook Settings"
          cardProps={{
            title: "When It Runs",
            description:
              "A playbook runs by itself on the cases its trigger and conditions match, and anyone who works cases can run it by hand from a case.",
          }}
          isEditable={true}
          editButtonText="Edit"
          onSaveSuccess={() => {
            void load();
          }}
          formSteps={[
            { title: "Playbook", id: "playbook" },
            { title: "When It Runs", id: "when" },
          ]}
          formFields={[
            {
              field: { name: true },
              stepId: "playbook",
              title: "Name",
              fieldType: FormFieldSchemaType.Text,
              required: true,
            },
            {
              field: { description: true },
              stepId: "playbook",
              title: "Description",
              fieldType: FormFieldSchemaType.LongText,
              required: false,
            },
            {
              field: { isEnabled: true },
              stepId: "playbook",
              title: "Enabled",
              description:
                "A disabled playbook runs neither by itself nor by hand.",
              fieldType: FormFieldSchemaType.Toggle,
              required: false,
            },
            {
              field: { trigger: true },
              stepId: "when",
              title: "Trigger",
              description: SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION,
              fieldType: FormFieldSchemaType.Dropdown,
              // Every trigger, so the playbook's own stays shown.
              dropdownOptions: getSecurityPlaybookTriggerOptions({
                isAiOffered: true,
                isEditing: true,
              }),
              required: true,
            },
            {
              field: { minimumSecurityCasePriorityId: true },
              stepId: "when",
              title: "For Cases At Least",
              description: "Only cases of this priority or higher.",
              fieldType: FormFieldSchemaType.Dropdown,
              // Its own minimum stays offered, even if archived since.
              dropdownOptions: getSecurityCasePriorityOptions(
                caseLists.priorities,
                { keepId: playbook.minimumSecurityCasePriorityId },
              ),
              required: false,
            },
            {
              field: { detectionSource: true },
              stepId: "when",
              title: "Only For Detections From",
              description:
                "Only when the detection behind the case came from this source.",
              fieldType: FormFieldSchemaType.Dropdown,
              dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
                SecurityDetectionSource,
              ),
              required: false,
            },
          ]}
          modelDetailProps={{
            modelType: SecurityPlaybook,
            id: "security-playbook-detail",
            modelId: playbookId,
            showDetailsInNumberOfColumns: 3,
            // The grid sizes each field (the default style also narrows it).
            style: DetailStyle.Compact,
            fields: [
              {
                field: { isEnabled: true },
                title: "Status",
                fieldType: FieldType.Element,
                getElement: (item: SecurityPlaybook): ReactElement => {
                  return item.isEnabled ? (
                    <Pill color={Green} text="Enabled" />
                  ) : (
                    <Pill color={Gray500} text="Disabled" />
                  );
                },
              },
              {
                field: { trigger: true },
                title: "Trigger",
                fieldType: FieldType.Element,
                getElement: (item: SecurityPlaybook): ReactElement => {
                  const trigger: string = item.trigger || "";

                  return (
                    <span>{translator.translateText(trigger) || trigger}</span>
                  );
                },
              },
              {
                field: { minimumSecurityCasePriority: { name: true } },
                title: "For Cases At Least",
                fieldType: FieldType.Element,
                getElement: (item: SecurityPlaybook): ReactElement => {
                  const name: string =
                    item.minimumSecurityCasePriority?.name || "";

                  return name ? (
                    <span>{translator.translateText(name) || name}</span>
                  ) : (
                    <span className="text-gray-400">
                      {translator.translateText("Any priority")}
                    </span>
                  );
                },
              },
              {
                field: { detectionSource: true },
                title: "Only For Detections From",
                fieldType: FieldType.Element,
                getElement: (item: SecurityPlaybook): ReactElement => {
                  const source: string = item.detectionSource || "";

                  return source ? (
                    <span>{translator.translateText(source) || source}</span>
                  ) : (
                    <span className="text-gray-400">
                      {translator.translateText("Any source")}
                    </span>
                  );
                },
              },
              {
                field: { runCount: true },
                title: "Runs So Far",
                fieldType: FieldType.Number,
              },
              {
                field: { lastRunAt: true },
                title: "Last Run",
                fieldType: FieldType.Element,
                getElement: (item: SecurityPlaybook): ReactElement => {
                  return item.lastRunAt ? (
                    <span
                      title={OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        item.lastRunAt,
                      )}
                    >
                      {OneUptimeDate.fromNow(item.lastRunAt)}
                    </span>
                  ) : (
                    <span className="text-gray-400">
                      {translator.translateText("Never")}
                    </span>
                  );
                },
              },
              {
                field: { description: true },
                title: "Description",
                fieldType: FieldType.LongText,
                placeholder: "No description.",
                colSpan: 3,
              },
            ],
          }}
        />

        <Card
          title="Only For These Detection Rules"
          description="When set, the playbook runs only on cases whose detection came from one of these rules."
          buttons={[
            {
              title: "Edit",
              icon: IconProp.Edit,
              buttonStyle: ButtonStyleType.NORMAL,
              disabled: !updateGate.isAllowed,
              tooltip: updateGate.isAllowed
                ? undefined
                : updateGate.disabledReason,
              onClick: () => {
                setShowRules(true);
              },
            },
          ]}
        >
          {rulesError ? (
            <div className="mb-3">
              <ErrorMessage message={rulesError} />
            </div>
          ) : (
            <></>
          )}
          {ruleIds.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translator.translateText("Any detection rule.")}
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ruleIds.map((id: string): ReactElement => {
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-700"
                  >
                    {rules.get(id) ||
                      translator.translateText("a removed detection rule")}
                  </span>
                );
              })}
            </div>
          )}
        </Card>

        {stepsError ? <ErrorMessage message={stepsError} /> : <></>}

        <SecurityPlaybookStepsEditor
          steps={steps}
          lookup={lookupWithCaseValues}
          connections={connections}
          caseValues={caseLists}
          canEdit={updateGate.isAllowed}
          disabledReason={updateGate.disabledReason}
          onSave={async (newSteps: Array<SecurityPlaybookStep>) => {
            try {
              await ModelAPI.updateById<SecurityPlaybook>({
                modelType: SecurityPlaybook,
                id: playbookId,
                data: { steps: newSteps as unknown as JSONArray },
              });
            } catch (err) {
              throw new Error(API.getFriendlyMessage(err));
            }

            await load();
          }}
        />

        <Card
          title="Latest Runs"
          description="The last runs of this playbook, with the case each ran on."
        >
          {runs.runs.length === 0 ? (
            <p className="text-sm text-gray-500">
              {translator.translateText("This playbook has not run yet.")}
            </p>
          ) : (
            <div className="space-y-3">
              {runs.runs.map((run: SecurityPlaybookRun): ReactElement => {
                return (
                  <SecurityPlaybookRunCard
                    key={run._id!.toString()}
                    run={run}
                    onChanged={runs.refresh}
                    isCollapsible={true}
                    /*
                     * Each run is named by its case, number and title: the
                     * playbook's own name, on every run of its own page,
                     * told them apart by nothing.
                     */
                    heading={
                      run.securityCaseId ? (
                        <AppLink
                          to={RouteUtil.populateRouteParams(
                            RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
                            {
                              modelId: new ObjectID(
                                run.securityCaseId.toString(),
                              ),
                            },
                          )}
                          className="min-w-0 truncate text-sm font-semibold text-gray-900 hover:text-indigo-600 hover:underline"
                        >
                          {`${run.securityCase?.caseNumberWithPrefix || ""} ${
                            run.securityCase?.title || ""
                          }`.trim() ||
                            translator.translateText("Open case") ||
                            ""}
                        </AppLink>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {showRules ? (
        <BasicFormModal<JSONObject>
          title="Only For These Detection Rules"
          description="Leave empty to run for any detection rule."
          submitButtonText="Save"
          onClose={() => {
            setShowRules(false);
          }}
          formProps={{
            name: "security-playbook-rules",
            initialValues: { detectionRuleIds: ruleIds },
            fields: [
              {
                field: { detectionRuleIds: true },
                title: "Detection Rules",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                required: false,
                dropdownOptions: Array.from(rules.entries()).map(
                  ([value, label]: [string, string]) => {
                    return { value, label };
                  },
                ),
              },
            ],
          }}
          onSubmit={async (values: FormValues<JSONObject>) => {
            setShowRules(false);
            setRulesError("");

            try {
              await ModelAPI.updateById<SecurityPlaybook>({
                modelType: SecurityPlaybook,
                id: playbookId,
                data: {
                  detectionRuleIds: readFormIdList(values["detectionRuleIds"]),
                },
              });
              await load();
            } catch (err) {
              /*
               * Said in the card, as a step that cannot be saved says it in
               * the steps: the page and its runs stay where they are.
               */
              setRulesError(API.getFriendlyMessage(err));
            }
          }}
        />
      ) : (
        <></>
      )}
    </Page>
  );
};

export default SecurityPlaybookViewPage;
