import LabelsElement from "Common/UI/Components/Label/Labels";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import Label from "Common/Models/DatabaseModels/Label";
import OnCallDutySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import FinalPreview from "../../../Components/OnCallPolicy/OnCallScheduleLayer/FinalPreview";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import AppLink from "../../../Components/AppLink/AppLink";
import DashboardUserUtil from "../../../Utils/User";
import ScheduleSubscribeCard from "../../../Components/OnCallPolicy/CalendarFeed/ScheduleSubscribeCard";

const OnCallDutyScheduleView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [onCallSchedule, setOnCallSchedule] =
    React.useState<OnCallDutySchedule | null>(null);

  let alertTitle: ReactElement | null = null;

  /*
   * Rendered as soon as the schedule has loaded, NOT only when somebody is on
   * the roster. The old condition required a current OR next user, which made
   * the "does not have any users on the roster" branch below unreachable in the
   * one state it was written for — a schedule with nobody on call now and
   * nobody scheduled next showed no banner at all.
   */
  if (onCallSchedule) {
    alertTitle = (
      <div className="space-y-2">
        {onCallSchedule.currentUserOnRoster && (
          <div>
            <strong>
              <AppLink
                className="underline"
                to={DashboardUserUtil.getUserLinkInDashboard(
                  onCallSchedule.currentUserOnRoster.id!,
                )}
              >
                {onCallSchedule.currentUserOnRoster.name?.toString() ||
                  onCallSchedule.currentUserOnRoster.email?.toString() ||
                  ""}
              </AppLink>
            </strong>{" "}
            is currently on the roster for this schedule. &nbsp;
            {onCallSchedule.rosterStartAt && onCallSchedule.rosterHandoffAt && (
              <span>
                This user has been on the roster since{" "}
                <strong>
                  {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    onCallSchedule.rosterStartAt,
                  )}
                </strong>{" "}
                and will remain on the roster until{" "}
                <strong>
                  {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                    onCallSchedule.rosterHandoffAt,
                  )}
                </strong>
                . &nbsp;
              </span>
            )}
          </div>
        )}
        {!onCallSchedule.currentUserOnRoster && (
          <div>
            <strong>No one is currently on call in this schedule.</strong>{" "}
            <span>
              {onCallSchedule.nextUserOnRoster
                ? "This is a coverage gap: any alert that escalates to this schedule right now will not page anyone. Coverage resumes at the hand-off below."
                : "Nobody is on call now and nobody is scheduled next, so every alert that escalates to this schedule will go unanswered. Check the layers below - a layer with no users assigned, or restricted active hours with no 24/7 fallback layer, will leave the schedule uncovered."}
              &nbsp;
            </span>
          </div>
        )}
        {onCallSchedule.nextUserOnRoster && (
          <div>
            <strong>
              <AppLink
                className="underline"
                to={DashboardUserUtil.getUserLinkInDashboard(
                  onCallSchedule.nextUserOnRoster.id!,
                )}
              >
                {onCallSchedule.nextUserOnRoster.name?.toString() ||
                  onCallSchedule.nextUserOnRoster.email?.toString() ||
                  ""}
              </AppLink>
            </strong>{" "}
            is the next user scheduled to be on the roster. &nbsp;
            {onCallSchedule.rosterNextHandoffAt &&
              onCallSchedule.rosterNextStartAt && (
                <span>
                  This user will be on the roster from{" "}
                  <strong>
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      onCallSchedule.rosterNextStartAt,
                    )}
                  </strong>{" "}
                  and remain on the roster until{" "}
                  <strong>
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      onCallSchedule.rosterNextHandoffAt,
                    )}
                  </strong>
                  . &nbsp;
                </span>
              )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Fragment>
      {/* OnCallDutySchedule View  */}
      <CardModelDetail<OnCallDutySchedule>
        name="On-Call Schedule > On-Call Schedule Details"
        cardProps={{
          title: "On-Call Schedule Details",
          description: "Here are more details for this on-call Schedule.",
        }}
        formSteps={[
          {
            title: "On-Call Schedule Info",
            id: "on-call-Schedule-info",
          },
          {
            title: "Labels",
            id: "labels",
          },
        ]}
        isEditable={true}
        formFields={[
          {
            field: {
              name: true,
            },
            title: "Name",
            stepId: "on-call-Schedule-info",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "On-Call Schedule Name",
            validation: {
              minLength: 2,
            },
          },
          {
            field: {
              description: true,
            },
            stepId: "on-call-Schedule-info",
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description",
          },
          {
            field: {
              labels: true,
            },
            title: "Labels ",
            stepId: "labels",
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
          showDetailsInNumberOfColumns: 2,
          modelType: OnCallDutySchedule,
          id: "model-detail-monitors",
          selectMoreFields: {
            currentUserOnRoster: {
              name: true,
              _id: true,
              email: true,
              profilePictureId: true,
            },
            nextUserOnRoster: {
              name: true,
              _id: true,
              email: true,
              profilePictureId: true,
            },
            rosterNextHandoffAt: true,
            rosterHandoffAt: true,
            rosterStartAt: true,
            rosterNextStartAt: true,
            timezone: true,
          },
          onItemLoaded: (item: OnCallDutySchedule): void => {
            if (!onCallSchedule) {
              setOnCallSchedule(item);
            }
          },
          fields: [
            {
              field: {
                _id: true,
              },
              title: "On-Call Schedule ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                name: true,
              },
              title: "Name",
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
              getElement: (item: OnCallDutySchedule): ReactElement => {
                return <LabelsElement labels={item["labels"] || []} />;
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
            },
          ],
          modelId: modelId,
        }}
      />

      {onCallSchedule && alertTitle && (
        <Alert
          type={
            onCallSchedule.currentUserOnRoster
              ? AlertType.INFO
              : AlertType.DANGER
          }
          title={alertTitle}
          icon={
            onCallSchedule.currentUserOnRoster ? IconProp.Calendar : undefined
          }
        />
      )}

      <ScheduleSubscribeCard
        scheduleId={modelId}
        scheduleTimezone={
          onCallSchedule
            ? onCallSchedule.timezone?.toString() || null
            : undefined
        }
      />

      <FinalPreview
        onCallDutyPolicyScheduleId={modelId}
        projectId={ProjectUtil.getCurrentProjectId() as ObjectID}
      />
    </Fragment>
  );
};

export default OnCallDutyScheduleView;
