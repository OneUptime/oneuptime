import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import Card from "Common/UI/Components/Card/Card";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Email from "Common/Types/Email";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { STATUS_PAGE_API_URL } from "Common/UI/Config";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import StatusPageReportsCard from "../../../Components/StatusPage/StatusPageReportsCard";

export interface TestEmailObject {
  email: Email;
}

/*
 * Status Page -> Advanced -> Reports: the Email Reports card - a switch
 * that saves when flipped, with the schedule in plain words while reports
 * are on and Edit Schedule to change it (StatusPageReportsCard) - and Send
 * Test Report, which emails a report to one address whether reports are on
 * or not.
 */
const StatusPageReports: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [showModal, setShowModal] = useState<boolean>(false);
  /*
   * Read on every render: the router keeps this page mounted when only the
   * status page in the URL changes (Back and Forward between two pages'
   * Reports), and the card and the test report must follow it.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
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
        await API.post<JSONObject>({
          url: URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
            `/test-email-report`,
          ),
          data: {
            statusPageId: modelId.toString(),
            email: testEmail.email.toString(),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

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
      <StatusPageReportsCard statusPageId={modelId} />

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

export default StatusPageReports;
