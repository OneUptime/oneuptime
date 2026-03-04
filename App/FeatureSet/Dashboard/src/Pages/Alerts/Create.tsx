import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Alert from "Common/Models/DatabaseModels/Alert";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ProjectUtil from "Common/UI/Utils/Project";
import Label from "Common/Models/DatabaseModels/Label";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchLabels from "../../Components/Label/FetchLabels";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";

const AlertCreate: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const [initialValuesForAlert, setInitialValuesForAlert] =
    useState<JSONObject>({});

  useEffect(() => {
    fetchFirstAlertState();
  }, []);

  const fetchFirstAlertState: () => Promise<void> = async (): Promise<void> => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return;
    }

    try {
      const alertStates: ListResult<AlertState> =
        await ModelAPI.getList<AlertState>({
          modelType: AlertState,
          query: {
            projectId: projectId,
          },
          limit: 1,
          skip: 0,
          select: {
            _id: true,
          },
          sort: {
            order: SortOrder.Ascending,
          },
        });

      if (alertStates.data.length > 0) {
        const firstStateId: string | undefined =
          alertStates.data[0]!._id?.toString();
        if (firstStateId) {
          setInitialValuesForAlert((prev: JSONObject) => {
            return {
              ...prev,
              currentAlertState: firstStateId,
            };
          });
        }
      }
    } catch {
      // Silently fail to avoid breaking the form
    }
  };

  return (
    <Fragment>
      <Card
        title="Create New Alert"
        description={
          "Create a new alert to notify your team about an issue that needs attention."
        }
        className="mb-10"
      >
        <div>
          <ModelForm<Alert>
            modelType={Alert}
            initialValues={initialValuesForAlert}
            name="Create New Alert"
            id="create-alert-form"
            fields={[
              {
                field: {
                  title: true,
                },
                title: "Title",
                fieldType: FormFieldSchemaType.Text,
                stepId: "alert-details",
                required: true,
                placeholder: "Alert Title",
                validation: {
                  minLength: 2,
                },
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                stepId: "alert-details",
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                description: MarkdownUtil.getMarkdownCheatsheet(
                  "Describe the alert details here",
                ),
              },
              {
                field: {
                  alertSeverity: true,
                },
                title: "Alert Severity",
                stepId: "alert-details",
                description: "What is the severity of this alert?",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                },
                required: true,
                placeholder: "Alert Severity",
              },
              {
                field: {
                  currentAlertState: true,
                },
                title: "Alert State",
                stepId: "alert-details",
                description:
                  "Select the initial state for this alert to be in.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: AlertState,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select Initial State",
                fetchDropdownOptions: async () => {
                  const projectId: ObjectID | null =
                    ProjectUtil.getCurrentProjectId();
                  if (!projectId) {
                    return [];
                  }

                  try {
                    const alertStates: ListResult<AlertState> =
                      await ModelAPI.getList<AlertState>({
                        modelType: AlertState,
                        query: {
                          projectId: projectId,
                        },
                        limit: LIMIT_PER_PROJECT,
                        skip: 0,
                        select: {
                          _id: true,
                          name: true,
                          color: true,
                        },
                        sort: {
                          order: SortOrder.Ascending,
                        },
                      });

                    return alertStates.data.map(
                      (state: AlertState): DropdownOption => {
                        const option: DropdownOption = {
                          label: state.name || "",
                          value: state._id?.toString() || "",
                          color: state.color as Color,
                        };

                        return option;
                      },
                    );
                  } catch {
                    return [];
                  }
                },
                getSummaryElement: (item: FormValues<Alert>) => {
                  if (!item.currentAlertState) {
                    return <p>Will use first available state by priority</p>;
                  }

                  return <p>Initial state will be set to selected state</p>;
                },
              },
              {
                field: {
                  monitor: true,
                },
                title: "Monitor",
                stepId: "on-call",
                description: "Select the monitor affected by this alert.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: Monitor,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select Monitor",
                getSummaryElement: (item: FormValues<Alert>) => {
                  if (!item.monitor) {
                    return <p>No monitor selected.</p>;
                  }

                  return (
                    <div>
                      <FetchMonitors
                        monitorIds={[new ObjectID(item.monitor.toString())]}
                      />
                    </div>
                  );
                },
              },
              {
                field: {
                  onCallDutyPolicies: true,
                },
                title: "On-Call Policy",
                stepId: "on-call",
                description:
                  "Select on-call duty policy to execute when this alert is created.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: OnCallDutyPolicy,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select on-call policies",
                getSummaryElement: (item: FormValues<Alert>) => {
                  if (
                    !item.onCallDutyPolicies ||
                    !Array.isArray(item.onCallDutyPolicies)
                  ) {
                    return (
                      <p>
                        No on-call policies will be executed when this alert is
                        created.
                      </p>
                    );
                  }

                  const onCallDutyPolicyIds: Array<ObjectID> = [];

                  for (const onCallDutyPolicy of item.onCallDutyPolicies) {
                    if (typeof onCallDutyPolicy === "string") {
                      onCallDutyPolicyIds.push(new ObjectID(onCallDutyPolicy));
                      continue;
                    }

                    if (onCallDutyPolicy instanceof ObjectID) {
                      onCallDutyPolicyIds.push(onCallDutyPolicy);
                      continue;
                    }

                    if (onCallDutyPolicy instanceof OnCallDutyPolicy) {
                      onCallDutyPolicyIds.push(
                        new ObjectID(onCallDutyPolicy._id?.toString() || ""),
                      );
                      continue;
                    }
                  }

                  return (
                    <div>
                      <FetchOnCallDutyPolicies
                        onCallDutyPolicyIds={onCallDutyPolicyIds}
                      />
                    </div>
                  );
                },
              },
              {
                field: {
                  labels: true,
                },
                title: "Labels",
                stepId: "more",
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
                getSummaryElement: (item: FormValues<Alert>) => {
                  if (!item.labels || !Array.isArray(item.labels)) {
                    return <p>No labels assigned.</p>;
                  }

                  const labelIds: Array<ObjectID> = [];

                  for (const label of item.labels) {
                    if (typeof label === "string") {
                      labelIds.push(new ObjectID(label));
                      continue;
                    }

                    if (label instanceof ObjectID) {
                      labelIds.push(label);
                      continue;
                    }

                    if (label instanceof Label) {
                      labelIds.push(new ObjectID(label._id?.toString() || ""));
                      continue;
                    }
                  }

                  return (
                    <div>
                      <FetchLabels labelIds={labelIds} />
                    </div>
                  );
                },
              },
              {
                field: {
                  rootCause: true,
                },
                title: "Root Cause",
                stepId: "more",
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                description: MarkdownUtil.getMarkdownCheatsheet(
                  "Describe the root cause here",
                ),
              },
              {
                field: {
                  remediationNotes: true,
                },
                title: "Remediation Notes",
                stepId: "more",
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                description: MarkdownUtil.getMarkdownCheatsheet(
                  "Describe the remediation steps here",
                ),
              },
            ]}
            steps={[
              {
                title: "Alert Details",
                id: "alert-details",
              },
              {
                title: "On-Call",
                id: "on-call",
              },
              {
                title: "More",
                id: "more",
              },
            ]}
            onSuccess={async (createdItem: Alert) => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ALERT_VIEW] as Route,
                    {
                      modelId: createdItem._id,
                    },
                  ),
                ),
              );
            }}
            submitButtonText={"Create Alert"}
            formType={FormType.Create}
            summary={{
              enabled: true,
            }}
          />
        </div>
      </Card>
    </Fragment>
  );
};

export default AlertCreate;
