import StatusPageRequireSsoCard from "./StatusPageRequireSsoCard";
import {
  STATUS_PAGE_REQUIRE_SSO_COLUMN,
  StatusPageRequireSsoCopy,
} from "./StatusPageAccessCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Status page > SSO and > OIDC below the Scale plan, on OneUptime Cloud:
 * each page is the plan's upsell, with the SAML or OIDC providers the
 * status page still has under it (PlanLeftoverTable), to turn off or
 * delete.
 *
 * A status page a Scale trial left requiring SSO still requires it: its
 * private users can sign in with SSO or OIDC only. Turning its providers
 * off without letting people back in with their passwords would leave
 * nobody able to sign in, so while it requires SSO its "Require SSO for
 * Login" switch is drawn here too, to turn off. Once it is off, the card
 * says how people sign in now instead of offering the switch again:
 * requiring SSO is what the plan sells.
 *
 * Read once, when the page opens; the switch starts from what was read (no
 * second read). A status page that does not require SSO - nearly all of
 * them - gets nothing here, and so does one whose read fails.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
}

export const STATUS_PAGE_REQUIRE_SSO_LEFTOVER_TEST_ID: string =
  "status-page-require-sso-leftover";
export const STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID: string =
  "status-page-require-sso-leftover-off";

enum LeftoverState {
  // Not read yet, or not requiring SSO: nothing is drawn.
  None = "None",
  Requiring = "Requiring",
  TurnedOff = "TurnedOff",
}

const StatusPageRequireSsoLeftover: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [state, setState] = useState<LeftoverState>(LeftoverState.None);
  const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
  const statusPageIdString: string = props.statusPageId.toString();

  useEffect(() => {
    let isCurrent: boolean = true;

    setState(LeftoverState.None);
    setStatusPage(null);

    ModelAPI.getItem<StatusPage>({
      modelType: StatusPage,
      id: props.statusPageId,
      select: {
        [STATUS_PAGE_REQUIRE_SSO_COLUMN]: true,
      },
    })
      .then((item: StatusPage | null): void => {
        if (isCurrent && item && item[STATUS_PAGE_REQUIRE_SSO_COLUMN]) {
          setStatusPage(item);
          setState(LeftoverState.Requiring);
        }
      })
      .catch((): void => {
        // Nothing is drawn: the upsell is the page.
      });

    return () => {
      isCurrent = false;
    };
  }, [statusPageIdString]);

  if (state === LeftoverState.None) {
    return <></>;
  }

  if (state === LeftoverState.TurnedOff || !statusPage) {
    return (
      <div data-testid={STATUS_PAGE_REQUIRE_SSO_LEFTOVER_OFF_TEST_ID}>
        <Card
          title={StatusPageRequireSsoCopy.cardTitle}
          description={StatusPageRequireSsoCopy.switchOffDescription}
        />
      </div>
    );
  }

  return (
    <div data-testid={STATUS_PAGE_REQUIRE_SSO_LEFTOVER_TEST_ID}>
      <StatusPageRequireSsoCard
        statusPageId={props.statusPageId}
        isPlanLeftover={true}
        initialStatusPage={statusPage}
        onSaved={(isOn: boolean): void => {
          if (!isOn) {
            setState(LeftoverState.TurnedOff);
          }
        }}
      />
    </div>
  );
};

export default StatusPageRequireSsoLeftover;
