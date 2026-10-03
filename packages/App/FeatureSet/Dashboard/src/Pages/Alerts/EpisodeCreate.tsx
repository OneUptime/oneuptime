import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import MarkdownUtil from "Common/UI/Utils/Markdown";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Card from "Common/UI/Components/Card/Card";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Label from "Common/Models/DatabaseModels/Label";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import ObjectID from "Common/Types/ObjectID";
import FetchLabels from "../../Components/Label/FetchLabels";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import FetchOnCallDutyPolicies from "../../Components/OnCallPolicy/FetchOnCallPolicies";
import FetchAlertState from "../../Components/AlertState/FetchAlertState";
import FetchAlertSeverity from "../../Components/AlertSeverity/FetchAlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import getOwnersFormField from "Common/UI/Components/PeoplePicker/OwnersFormField";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * Creating an episode asks for its title, severity and description. The
 * state it starts in and its labels are folded under one "Advanced" header
 * at the end of Episode Details: it says "Configured" when one of them holds
 * something, and opens by itself when one fails validation.
 */
const advancedSection: FormFieldCollapsibleSection<AlertEpisode> =
  getAdvancedFormSection<AlertEpisode>();

const EpisodeCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <Fragment>
      <Card
        title="Create New Alert Episode"
        description={
          "Create a new alert episode to group related alerts together and manage them as a single unit."
        }
        className="mb-10"
      >
        <div>
          <ModelForm<AlertEpisode>
            modelType={AlertEpisode}
            name="Create New Alert Episode"
            id="create-alert-episode-form"
            fields={[
              {
                field: {
                  title: true,
                },
                title: "Title",
                fieldType: FormFieldSchemaType.Text,
                stepId: "episode-details",
                required: true,
                placeholder: "Episode Title",
                validation: {
                  minLength: 2,
                },
              },
              {
                field: {
                  alertSeverity: true,
                },
                title: "Alert Severity",
                stepId: "episode-details",
                description: "What severity level is this episode?",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: AlertSeverity,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Alert Severity",
                getSummaryElement: (item: FormValues<AlertEpisode>) => {
                  if (!item.alertSeverity) {
                    return (
                      <p>
                        {translator.translateText(
                          "No alert severity selected.",
                        )}
                      </p>
                    );
                  }

                  return (
                    <FetchAlertSeverity
                      alertSeverityId={
                        new ObjectID(item.alertSeverity.toString())
                      }
                    />
                  );
                },
              },
              {
                field: {
                  description: true,
                },
                title: "Description",
                stepId: "episode-details",
                fieldType: FormFieldSchemaType.Markdown,
                required: false,
                description: MarkdownUtil.getMarkdownCheatsheet(
                  "Describe the episode details here",
                ),
              },
              /*
               * Left empty, the episode starts in the project's starting
               * state, which is what the server picks when it is not sent.
               */
              {
                field: {
                  currentAlertState: true,
                },
                title: "Initial State",
                stepId: "episode-details",
                description:
                  "Leave empty for the usual starting state. Pick a later state to record an episode that is already acknowledged or resolved.",
                fieldType: FormFieldSchemaType.Dropdown,
                dropdownModal: {
                  type: AlertState,
                  labelField: "name",
                  valueField: "_id",
                  sort: {
                    order: SortOrder.Ascending,
                  },
                },
                required: false,
                placeholder: "Select Initial State",
                collapsibleSection: advancedSection,
                getSummaryElement: (item: FormValues<AlertEpisode>) => {
                  if (!item.currentAlertState) {
                    return (
                      <p>
                        {translator.translateText("The usual starting state.")}
                      </p>
                    );
                  }

                  return (
                    <FetchAlertState
                      alertStateId={
                        new ObjectID(item.currentAlertState.toString())
                      }
                    />
                  );
                },
              },
              {
                field: {
                  labels: true,
                },

                title: "Labels ",
                stepId: "episode-details",
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
                collapsibleSection: advancedSection,
                getSummaryElement: (item: FormValues<AlertEpisode>) => {
                  if (!item.labels || !Array.isArray(item.labels)) {
                    return (
                      <p>{translator.translateText("No labels assigned.")}</p>
                    );
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
                  onCallDutyPolicies: true,
                },
                title: "On-Call Policy",
                stepId: "on-call",
                description:
                  "Select on-call duty policy to execute when this episode is created.",
                fieldType: FormFieldSchemaType.MultiSelectDropdown,
                dropdownModal: {
                  type: OnCallDutyPolicy,
                  labelField: "name",
                  valueField: "_id",
                },
                required: false,
                placeholder: "Select on-call policies",
                getSummaryElement: (item: FormValues<AlertEpisode>) => {
                  if (
                    !item.onCallDutyPolicies ||
                    !Array.isArray(item.onCallDutyPolicies)
                  ) {
                    return (
                      <p>
                        {translator.translateText(
                          "No on-call policies will be executed when this episode is created.",
                        )}
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
              /*
               * People and teams in one picker, kept in ownerUsers /
               * ownerTeams: AlertEpisodeService adds them as the episode's
               * owners. The summary step lists them by name.
               */
              getOwnersFormField({
                stepId: "on-call",
                description:
                  "Who owns this episode. They are notified when it is created or updated.",
              }),
            ]}
            steps={[
              {
                title: "Episode Details",
                id: "episode-details",
              },
              // Who is paged and who owns the episode, on one step.
              {
                title: "On-Call & Owners",
                id: "on-call",
              },
            ]}
            onSuccess={(createdItem: AlertEpisode) => {
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.ALERT_EPISODE_VIEW] as Route,
                    {
                      modelId: createdItem._id,
                    },
                  ),
                ),
              );
            }}
            submitButtonText={"Create Episode"}
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

export default EpisodeCreate;
