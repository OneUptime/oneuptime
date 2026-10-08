import {
  MCP_OAUTH_CONSENT_APPROVE_API_URL,
  MCP_OAUTH_CONSENT_DENY_API_URL,
  MCP_OAUTH_CONSENT_DETAILS_API_URL,
} from "../Utils/ApiPaths";
import McpAuthorizeUtil, {
  McpConsentAccess,
  McpConsentDetails,
  McpConsentProject,
} from "../Utils/McpAuthorize";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import API from "Common/UI/Utils/API/API";
import McpOAuthPendingAuthorization from "Common/UI/Utils/McpOAuthPendingAuthorization";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * The consent screen an MCP client sends its user to: "this client wants to
 * act for you in OneUptime - in which project, and may it change things?"
 *
 * It is the only place access is ever delegated to a client, so it says
 * plainly what cannot be faked and what can. A client's NAME is whatever the
 * client typed. Where the browser goes afterwards, and - for a client
 * identified by a metadata document - the host that document lives on, are
 * facts, and they are what the page leads with.
 *
 * WHEN NOBODY IS SIGNED IN
 *
 * The first request needs a session. Without one the API client does what it
 * does everywhere: it sends the browser to the sign-in page. Before that
 * request goes out the page leaves the request in a cookie
 * (McpOAuthPendingAuthorization), and the dashboard - where every kind of
 * sign-in ends - brings the browser back here.
 */

type PageState =
  | { kind: "loading" }
  | { kind: "error"; code: string }
  | { kind: "message"; message: string }
  | { kind: "ready"; details: McpConsentDetails }
  | { kind: "redirecting"; clientName: string };

