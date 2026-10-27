import {
  MARKETPLACE_PURCHASE_COMPLETE_API_URL,
  MARKETPLACE_PURCHASE_DETAILS_API_URL,
  MARKETPLACE_PURCHASE_DISMISS_API_URL,
} from "../Utils/ApiPaths";
import MarketplacePurchaseUtil from "../Utils/MarketplacePurchase";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  MarketplacePurchaseDetails,
  MarketplacePurchasePlan,
  MarketplacePurchaseProject,
} from "Common/Types/Marketplace/MarketplacePurchase";
import MarketplaceSubscriptionStatus from "Common/Types/Marketplace/MarketplaceSubscriptionStatus";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ProductLogo from "Common/UI/Components/ProductLogo/ProductLogo";
import { DASHBOARD_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import MarketplacePendingPurchase from "Common/UI/Utils/MarketplacePendingPurchase";
import Navigation from "Common/UI/Utils/Navigation";
import React, { ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/*
 * Where a buyer arrives after buying OneUptime on AWS Marketplace, Microsoft
 * Marketplace or Google Cloud Marketplace: they choose the project the
 * purchase pays for - a new one, or one of theirs - and from then on that
 * project is billed on their cloud bill instead of by card.
 *
 * The purchase itself is never in this page's URL. The server resolved the
 * marketplace's token when the buyer arrived and gave the browser a claim
 * token in an HttpOnly cookie, which only the marketplace API receives.
 *
 * WHEN NOBODY IS SIGNED IN
 *
 * The first request needs a session. Without one the API client sends the
 * browser to sign in (or to create an account); before that request goes out
 * the page leaves a marker cookie (MarketplacePendingPurchase), and the
 * dashboard - where every kind of sign-in ends - sends the browser back here.
 */

type PageState =
  | { kind: "loading" }
  | { kind: "message"; title: string; message: string }
  | { kind: "ready"; details: MarketplacePurchaseDetails }
  | { kind: "redirecting" };

type ProjectChoice = "new" | "existing";

const MarketplacePurchase: () => JSX.Element = () => {
  const { t, i18n } = useTranslation();
  const direction: "ltr" | "rtl" = i18n.dir();

  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [choice, setChoice] = useState<ProjectChoice>("new");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [planId, setPlanId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");

  const loadDetails: () => Promise<void> = async (): Promise<void> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(MARKETPLACE_PURCHASE_DETAILS_API_URL),
        data: {},
      });

    if (response instanceof HTTPErrorResponse || response.isFailure()) {
      /*
       * 401: nobody is signed in, and the API client is already on its way
       * to the sign-in page. The marker stays, to bring the browser back.
       */
      if (response.statusCode === 401) {
        return;
      }

      MarketplacePendingPurchase.clear();
      setState({
        kind: "message",
        title: t("marketplacePurchase.errorTitle"),
        message: API.getFriendlyMessage(response),
      });
      return;
    }

    MarketplacePendingPurchase.clear();

    const details: MarketplacePurchaseDetails | null =
      MarketplacePurchaseUtil.parseDetails(response.data);

    if (!details) {
      setState({
        kind: "message",
        title: t("marketplacePurchase.errorTitle"),
        message: t("marketplacePurchase.errorHelp"),
      });
      return;
    }

    const eligibleProjects: Array<MarketplacePurchaseProject> =
      MarketplacePurchaseUtil.getEligibleProjects(details);

    // The new-project option is offered only with a plan to put it on.
    const canCreate: boolean =
      details.canCreateProject && details.plans.length > 0;

    setChoice(canCreate || eligibleProjects.length === 0 ? "new" : "existing");
    setProjectId(eligibleProjects.length === 1 ? eligibleProjects[0]!.id : "");
    setPlanId(MarketplacePurchaseUtil.getDefaultPlanId(details.plans));
    setState({ kind: "ready", details });
  };

  useEffect(() => {
    // Left for the dashboard to find if this visit turns into a sign-in.
    MarketplacePendingPurchase.remember();

    loadDetails().catch((err: unknown): void => {
      MarketplacePendingPurchase.clear();
      setState({
        kind: "message",
        title: t("marketplacePurchase.errorTitle"),
        message: API.getFriendlyMessage(err),
      });
    });
  }, []);

  const submit: () => Promise<void> = async (): Promise<void> => {
    if (state.kind !== "ready") {
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(MARKETPLACE_PURCHASE_COMPLETE_API_URL),
          data:
            choice === "existing"
              ? { projectId: projectId }
              : { projectName: projectName, planId: planId },
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        if (response.statusCode === 401) {
          MarketplacePendingPurchase.remember();
          return;
        }

        setSubmitError(API.getFriendlyMessage(response));
        setIsSubmitting(false);
        return;
      }

      const redirectUrl: unknown = response.data["redirectUrl"];

      setState({ kind: "redirecting" });

      Navigation.navigate(
        MarketplacePurchaseUtil.isSafeRedirectUrl(redirectUrl)
          ? URL.fromString(`${window.location.origin}${redirectUrl}`)
          : DASHBOARD_URL,
        { forceNavigate: true },
      );
    } catch (err) {
      setSubmitError(API.getFriendlyMessage(err));
      setIsSubmitting(false);
    }
  };

  const dismiss: () => Promise<void> = async (): Promise<void> => {
    MarketplacePendingPurchase.clear();

    try {
      await API.post<JSONObject>({
        url: URL.fromURL(MARKETPLACE_PURCHASE_DISMISS_API_URL),
        data: {},
      });
    } catch {
      // Leaving the page is what matters; the claim also expires on its own.
    }

    Navigation.navigate(DASHBOARD_URL, { forceNavigate: true });
  };

  const renderHeader: (subtitle?: string | undefined) => ReactElement = (
    subtitle?: string | undefined,
  ): ReactElement => {
    return (
      <div className="w-full max-w-lg mx-auto">
        <ProductLogo />
        <h2 className="mt-4 sm:mt-6 text-center text-xl sm:text-2xl tracking-tight text-gray-900">
          {t("marketplacePurchase.title")}
        </h2>
        {subtitle ? (
          <p
            className="mt-2 text-balance text-center text-sm text-gray-600 px-2 sm:px-0"
            data-testid="marketplace-purchase-subtitle"
          >
            {subtitle}
          </p>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const renderCard: (children: ReactElement) => ReactElement = (
    children: ReactElement,
  ): ReactElement => {
    return (
      <div
        className="flex min-h-full flex-col justify-center py-8 px-4 sm:py-12 sm:px-6 lg:px-8"
        dir={direction}
      >
        {children}
      </div>
    );
  };

  if (state.kind === "loading") {
    return <PageLoader isVisible={true} />;
  }

  if (state.kind === "redirecting") {
    return renderCard(
      <>
        {renderHeader()}
        <p
          className="mt-4 text-center text-sm text-gray-500"
          data-testid="marketplace-purchase-redirecting"
        >
          {t("marketplacePurchase.redirecting")}
        </p>
      </>,
    );
  }

  if (state.kind === "message") {
    return renderCard(
      <>
        {renderHeader()}
        <div className="mt-6 sm:mt-8 w-full max-w-lg mx-auto">
          <div
            className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10"
            data-testid="marketplace-purchase-message"
          >
            <p className="text-sm font-medium text-gray-900">{state.title}</p>
            <p className="mt-2 text-sm text-gray-600">{state.message}</p>
            <div className="mt-6 flex justify-end">
              <Button
                title={t("marketplacePurchase.goToDashboard")}
                buttonStyle={ButtonStyleType.NORMAL}
                dataTestId="marketplace-purchase-go-to-dashboard"
                onClick={() => {
                  Navigation.navigate(DASHBOARD_URL, { forceNavigate: true });
                }}
              />
            </div>
          </div>
        </div>
      </>,
    );
  }

  const details: MarketplacePurchaseDetails = state.details;
  const marketplace: string = details.marketplaceName;
  const eligibleProjects: Array<MarketplacePurchaseProject> =
    MarketplacePurchaseUtil.getEligibleProjects(details);

  if (details.linkedProjectId) {
    return renderCard(
      <>
        {renderHeader(t("marketplacePurchase.alreadySetUp", { marketplace }))}
        <div className="mt-6 flex justify-center">
          <Button
            title={t("marketplacePurchase.openProject")}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="marketplace-purchase-open-project"
            onClick={() => {
              Navigation.navigate(
                URL.fromString(
                  `${window.location.origin}/dashboard/${details.linkedProjectId}/settings/billing`,
                ),
                { forceNavigate: true },
              );
            }}
          />
        </div>
      </>,
    );
  }

  if (details.status === MarketplaceSubscriptionStatus.Cancelled) {
    return renderCard(
      <>
        {renderHeader()}
        <div className="mt-6 sm:mt-8 w-full max-w-lg mx-auto">
          <Alert
            type={AlertType.WARNING}
            title={t("marketplacePurchase.cancelled", { marketplace })}
            dataTestId="marketplace-purchase-cancelled"
          />
        </div>
      </>,
    );
  }

  const canChooseExisting: boolean = eligibleProjects.length > 0;
  const canCreate: boolean =
    details.canCreateProject && details.plans.length > 0;
  const canSubmit: boolean =
    !isSubmitting &&
    (choice === "existing"
      ? Boolean(projectId)
      : Boolean(projectName.trim()) && Boolean(planId));

  return renderCard(
    <>
      {renderHeader(t("marketplacePurchase.subtitle", { marketplace }))}

      <div className="mt-6 sm:mt-8 w-full max-w-lg mx-auto">
        <div className="bg-white py-6 px-4 shadow-sm sm:shadow rounded-lg sm:py-8 sm:px-10 space-y-6">
          <dl
            className="text-sm space-y-3"
            data-testid="marketplace-purchase-summary"
          >
            <div>
              <dt className="font-medium text-gray-900">
                {t("marketplacePurchase.boughtOnLabel")}
              </dt>
              <dd className="mt-0.5 text-gray-600">{marketplace}</dd>
            </div>
            {details.buyerEmail || details.buyerId ? (
              <div>
                <dt className="font-medium text-gray-900">
                  {t("marketplacePurchase.buyerLabel")}
                </dt>
                <dd className="mt-0.5 text-gray-600 break-all" dir="ltr">
                  {details.buyerEmail || details.buyerId}
                </dd>
              </div>
            ) : (
              <></>
            )}
            {details.marketplacePlan ? (
              <div>
                <dt className="font-medium text-gray-900">
                  {t("marketplacePurchase.marketplacePlanLabel")}
                </dt>
                <dd className="mt-0.5 text-gray-600 break-all">
                  {details.marketplacePlan}
                </dd>
              </div>
            ) : (
              <></>
            )}
            <div>
              <dd
                className="text-gray-600 break-words"
                data-testid="marketplace-purchase-signed-in-as"
              >
                {t("marketplacePurchase.signedInAs", {
                  email: details.signedInEmail,
                })}
              </dd>
            </div>
          </dl>

          {details.isFreeTrial ? (
            <Alert
              type={AlertType.INFO}
              title={t("marketplacePurchase.freeTrial", { marketplace })}
              dataTestId="marketplace-purchase-free-trial"
            />
          ) : (
            <></>
          )}

          {!canChooseExisting && !canCreate ? (
            <Alert
              type={AlertType.WARNING}
              title={t("marketplacePurchase.nothingToChoose")}
              dataTestId="marketplace-purchase-nothing-to-choose"
            />
          ) : (
            <fieldset data-testid="marketplace-purchase-choice">
              <legend className="block text-sm font-medium text-gray-900">
                {t("marketplacePurchase.choiceLabel")}
              </legend>
              <div className="mt-2 space-y-2">
                {canCreate ? (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="marketplace-purchase-choice"
                        className="mt-1"
                        data-testid="marketplace-purchase-choice-new"
                        checked={choice === "new"}
                        disabled={isSubmitting}
                        onChange={() => {
                          setChoice("new");
                        }}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        {t("marketplacePurchase.createProjectOption")}
                      </span>
                    </label>
                    {choice === "new" ? (
                      <div className="mt-3 ms-7 space-y-3 text-sm">
                        <span className="block">
                          <label
                            htmlFor="marketplace-purchase-project-name"
                            className="block text-sm text-gray-700"
                          >
                            {t("marketplacePurchase.projectNameLabel")}
                          </label>
                          <input
                            id="marketplace-purchase-project-name"
                            data-testid="marketplace-purchase-project-name"
                            type="text"
                            maxLength={100}
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            placeholder={t(
                              "marketplacePurchase.projectNamePlaceholder",
                            )}
                            value={projectName}
                            disabled={isSubmitting}
                            onChange={(
                              event: React.ChangeEvent<HTMLInputElement>,
                            ) => {
                              setProjectName(event.target.value);
                            }}
                          />
                        </span>
                        <span className="block">
                          <label
                            htmlFor="marketplace-purchase-plan"
                            className="block text-sm text-gray-700"
                          >
                            {t("marketplacePurchase.planLabel")}
                          </label>
                          <select
                            id="marketplace-purchase-plan"
                            data-testid="marketplace-purchase-plan"
                            className="mt-1 block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            value={planId}
                            disabled={isSubmitting}
                            onChange={(
                              event: React.ChangeEvent<HTMLSelectElement>,
                            ) => {
                              setPlanId(event.target.value);
                            }}
                          >
                            {details.plans.map(
                              (plan: MarketplacePurchasePlan) => {
                                return (
                                  <option key={plan.planId} value={plan.planId}>
                                    {plan.monthlyPricePerUserInUSD > 0
                                      ? t("marketplacePurchase.planOption", {
                                          name: plan.name,
                                          price:
                                            MarketplacePurchaseUtil.formatPrice(
                                              plan.monthlyPricePerUserInUSD,
                                            ),
                                        })
                                      : t(
                                          "marketplacePurchase.planOptionFree",
                                          { name: plan.name },
                                        )}
                                  </option>
                                );
                              },
                            )}
                          </select>
                        </span>
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}

                {details.projects.length > 0 ? (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="marketplace-purchase-choice"
                        className="mt-1"
                        data-testid="marketplace-purchase-choice-existing"
                        checked={choice === "existing"}
                        disabled={isSubmitting || !canChooseExisting}
                        onChange={() => {
                          setChoice("existing");
                        }}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        {t("marketplacePurchase.existingProjectOption")}
                      </span>
                    </label>
                    {choice === "existing" ? (
                      <div className="mt-3 ms-7 text-sm">
                        <select
                          id="marketplace-purchase-project"
                          data-testid="marketplace-purchase-project"
                          aria-label={t("marketplacePurchase.projectLabel")}
                          className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          value={projectId}
                          disabled={isSubmitting}
                          onChange={(
                            event: React.ChangeEvent<HTMLSelectElement>,
                          ) => {
                            setProjectId(event.target.value);
                          }}
                        >
                          <option value="">
                            {t("marketplacePurchase.projectPlaceholder")}
                          </option>
                          {details.projects.map(
                            (project: MarketplacePurchaseProject) => {
                              return (
                                <option
                                  key={project.id}
                                  value={project.id}
                                  disabled={!project.isEligible}
                                >
                                  {project.isEligible
                                    ? project.name
                                    : t(
                                        `marketplacePurchase.projectRefusal.${project.refusal || "not_billing_manager"}`,
                                        { name: project.name },
                                      )}
                                </option>
                              );
                            },
                          )}
                        </select>
                        <span className="mt-1 block text-xs text-gray-500">
                          {t("marketplacePurchase.existingProjectHelp", {
                            marketplace,
                          })}
                        </span>
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}
              </div>
            </fieldset>
          )}

          <p className="text-xs text-gray-500">
            {t("marketplacePurchase.billingNote", { marketplace })}
          </p>

          {submitError ? (
            <Alert
              type={AlertType.DANGER}
              title={submitError}
              dataTestId="marketplace-purchase-submit-error"
            />
          ) : (
            <></>
          )}

          <div className="flex items-center justify-end gap-3">
            <Button
              title={t("marketplacePurchase.notNowButton")}
              buttonStyle={ButtonStyleType.NORMAL}
              disabled={isSubmitting}
              dataTestId="marketplace-purchase-not-now"
              onClick={() => {
                dismiss().catch(() => {
                  // dismiss() navigates whatever happens.
                });
              }}
            />
            <Button
              title={t("marketplacePurchase.submitButton")}
              buttonStyle={ButtonStyleType.PRIMARY}
              disabled={!canSubmit}
              isLoading={isSubmitting}
              dataTestId="marketplace-purchase-submit"
              onClick={() => {
                submit().catch(() => {
                  // submit() reports its own failures.
                });
              }}
            />
          </div>
        </div>
      </div>
    </>,
  );
};

export default MarketplacePurchase;
