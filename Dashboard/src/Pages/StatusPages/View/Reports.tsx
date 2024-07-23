import FormFieldSchemaType from "CommonUI/src/Components/Forms/Types/FormFieldSchemaType";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "CommonUI/src/Components/ModelDetail/CardModelDetail";
import Navigation from "CommonUI/src/Utils/Navigation";
import StatusPage from "Model/Models/StatusPage";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import FormValues from "CommonUI/src/Components/Forms/Types/FormValues";
import { CustomElementProps } from "CommonUI/src/Components/Forms/Types/Field";
import RecurringFieldElement from "CommonUI/src/Components/Events/RecurringFieldElement";
import Recurring from "Common/Types/Events/Recurring";
import FieldType from "CommonUI/src/Components/Types/FieldType";
import RecurringViewElement from "CommonUI/src/Components/Events/RecurringViewElement";
import Alert, { AlertType } from "CommonUI/src/Components/Alerts/Alert";
import OneUptimeDate from "Common/Types/Date";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);

  return (
    <Fragment>
      {statusPage?.sendNextReportBy && statusPage.isReportEnabled && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Next report will be sent by"
          title={`${OneUptimeDate.getDateAsLocalFormattedString(statusPage?.sendNextReportBy)}`}
        />
      )}

      <CardModelDetail<StatusPage>
        name="Status Page > Status Page Report"
        cardProps={{
          title: "Email Reports",
          description:
            "Reports enable you to send regular updates to your subscribers by email.",
        }}
        isEditable={true}
        editButtonText="Edit Report Settings"
        formFields={[
          {
            field: {
              isReportEnabled: true,
            },
            title: "Enable Reports",
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            placeholder: "Enable Status Page Reports",
          },
          {
            field: {
              reportStartDateTime: true,
            },
            title: "When would you like to send the first report?",
            fieldType: FormFieldSchemaType.DateTime,
            required: true,
            placeholder: "Send First Report On",
          },
          {
            field: {
              reportRecurringInterval: true,
            },
            title: "How often would you like to send reports?",
            description:
              "How often would you like to send reports? You can choose from daily, weekly, monthly, or yearly.",
            fieldType: FormFieldSchemaType.CustomComponent,
            getCustomElement: (
              value: FormValues<StatusPage>,
              props: CustomElementProps,
            ) => {
              return (
                <RecurringFieldElement
                  {...props}
                  initialValue={value.reportRecurringInterval as Recurring}
                />
              );
            },
          },
        ]}
        modelDetailProps={{
          selectMoreFields: {
            sendNextReportBy: true,
          },
          onItemLoaded: (item: StatusPage) => {
            if (!statusPage) {
              setStatusPage(item);
            }
          },
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPage,
          id: "model-detail-status-page",
          fields: [
            {
              field: {
                isReportEnabled: true,
              },
              title: "Reports Enabled",
              placeholder: "No",
              fieldType: FieldType.Boolean,
              description: "Enable email reports for this status page.",
            },
            {
              field: {
                reportStartDateTime: true,
              },
              title: "Send First Report On",
              description: "The date and time of the first report.",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                reportRecurringInterval: true,
              },
              title: "Report Recurring Interval",
              description: "How often the report will be sent.",
              fieldType: FieldType.Element,
              placeholder: "-",
              getElement: (item: StatusPage) => {
                return (
                  <RecurringViewElement value={item.reportRecurringInterval} />
                );
              },
            },
          ],
          modelId: modelId,
        }}
      />
    </Fragment>
  );
};

export default StatusPageDelete;
