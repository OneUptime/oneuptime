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
import Card from "CommonUI/src/Components/Card/Card";
import { ButtonStyleType } from "CommonUI/src/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import BasicFormModal from "CommonUI/src/Components/FormModal/BasicFormModal";
import Email from "Common/Types/Email";
import ConfirmModal from "CommonUI/src/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "CommonUI/src/Utils/API/API";
import { STATUS_PAGE_API_URL } from "CommonUI/src/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";

export interface TestEmailObject {
  email: Email;
}

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  type SendTestEmailReportFunction = (
    testEmail: TestEmailObject,
  ) => Promise<void>;

  const setTestEmailReport: SendTestEmailReportFunction = async (
    testEmail: TestEmailObject,
  ): Promise<void> => {
    try {
      setIsLoading(true);

      // get status page id by hostname.
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>(
          URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/test-email-report`,
          ),
          {
            statusPageId: modelId.toString(),
            email: testEmail.email.toString(),
          },
          {},
        );

      if (response instanceof HTTPErrorResponse) {
        setError(API.getFriendlyMessage(response));
        setShowErrorModal(true);
        return;
      }

      setError("Test email report sent successfully.");
      setShowErrorModal(true);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      setShowErrorModal(true);
    }

    setShowModal(false);
    setIsLoading(false);
  };

  return (
    <Fragment>
      {statusPage?.sendNextReportBy && statusPage.isReportEnabled && (
        <Alert
          type={AlertType.INFO}
          strongTitle="Next report will be sent on"
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
        onSaveSuccess={(statusPage: StatusPage) => {
          setStatusPage(statusPage);
        }}
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
          {
            field: {
              reportDataInDays: true,
            },
            title:
              "How many days of data would you like to include in the report?",
            fieldType: FormFieldSchemaType.Number,
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
            {
              field: {
                reportDataInDays: true,
              },
              title:
                "How many days of data would you like to include in the report?",
              fieldType: FieldType.Number,
              placeholder: "-",
            },
          ],
          modelId: modelId,
        }}
      />

      <Card
        title={`Send Test Report`}
        description={`Send a test report to your email address to see how it looks.`}
        buttons={[
          {
            title: `Send Test Report`,
            buttonStyle: ButtonStyleType.NORMAL,
            onClick: () => {
              setShowModal(true);
            },
            icon: IconProp.Email,
          },
        ]}
      />

      {showModal ? (
        <BasicFormModal<TestEmailObject>
          description={`Which email address would you like to send the test report to?`}
          title={`Send Test Report`}
          onSubmit={async (testEmail: TestEmailObject) => {
            await setTestEmailReport(testEmail);
          }}
          isLoading={isLoading}
          onClose={() => {
            setShowModal(false);
          }}
          formProps={{
            fields: [
              {
                field: {
                  email: true,
                },
                title: "Email Address",
                fieldType: FormFieldSchemaType.Email,
                required: true,
                placeholder: "Email Address",
              },
            ],
          }}
          submitButtonText={`Send Test Report`}
        />
      ) : (
        <></>
      )}

      {showErrorModal ? (
        <ConfirmModal
          description={error}
          title={`Send Test Email Status`}
          onSubmit={() => {
            setShowErrorModal(false);
            setError("");
          }}
          submitButtonText={`Close`}
          submitButtonType={ButtonStyleType.NORMAL}
        />
      ) : (
        <></>
      )}
    </Fragment>
  );
};

export default StatusPageDelete;