const McpAuthorize: () => JSX.Element = () => {
  const { t, i18n } = useTranslation();

  /*
   * The page is read right to left in Persian. Without a direction on it the
   * sentences are laid out left to right and every one that mixes in a Latin
   * name ("OneUptime", the client's name, a host) comes out with its pieces
   * in the wrong order - on the one screen where the order of the words is
   * what a person is agreeing to.
   */
  const direction: "ltr" | "rtl" = i18n.dir();

  // A name placed inside a sentence; see McpAuthorizeUtil.isolate.
  const inSentence: (value: string) => string = (value: string): string => {
    return McpAuthorizeUtil.isolate(value, direction);
  };

  // A host, address or email placed inside a sentence: always left to right.
  const addressInSentence: (value: string) => string = (
    value: string,
  ): string => {
    return McpAuthorizeUtil.isolateLeftToRight(value, direction);
  };

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [ticket, setTicket] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [access, setAccess] = useState<McpConsentAccess>("read");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");

  const loadDetails: (request: string) => Promise<void> = async (
    request: string,
  ): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(MCP_OAUTH_CONSENT_DETAILS_API_URL),
        data: { request },
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      /*
       * 401: nobody is signed in, and the API client is already on its way to
       * the sign-in page. The remembered request is left in place - that is
       * what brings the browser back here afterwards.
       */
      if (response.statusCode === 401) {
        return;
      }

      McpOAuthPendingAuthorization.clear();
      setState({ kind: "message", message: API.getFriendlyMessage(response) });
      return;
    }

    McpOAuthPendingAuthorization.clear();

    const details: McpConsentDetails | null = McpAuthorizeUtil.parseDetails(
      response.data,
    );

    if (!details) {
      setState({ kind: "error", code: "server_error" });
      return;
    }

    setProjectId(McpAuthorizeUtil.getInitialProjectId(details));
    setAccess(details.requestedAccess);
    setState({ kind: "ready", details });
  };

  useEffect(() => {
    /*
     * This page asks a person to hand a client their access. Drawn inside
     * another site's frame it could be dressed up as something else and the
     * Authorize button clicked by trickery, so it refuses to work framed. The
     * bundled proxy already forbids framing /accounts (X-Frame-Options); this
     * holds the same line on an install whose own proxy does not.
     */
    if (McpAuthorizeUtil.isFramed()) {
      setState({ kind: "error", code: "framed" });
      return;
    }

    /*
     * An error the authorization endpoint could not send back to the client.
     * Only its code is used; the wording is ours (see McpAuthorizeUtil).
     */
    const errorCode: string | null = Navigation.getQueryStringByName("error");

    if (errorCode) {
      setState({
        kind: "error",
        code: McpAuthorizeUtil.toDisplayErrorCode(errorCode),
      });
      return;
    }

    const request: string | null = Navigation.getQueryStringByName("request");

    if (!McpOAuthPendingAuthorization.isTicket(request)) {
      setState({ kind: "error", code: "missing_request" });
      return;
    }

    setTicket(request);

    // Left for the dashboard to find if this visit turns into a sign-in.
    McpOAuthPendingAuthorization.remember(request);

    loadDetails(request).catch((err: unknown): void => {
      /*
       * No answer at all (the network, not a refusal). The person is still
       * on this page and reloading it starts over, so the request is not
       * left behind for the dashboard to act on later.
       */
      McpOAuthPendingAuthorization.clear();
      setState({ kind: "message", message: API.getFriendlyMessage(err) });
    });
  }, []);

  /*
   * Approve or deny, then follow the redirect the server hands back. The
   * destination is the client's own registered redirect URI; it is checked
   * once more here because this is the line that navigates.
   */
  const submit: (decision: "approve" | "deny") => Promise<void> = async (
    decision: "approve" | "deny",
  ): Promise<void> => {
    if (state.kind !== "ready") {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(
            decision === "approve"
              ? MCP_OAUTH_CONSENT_APPROVE_API_URL
              : MCP_OAUTH_CONSENT_DENY_API_URL,
          ),
          data:
            decision === "approve"
              ? { request: ticket, projectId, access }
              : { request: ticket },
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        /*
         * The session ended while the page was open. The API client is
         * sending the browser to sign in; remembering the request again is
         * what brings it back here afterwards.
         */
        if (response.statusCode === 401) {
          McpOAuthPendingAuthorization.remember(ticket);
          return;
        }

        setSubmitError(API.getFriendlyMessage(response));
        setIsSubmitting(false);
        return;
      }

      const redirectUrl: unknown = response.data["redirectUrl"];

      if (!McpAuthorizeUtil.isSafeRedirectUrl(redirectUrl)) {
        setState({ kind: "error", code: "server_error" });
        return;
      }

      setState({
        kind: "redirecting",
        clientName: state.details.client.name,
      });

      window.location.assign(redirectUrl);
    } catch (err) {
      setSubmitError(API.getFriendlyMessage(err));
      setIsSubmitting(false);
    }
  };

  const renderHeader: (subtitle?: string | undefined) => ReactElement = (
    subtitle?: string | undefined,
  ): ReactElement => {
    return (
      <div className="w-full max-w-md mx-auto">
        <ProductLogo
          className="mx-auto h-10 w-auto sm:h-12"
        />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          {t("mcpAuthorize.title")}
        </h2>
        {subtitle ? (
          <p
            className="mt-2 text-center text-sm text-gray-600 px-2 sm:px-0"
            data-testid="mcp-authorize-subtitle"
          >
            {subtitle}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderProblem: (message: string) => ReactElement = (
    message: string,
  ): ReactElement => {
    return (
      <div
        className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8"
        dir={direction}
      >
        {renderHeader()}
        <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
          <div
            className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10"
            data-testid="mcp-authorize-problem"
          >
            <p className="text-sm font-medium text-gray-900">
              {t("mcpAuthorize.errorTitle")}
            </p>
            <p className="mt-2 text-sm text-gray-600">{message}</p>
            <p className="mt-4 text-sm text-gray-500">
              {t("mcpAuthorize.errorHelp")}
            </p>
          </div>
        </div>
      </div>
    );
  };

  if (state.kind === "loading") {
    return <PageLoader isVisible={true} />;
  }

  if (state.kind === "error") {
    return renderProblem(t(`mcpAuthorize.errors.${state.code}`));
  }

  if (state.kind === "message") {
    return renderProblem(state.message);
  }

  if (state.kind === "redirecting") {
    return (
      <div
        className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8"
        dir={direction}
      >
        {renderHeader(
          t("mcpAuthorize.redirecting", {
            clientName: inSentence(state.clientName),
          }),
        )}
        <p
          className="mt-4 text-center text-sm text-gray-500"
          data-testid="mcp-authorize-redirecting"
        >
          {t("mcpAuthorize.redirectingHelp")}
        </p>
      </div>
    );
  }

  const details: McpConsentDetails = state.details;
  const eligibleProjects: Array<McpConsentProject> =
    McpAuthorizeUtil.getEligibleProjects(details);
  const canAuthorize: boolean = Boolean(projectId) && !isSubmitting;

  return (
    <div
      className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8"
      dir={direction}
    >
      {renderHeader(
        t("mcpAuthorize.wantsAccess", {
          clientName: inSentence(details.client.name),
        }),
      )}

      <div className="mt-6 sm:mt-8 w-full max-w-md mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10 space-y-6">
          {/* Who is asking, and where the browser goes next. */}
          <dl className="text-sm space-y-3" data-testid="mcp-authorize-client">
            {details.client.verifiedHost ? (
              <div>
                <dt className="font-medium text-gray-900">
                  {t("mcpAuthorize.verifiedHostLabel")}
                </dt>
                <dd
                  className="mt-0.5 text-gray-600 break-all"
                  data-testid="mcp-authorize-verified-host"
                >
                  {details.client.verifiedHost}
                </dd>
                <dd className="mt-0.5 text-xs text-gray-500">
                  {t("mcpAuthorize.verifiedHostHelp")}
                </dd>
              </div>
            ) : (
              <div>
                <dd
                  className="text-xs text-gray-500"
                  data-testid="mcp-authorize-unverified-name"
                >
                  {t("mcpAuthorize.unverifiedNameHelp")}
                </dd>
              </div>
            )}

            <div>
              <dt className="font-medium text-gray-900">
                {t("mcpAuthorize.redirectLabel")}
              </dt>
              <dd
                className="mt-0.5 text-gray-600 break-words"
                data-testid="mcp-authorize-redirect-target"
              >
                {details.client.isLoopbackRedirect
                  ? t("mcpAuthorize.redirectToThisDevice", {
                      target: addressInSentence(details.client.redirectTarget),
                    })
                  : t("mcpAuthorize.redirectToHost", {
                      target: addressInSentence(details.client.redirectTarget),
                    })}
              </dd>
            </div>

            <div>
              <dd
                className="text-gray-600 break-words"
                data-testid="mcp-authorize-signed-in-as"
              >
                {t("mcpAuthorize.signedInAs", {
                  email: addressInSentence(details.user.email),
                })}
              </dd>
            </div>
          </dl>

          {details.client.isLoopbackRedirect ? (
            <Alert
              type={AlertType.WARNING}
              title={t("mcpAuthorize.loopbackWarning")}
              dataTestId="mcp-authorize-loopback-warning"
            />
          ) : (
            <></>
          )}

          {details.projects.length === 0 ? (
            <Alert
              type={AlertType.INFO}
              title={t("mcpAuthorize.noProjects")}
              dataTestId="mcp-authorize-no-projects"
            />
          ) : (
            <></>
          )}

          {details.projects.length > 0 && eligibleProjects.length === 0 ? (
            <Alert
              type={AlertType.WARNING}
              title={t("mcpAuthorize.noEligibleProjects")}
              dataTestId="mcp-authorize-no-eligible-projects"
            />
          ) : (
            <></>
          )}

          {details.projects.length > 0 ? (
            <div>
              <label
                htmlFor="mcp-authorize-project"
                className="block text-sm font-medium text-gray-900"
              >
                {t("mcpAuthorize.projectLabel")}
              </label>
              <select
                id="mcp-authorize-project"
                data-testid="mcp-authorize-project"
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                value={projectId}
                disabled={isSubmitting}
                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                  setProjectId(event.target.value);
                }}
              >
                <option value="">{t("mcpAuthorize.projectPlaceholder")}</option>
                {details.projects.map((project: McpConsentProject) => {
                  return (
                    <option
                      key={project.id}
                      value={project.id}
                      disabled={!project.isEligible}
                    >
                      {project.isEligible
                        ? project.name
                        : t(
                            `mcpAuthorize.projectRefusal.${McpAuthorizeUtil.toProjectRefusalKey(project.refusal)}`,
                            { name: inSentence(project.name) },
                          )}
                    </option>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                {t("mcpAuthorize.projectHelp")}
              </p>
            </div>
          ) : (
            <></>
          )}

          {eligibleProjects.length > 0 ? (
            <fieldset data-testid="mcp-authorize-access">
              <legend className="block text-sm font-medium text-gray-900">
                {t("mcpAuthorize.accessLabel")}
              </legend>
              <div className="mt-2 space-y-2">
                {/*
                 * Write is offered only when the client asked for it. The
                 * member can give a client less than it asked for, never
                 * more.
                 */}
                {details.requestedAccess === "write" ? (
                  <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer">
                    <input
                      type="radio"
                      name="mcp-authorize-access"
                      className="mt-1"
                      data-testid="mcp-authorize-access-write"
                      checked={access === "write"}
                      disabled={isSubmitting}
                      onChange={() => {
                        setAccess("write");
                      }}
                    />
                    <span className="text-sm">
                      <span className="block font-medium text-gray-900">
                        {t("mcpAuthorize.accessWriteTitle")}
                      </span>
                      <span className="block text-gray-500">
                        {t("mcpAuthorize.accessWriteDescription")}
                      </span>
                    </span>
                  </label>
                ) : (
                  <></>
                )}
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="mcp-authorize-access"
                    className="mt-1"
                    data-testid="mcp-authorize-access-read"
                    checked={access === "read"}
                    disabled={isSubmitting}
                    onChange={() => {
                      setAccess("read");
                    }}
                  />
                  <span className="text-sm">
                    <span className="block font-medium text-gray-900">
                      {t("mcpAuthorize.accessReadTitle")}
                    </span>
                    <span className="block text-gray-500">
                      {t("mcpAuthorize.accessReadDescription")}
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          ) : (
            <></>
          )}

          <p className="text-xs text-gray-500">
            {t("mcpAuthorize.permissionsNote")}
          </p>

          {submitError ? (
            <Alert
              type={AlertType.DANGER}
              title={submitError}
              dataTestId="mcp-authorize-submit-error"
            />
          ) : (
            <></>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              title={t("mcpAuthorize.denyButton")}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={isSubmitting}
              dataTestId="mcp-authorize-deny"
              onClick={() => {
                submit("deny").catch(() => {
                  // submit() reports its own failures.
                });
              }}
            />
            <Button
              title={t("mcpAuthorize.authorizeButton")}
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={!canAuthorize}
              isLoading={isSubmitting}
              dataTestId="mcp-authorize-approve"
              onClick={() => {
                submit("approve").catch(() => {
                  // submit() reports its own failures.
                });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpAuthorize;
