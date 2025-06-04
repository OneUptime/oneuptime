import React, { useState, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import Button from "Common/UI/Components/Button/Button";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import TextInputField from "Common/UI/Components/Forms/Fields/TextInputField";
import API from "Common/UI/Utils/API/API";
import {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ObjectID from "Common/Types/ObjectID";

interface SlackWebhookTesterProps {
  statusPageId: ObjectID;
}

const SlackWebhookTester = (props: SlackWebhookTesterProps): ReactElement => {
  const [webhookUrl, setWebhookUrl] = useState<string>("");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);

  const handleTestWebhook = async () => {
    if (
      !webhookUrl ||
      !webhookUrl.startsWith("https://hooks.slack.com/services/")
    ) {
      setTestResult("Please enter a valid Slack incoming webhook URL");
      setTestSuccess(false);
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    setTestSuccess(null);

    try {
      await API.post(
        "/api/status-page-subscriber/test-slack-webhook",
        {
          webhookUrl: webhookUrl,
          statusPageId: props.statusPageId.toString(),
        },
        {},
      );
      setTestResult(
        "Test message sent successfully to Slack. Please check your Slack channel.",
      );
      setTestSuccess(true);
    } catch (error) {
      setTestResult(
        `Failed to send test message: ${API.getFriendlyMessage(error)}`,
      );
      setTestSuccess(false);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Card
      title="Test Slack Webhook"
      description="Test your Slack incoming webhook URL before creating a subscription."
    >
      <div className="flex flex-col space-y-4">
        <TextInputField
          fieldType={FormFieldSchemaType.URL}
          title="Slack Incoming Webhook URL"
          description="Enter the Slack webhook URL you want to test"
          placeholder="https://hooks.slack.com/services/..."
          value={webhookUrl}
          onChange={(value: string) => {
            setWebhookUrl(value);
          }}
          required={true}
          validation={{
            pattern: {
              value: /^https:\/\/hooks\.slack\.com\/services\/.+$/,
              message:
                "Please enter a valid Slack incoming webhook URL (https://hooks.slack.com/services/...)",
            },
          }}
        />

        <div>
          <Button
            title="Send Test Message"
            size={ButtonSize.Medium}
            type={ButtonStyleType.Primary}
            isLoading={isTesting}
            onClick={handleTestWebhook}
            disabled={
              !webhookUrl ||
              !webhookUrl.startsWith("https://hooks.slack.com/services/")
            }
          />
        </div>

        {testResult && (
          <Alert
            type={testSuccess ? AlertType.SUCCESS : AlertType.DANGER}
            title={testResult}
          />
        )}
      </div>
    </Card>
  );
};

export default SlackWebhookTester;
