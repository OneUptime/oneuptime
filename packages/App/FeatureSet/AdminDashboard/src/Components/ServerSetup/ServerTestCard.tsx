import {
  formatServerSetupTime,
  getServerSetupRow,
  ServerSetupRow,
} from "./ServerSetupChecklist";
import ServerTestSendButton, {
  describeServerTestSend,
} from "./ServerTestSendButton";
import Protocol from "Common/Types/API/Protocol";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupCheckResult,
} from "Common/Types/ServerSetup/ServerSetupChecklist";
import {
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "Common/Types/ServerSetup/ServerTestSend";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import { UseServerSetupChecklistResult } from "Common/UI/Utils/ServerSetupChecklist";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "DOES IT WORK?" ON A CHANNEL'S OWN SETTINGS PAGE.
 *
 * Settings > Emails and Settings > Call and SMS each start with this card:
 * where the channel stands, in the setup checklist's words ("Set up, but not
 * tested yet", "smtp.example.com accepted an email on 11 Nov", "Failing ...
 * Twilio said: ..."), and its test sends. A test the provider accepts is
 * said here, by what took it; one it refuses stays in the dialog, in the
 * provider's words. Either way the card reads the checklist again, so it
 * says what the banner and Server setup now say.
 */

export const SERVER_TEST_CARD_COPY: {
  emailTitle: string;
  emailDescription: string;
  callAndSmsTitle: string;
  callAndSmsDescription: string;
} = {
  emailTitle: "Test email",
  emailDescription:
    "Send a test email through these settings to make sure email arrives.",
  callAndSmsTitle: "Test SMS and calls",
  callAndSmsDescription:
    "Send a test SMS or make a test call through these settings.",
};

export interface ComponentProps {
  check: ServerSetupCheckId.Email | ServerSetupCheckId.SmsAndCalls;
  title: string;
  description: string;
  channels: Array<ServerSendingChannel>;
  checklist: UseServerSetupChecklistResult;
}

const ServerTestCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [accepted, setAccepted] = useState<ServerTestSendAnswer | null>(null);

  const result: ServerSetupCheckResult | null = props.checklist.answer
    ? ServerSetupChecklistUtil.getCheck(props.checklist.answer, props.check)
    : null;

  const row: ServerSetupRow | null = result
    ? getServerSetupRow({
        check: result,
        definition: ServerSetupChecklistUtil.getDefinition(props.check),
        page: {
          httpProtocol: Protocol.HTTPS,
          pageProtocol: "https:",
          httpsAddress: "",
        },
        formatTime: formatServerSetupTime,
      })
    : null;

  const words: (sentence: {
    template: string;
    values: Record<string, string>;
  }) => string = (sentence: {
    template: string;
    values: Record<string, string>;
  }): string => {
    return translator.translateTemplate(sentence.template, sentence.values);
  };

  return (
    <div data-testid={`server-test-card-${props.check}`}>
      <Card title={props.title} description={props.description}>
        <div className="space-y-3">
          {row ? (
            <div data-testid={`server-test-card-${props.check}-status`}>
              <p className="text-sm text-gray-700 text-pretty">
                {words(row.status)}
              </p>
              {row.checked.map(
                (
                  sentence: {
                    template: string;
                    values: Record<string, string>;
                  },
                  index: number,
                ): ReactElement => {
                  return (
                    <p
                      key={index}
                      className="mt-1 break-words text-xs text-gray-500"
                    >
                      {words(sentence)}
                    </p>
                  );
                },
              )}
            </div>
          ) : (
            <></>
          )}

          {accepted ? (
            <Alert
              type={AlertType.SUCCESS}
              title={describeServerTestSend(translator, accepted)}
              dataTestId={`server-test-card-${props.check}-accepted`}
            />
          ) : (
            <></>
          )}

          <div className="flex flex-wrap gap-2">
            {props.channels.map(
              (channel: ServerSendingChannel): ReactElement => {
                return (
                  <ServerTestSendButton
                    key={channel}
                    channel={channel}
                    onAnswer={(answer: ServerTestSendAnswer) => {
                      setAccepted(
                        answer.result === ServerTestSendResult.Accepted
                          ? answer
                          : null,
                      );
                      void props.checklist.reload();
                    }}
                  />
                );
              },
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ServerTestCard;
