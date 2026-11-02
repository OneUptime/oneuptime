import SessionLengthCopy, {
  SESSION_LENGTH_CARD_TEST_ID,
} from "./SessionLengthCopy";
import {
  SessionLengthCardProps,
  SessionLengthDropdownRow,
} from "./SessionLengthSettingRows";
import {
  SESSION_IDLE_TIMEOUT_COLUMN,
  SESSION_LENGTH_COLUMN,
  SessionLengthKind,
} from "Common/Types/UserSession/SessionLength";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Session Length card of the Session Length page: the two lengths every
 * sign-in is held to - how long after it signed in, and after how long
 * without use, its person signs in again - and that API keys and MCP
 * connections are not sign-ins.
 */
const SessionLengthCard: FunctionComponent<SessionLengthCardProps> = (
  props: SessionLengthCardProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();
  const translator: Translator = useTranslator();

  return (
    <Card
      title={SessionLengthCopy.cardTitle}
      description={SessionLengthCopy.cardDescription}
    >
      <div
        className={ruledListClassName}
        data-testid={SESSION_LENGTH_CARD_TEST_ID}
      >
        <div className="px-5 py-4 md:px-6">
          <SessionLengthDropdownRow
            column={SESSION_LENGTH_COLUMN}
            kind={SessionLengthKind.Length}
            label={SessionLengthCopy.lengthLabel}
            initialValue={props.settings.sessionLengthInMinutes}
            isLocked={props.isLocked}
            confirmChange={props.confirmChange}
            onSaved={props.onSaved}
          />
        </div>
        <div className="px-5 py-4 md:px-6">
          <SessionLengthDropdownRow
            column={SESSION_IDLE_TIMEOUT_COLUMN}
            kind={SessionLengthKind.IdleTimeout}
            label={SessionLengthCopy.idleLabel}
            initialValue={props.settings.sessionIdleTimeoutInMinutes}
            isLocked={props.isLocked}
            confirmChange={props.confirmChange}
            onSaved={props.onSaved}
          />
        </div>
        <p
          className="px-5 py-3 text-sm text-gray-500 md:px-6"
          data-testid={`${SESSION_LENGTH_CARD_TEST_ID}-note`}
        >
          {translator.translateText(SessionLengthCopy.notSessionsNote)}
        </p>
      </div>
    </Card>
  );
};

export default SessionLengthCard;
