import {
  formatServerSetupTime,
  getServerSetupRow,
  ServerSetupRow,
  ServerSetupStatusIcon,
} from "./ServerSetupChecklist";
import ServerEmailRecipientRefusals, {
  getEmailRecipientRefusals,
} from "./ServerEmailRecipientRefusals";
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
import { TemplateValues, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * "DOES IT WORK?" ON A CHANNEL'S OWN SETTINGS PAGE.
 *
 * Settings > Emails, Settings > Call and SMS and Settings > Push
 * Notifications each start with this card: where the channel stands, in the
 * setup checklist's words ("Set up, but not tested yet", "smtp.example.com
 * accepted an email on 11 Nov", "Failing ... Twilio said: ..."), and its
 * test sends - a test push going to the admin's own devices (#7028). A test
 * the provider accepts is
 * said here, by what took it; one it refuses stays in the dialog, in the
 * provider's words. Either way the card reads the checklist again, so it
 * says what the banner and Server setup now say.
 *
 * The test buttons are the card's actions, so they sit at the right of its
 * title like any card's (CardHeaderActionsGuard), and the status is drawn as
 * a Server setup row is: its icon, then its words. Drawn in the body under
 * the status, the button stood 12px further in than the words above it (a
 * footer button's step, md:ml-3) and the status read as a bare line of grey
 * text with no sign of whether email works (issue #8844).
 */

export const SERVER_TEST_CARD_COPY: {
  emailTitle: string;
  emailDescription: string;
  callAndSmsTitle: string;
  callAndSmsDescription: string;
  pushTitle: string;
  pushDescription: string;
} = {
  emailTitle: "Test email",
  emailDescription:
    "Send a test email through these settings to make sure email arrives.",
  callAndSmsTitle: "Test SMS and calls",
  callAndSmsDescription:
    "Send a test SMS or make a test call through these settings.",
  // Settings > Push Notifications (#7028).
  pushTitle: "Test push notifications",
  pushDescription:
    "Send a test push to your own phones and browsers to make sure push notifications reach them.",
};

export interface ComponentProps {
  check:
    | ServerSetupCheckId.Email
    | ServerSetupCheckId.SmsAndCalls
    | ServerSetupCheckId.BrowserPush;
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
    values: TemplateValues;
  }) => string = (sentence: {
    template: string;
    values: TemplateValues;
  }): string => {
    return translator.translateTemplate(sentence.template, sentence.values);
  };

  const buttons: Array<ReactElement> = props.channels.map(
    (channel: ServerSendingChannel): ReactElement => {
      return (
        <ServerTestSendButton
          key={channel}
          channel={channel}
          onAnswer={(answer: ServerTestSendAnswer) => {
            setAccepted(
              answer.result === ServerTestSendResult.Accepted ? answer : null,
            );
            void props.checklist.reload();
          }}
        />
      );
    },
  );

  return (
    <div data-testid={`server-test-card-${props.check}`}>
      <Card
        title={props.title}
        description={props.description}
        buttons={buttons}
      >
        {row || accepted ? (
          <div className="space-y-3">
            {row ? (
              <div className="flex items-start gap-3">
                <ServerSetupStatusIcon
                  row={row}
                  dataTestId={`server-test-card-${props.check}-icon`}
                />
                <div
                  className="min-w-0"
                  data-testid={`server-test-card-${props.check}-status`}
                >
                  <p className="text-sm text-gray-700 text-pretty">
                    {words(row.status)}
                  </p>
                  {row.checked.map(
                    (
                      sentence: {
                        template: string;
                        values: TemplateValues;
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

            {/*
             * Addresses refused while email works (#9217): said here, for
             * the server's admins, never in the banner.
             */}
            {props.check === ServerSetupCheckId.Email ? (
              <ServerEmailRecipientRefusals
                refusals={getEmailRecipientRefusals(props.checklist.answer)}
              />
            ) : (
              <></>
            )}
          </div>
        ) : // Nothing read yet: a title, a sentence and its button.
        undefined}
      </Card>
    </div>
  );
};

export default ServerTestCard;
