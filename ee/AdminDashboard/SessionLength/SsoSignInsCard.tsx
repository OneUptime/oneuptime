import SessionLengthCopy, {
  SSO_SESSION_LENGTH_CARD_TEST_ID,
} from "./SessionLengthCopy";
import {
  SessionLengthCardProps,
  SessionLengthDropdownRow,
  SessionLengthSeparateSsoRow,
} from "./SessionLengthSettingRows";
import {
  SessionLengthKind,
  SSO_SESSION_IDLE_TIMEOUT_COLUMN,
  SSO_SESSION_LENGTH_COLUMN,
} from "Common/Types/UserSession/SessionLength";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledListClassName } from "Common/UI/Components/Card/CardSurface";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The SSO Sign-ins card of the Session Length page, folded under its More
 * settings and drawn as one of its sections: the switch that gives sign-ins
 * through SSO lengths of their own, and - while it is on - those two
 * lengths. A card of its own module, so it is read as a whole card where
 * the page folds it (CardInCardGuard).
 */
const SsoSignInsCard: FunctionComponent<SessionLengthCardProps> = (
  props: SessionLengthCardProps,
): ReactElement => {
  const ruledListClassName: string = useCardRuledListClassName();

  return (
    <Card
      title={SessionLengthCopy.ssoCardTitle}
      description={SessionLengthCopy.ssoCardDescription}
    >
      <div
        className={ruledListClassName}
        data-testid={SSO_SESSION_LENGTH_CARD_TEST_ID}
      >
        <div className="px-5 py-4 md:px-6">
          <SessionLengthSeparateSsoRow
            initialValue={props.settings.useSeparateSsoSessionLengths}
            isLocked={props.isLocked}
            confirmChange={props.confirmChange}
            onSaved={props.onSaved}
          />
        </div>
        {props.settings.useSeparateSsoSessionLengths ? (
          <>
            <div className="px-5 py-4 md:px-6">
              <SessionLengthDropdownRow
                column={SSO_SESSION_LENGTH_COLUMN}
                kind={SessionLengthKind.Length}
                label={SessionLengthCopy.lengthLabel}
                initialValue={props.settings.ssoSessionLengthInMinutes}
                isLocked={props.isLocked}
                confirmChange={props.confirmChange}
                onSaved={props.onSaved}
              />
            </div>
            <div className="px-5 py-4 md:px-6">
              <SessionLengthDropdownRow
                column={SSO_SESSION_IDLE_TIMEOUT_COLUMN}
                kind={SessionLengthKind.IdleTimeout}
                label={SessionLengthCopy.idleLabel}
                initialValue={props.settings.ssoSessionIdleTimeoutInMinutes}
                isLocked={props.isLocked}
                confirmChange={props.confirmChange}
                onSaved={props.onSaved}
              />
            </div>
          </>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default SsoSignInsCard;
