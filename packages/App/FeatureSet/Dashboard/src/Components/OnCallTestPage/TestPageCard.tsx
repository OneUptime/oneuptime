import SendTestPageButton from "./SendTestPageButton";
import Card from "Common/UI/Components/Card/Card";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Send me a test page", where a person sets up how OneUptime reaches them -
 * Notification Methods and On-Call Rules (OnCallTestPage). One card, one
 * button: the dialog says what it will send before it does.
 */

export interface ComponentProps {
  dataTestId?: string | undefined;
}

const TestPageCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div data-testid={props.dataTestId || "test-page-card"}>
      <Card
        title="Test your pages"
        description="Send yourself a test page to see each of your methods work, without an incident. Every message says TEST, and nobody else is told."
        buttons={[
          <SendTestPageButton key="send-test-page" target={{ kind: "self" }} />,
        ]}
      />
    </div>
  );
};

export default TestPageCard;
