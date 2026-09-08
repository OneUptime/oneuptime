import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Link from "Common/UI/Components/Link/Link";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { ReactElement, useEffect, useState } from "react";

interface Props {
  title: string;
  description: string | ReactElement;
  value?: boolean | undefined;
  onChange?: ((value: boolean) => void) | undefined;
  dataTestId: string;
  error?: string | undefined;
}

/** Shared by single-resource forms and bulk monitor recommendations. */
export default function PaidUsageConsent(props: Props): ReactElement {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  const [status, setStatus] = useState<{
    projectId: string | undefined;
    state: "loading" | "allowed" | "locked" | "error";
  }>({ projectId, state: "loading" });
  const [attempt, setAttempt] = useState<number>(0);

  useEffect(() => {
    let current: boolean = true;
    setStatus({ projectId, state: "loading" });

    const loadStatus: () => Promise<void> = async (): Promise<void> => {
      try {
        if (!BILLING_ENABLED) {
          if (current) {
            setStatus({ projectId, state: "allowed" });
          }
          return;
        }
        if (!projectId) {
          throw new Error("Project is unavailable");
        }
        const response: HTTPResponse<JSONObject> =
          await BaseAPI.get<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/billing/pay-as-you-go-status",
            ),
            headers: ModelAPI.getCommonHeaders(),
          });
        if (current) {
          setStatus({
            projectId,
            state: response.data["isAllowed"] === true ? "allowed" : "locked",
          });
        }
      } catch {
        if (current) {
          setStatus({ projectId, state: "error" });
        }
      }
    };

    void loadStatus();
    return (): void => {
      current = false;
    };
  }, [projectId, attempt]);

  const state: string =
    status.projectId === projectId ? status.state : "loading";
  const allowed: boolean = state === "allowed";

  useEffect(() => {
    if (!allowed && props.value) {
      props.onChange?.(false);
    }
  }, [allowed, props.value, props.onChange]);

  return (
    <div className="space-y-3">
      {!allowed && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-gray-700"
          role="status"
        >
          {state === "loading" && "Checking paid feature access…"}
          {state === "locked" &&
            "Add a payment method before using this paid feature. Free features remain available without a card."}
          {state === "error" &&
            "We could not check paid feature access. Try again before continuing."}
          {state !== "loading" && (
            <div className="mt-2 flex items-center gap-3">
              {projectId && (
                <Link
                  className="font-medium underline"
                  openInNewTab={true}
                  to={new Route(`/dashboard/${projectId}/settings/billing`)}
                >
                  Set up billing
                </Link>
              )}
              <Button
                title="Check again"
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={(): void => {
                  setAttempt(attempt + 1);
                }}
              />
            </div>
          )}
        </div>
      )}
      <CheckboxElement
        title={props.title}
        ariaLabel={props.title}
        description={props.description}
        value={allowed && Boolean(props.value)}
        disabled={!allowed}
        error={props.error}
        dataTestId={props.dataTestId}
        onChange={(value: boolean): void => {
          if (allowed) {
            props.onChange?.(value);
          }
        }}
      />
    </div>
  );
}
