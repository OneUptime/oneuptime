import {
  getAutoRechargeFailedDescription,
  ProjectBalanceAccess,
} from "./ProjectBalanceAccess";
import { AUTO_RECHARGE_FAILED_TITLE } from "./ProjectBalanceCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AutoRechargeState from "Common/Types/Billing/AutoRechargeState";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE,
  ProjectBalanceType,
} from "Common/Utils/Project/ProjectBalance";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * At the top of the page that holds one of the project's prepaid balances
 * (Notification Settings, AI Credits): Auto Recharge's last automatic
 * charge did not go through, so it is not adding to the balance for now.
 * Shown only then - asked of the server (AutoRechargeState.Failed), which
 * keeps the failure for the hour Auto Recharge waits before it tries the
 * card again. It used to reach only the owners, by email.
 *
 * What to do is for someone who may add balance; everyone else is told who
 * can (getAutoRechargeFailedDescription). Nothing is shown while the answer
 * is on its way, when it cannot be read, or where OneUptime does not bill.
 */
export interface ComponentProps {
  balance: ProjectBalanceType;
  access: ProjectBalanceAccess;
  /*
   * Changed by the page when something may have ended the wait - Auto
   * Recharge saved, which tries the card at once - so the notice asks again.
   */
  refreshKey?: number | undefined;
}

const AutoRechargeFailedNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();

  // The project the last answer was Failed for: a project switch hides it.
  const [failedForProjectId, setFailedForProjectId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let isCurrent: boolean = true;

    if (!BILLING_ENABLED || !projectId) {
      setFailedForProjectId(null);
      return;
    }

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              PROJECT_BALANCE_AUTO_RECHARGE_STATE_ROUTE[props.balance],
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isCurrent) {
          return;
        }

        const isFailed: boolean =
          !(response instanceof HTTPErrorResponse) &&
          response.data?.["state"] === AutoRechargeState.Failed;

        setFailedForProjectId(isFailed ? projectId : null);
      } catch {
        // Not known: nothing to say.
        if (isCurrent) {
          setFailedForProjectId(null);
        }
      }
    };

    void load();

    return (): void => {
      isCurrent = false;
    };
  }, [projectId, props.balance, props.refreshKey]);

  if (!projectId || failedForProjectId !== projectId) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.DANGER}
      strongTitle={AUTO_RECHARGE_FAILED_TITLE}
      title={getAutoRechargeFailedDescription(props.balance, props.access)}
      dataTestId="auto-recharge-failed-notice"
      className="mb-5"
    />
  );
};

export default AutoRechargeFailedNotice;
