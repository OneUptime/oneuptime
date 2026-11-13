import StatusPageSetupApi, {
  StatusPageSetupRecord,
  mayCreateStatusPage,
} from "./StatusPageSetupApi";
import {
  STATUS_PAGE_NAME_SENTENCE,
  STATUS_PAGE_SETUP,
  STATUS_PAGE_SETUP_COPY,
  STATUS_PAGE_SETUP_GUIDE_DOCS_PATH,
  STATUS_PAGE_SETUP_EXTRAS,
  StatusPageSetupExtra,
  StatusPageSetupMonitor,
  StatusPageSetupProgressFacts,
  StatusPageSetupRunValue,
  StatusPageSetupStep,
  describeExtraPlan,
  describeShownMonitors,
  getDefaultStatusPageName,
  getPickDoneLine,
  getPickedMonitors,
  getStartOverStatusPageName,
  getStatusPageSetupProgress,
  isStatusPageNameValid,
  isStatusPageSetupFinished,
  pickAllMonitors,
  togglePickedMonitor,
} from "./StatusPageSetup";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import CheckboxElement from "Common/UI/Components/Checkbox/Checkbox";
import Input from "Common/UI/Components/Input/Input";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { BILLING_ENABLED, STATUS_PAGE_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * GUIDED SETUP: PUBLISH A STATUS PAGE (issue #6806), drawn in
 * GuidedSetupFrame. The rules and words are StatusPageSetup.ts; the
 * records StatusPageSetupApi.ts.
 */

export interface ComponentProps {
  // For tests: whether plans are shown (Cloud).
  isBillingEnabled?: boolean | undefined;
}

interface ShownMonitors {
  count: number;
  names: Array<string>;
}

const routeOf: (page: PageMap, modelId?: string | undefined) => Route = (
  page: PageMap,
  modelId?: string | undefined,
): Route => {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: modelId,
  });
};

// The page's public address on OneUptime's own domain.
export const getStatusPagePublicUrl: (statusPageId: string) => string = (
  statusPageId: string,
): string => {
  return `${STATUS_PAGE_URL.toString()}/${statusPageId}`;
};

/*
 * Button keeps a dialog footer's margin (md:ml-3); a row of the step's
 * actions takes it back, so they line up with the words above.
 */
const ACTIONS_CLASS_NAME: string =
  "flex flex-wrap items-center gap-y-2 md:-ml-3";

const linkClassName: string =
  "text-sm font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline";

const StatusPageGuidedSetup: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const userId: string = UserUtil.getUserId()?.toString() || "";
  const isBillingEnabled: boolean =
    props.isBillingEnabled === undefined
      ? BILLING_ENABLED
      : props.isBillingEnabled;

  const store: GuidedSetupRunStore = useMemo(() => {
    return new GuidedSetupRunStore({
      setup: STATUS_PAGE_SETUP,
      projectId: ProjectUtil.getCurrentProjectId()?.toString() || "",
      userId: userId,
    });
  }, [userId]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [run, setRun] = useState<GuidedSetupRun>({});
  const [statusPage, setStatusPage] = useState<StatusPageSetupRecord | null>(
    null,
  );
  const [shown, setShown] = useState<ShownMonitors>({ count: 0, names: [] });
  const [monitors, setMonitors] = useState<Array<StatusPageSetupMonitor>>([]);
  const [openStepKey, setOpenStepKey] = useState<string | null>(
    StatusPageSetupStep.Pick,
  );

  // Step 1's form: the project's name, to start with, and nothing picked.
  const defaultName: string = getDefaultStatusPageName({
    translator: translator,
    projectName: ProjectUtil.getCurrentProject()?.name,
  });
  const [name, setName] = useState<string>(defaultName);
  const [nameError, setNameError] = useState<string>("");
  const [picked, setPicked] = useState<Array<string>>([]);
  const [pickError, setPickError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  /*
   * Step 1 went on with a page this person already had (#7252): said once,
   * first in step 2, for this page's run; a reload or a new run drops it.
   */
  const [isFoundStatusPage, setIsFoundStatusPage] = useState<boolean>(false);

  const facts: StatusPageSetupProgressFacts = {
    hasStatusPage: Boolean(statusPage),
    monitorCount: shown.count,
    isReviewed: run[StatusPageSetupRunValue.Reviewed] === true,
  };

  const progress: ReturnType<typeof getStatusPageSetupProgress> =
    getStatusPageSetupProgress(facts);

  const saveRun: (values: Record<string, string | boolean | null>) => void = (
    values: Record<string, string | boolean | null>,
  ): void => {
    setRun(store.save(values));
  };

  // Reads the run's records: what exists decides which step opens.
  useEffect(() => {
    let isActive: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      const stored: GuidedSetupRun = store.read();
      let nextRun: GuidedSetupRun = stored;
      let loadedPage: StatusPageSetupRecord | null = null;
      let loadedShown: ShownMonitors = { count: 0, names: [] };

      const statusPageId: string | boolean | undefined =
        stored[StatusPageSetupRunValue.StatusPageId];

      if (typeof statusPageId === "string") {
        loadedPage = await StatusPageSetupApi.loadStatusPage(
          statusPageId,
        ).catch(() => {
          return null;
        });

        if (loadedPage) {
          loadedShown = await StatusPageSetupApi.loadShownMonitors(
            loadedPage.id,
          ).catch(() => {
            return { count: 0, names: [] };
          });
        } else {
          // The page is gone: this run starts again.
          store.forget();
          nextRun = {};
        }
      }

      const loadedMonitors: Array<StatusPageSetupMonitor> =
        await StatusPageSetupApi.loadMonitors();

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setStatusPage(loadedPage);
      setShown(loadedShown);
      setMonitors(loadedMonitors);
      setOpenStepKey(
        getFirstOpenStepKey(
          getStatusPageSetupProgress({
            hasStatusPage: Boolean(loadedPage),
            monitorCount: loadedShown.count,
            isReviewed: nextRun[StatusPageSetupRunValue.Reviewed] === true,
          }),
        ),
      );
      setIsLoading(false);
    };

    load().catch((err: Error) => {
      if (isActive) {
        setLoadError(API.getFriendlyMessage(err));
        setIsLoading(false);
      }
    });

    return () => {
      isActive = false;
    };
  }, [store]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (loadError) {
    return <Alert type={AlertType.DANGER} title={loadError} />;
  }

  if (!statusPage && !mayCreateStatusPage()) {
    return (
      <div className="max-w-3xl" data-testid="guided-setup-not-allowed">
        <Alert
          type={AlertType.INFO}
          title={
            translator.translateText(STATUS_PAGE_SETUP_COPY.cannotCreate) || ""
          }
        />
        <div className="mt-4">
          <AppLink to={routeOf(PageMap.STATUS_PAGES)} className={linkClassName}>
            {translator.translateText(STATUS_PAGE_SETUP_COPY.goToStatusPages) ||
              ""}
          </AppLink>
        </div>
      </div>
    );
  }

  /*
   * STEP 1: NAME IT, AND PICK WHAT IT SHOWS.
   */
  const createAndAdd: () => Promise<void> = async (): Promise<void> => {
    if (!statusPage && !isStatusPageNameValid(name)) {
      setNameError(
        translator.translateText(STATUS_PAGE_SETUP_COPY.nameError) || "",
      );
      return;
    }

    const pickedMonitors: Array<StatusPageSetupMonitor> = getPickedMonitors({
      monitors: monitors,
      picked: picked,
    });

    if (pickedMonitors.length === 0) {
      setPickError(
        translator.translateText(STATUS_PAGE_SETUP_COPY.nothingPicked) || "",
      );
      return;
    }

    setNameError("");
    setPickError("");
    setSaveError("");
    setIsSaving(true);

    try {
      let page: StatusPageSetupRecord | null = statusPage;
      let foundPage: StatusPageSetupRecord | null = null;

      if (!page) {
        /*
         * A page this person already made with this name is this run's: a
         * run the browser lost (a private window, another device, storage
         * cleared) or a second tab makes no second page with the same name
         * (#7252). A look-up that fails throws, and nothing is made.
         */
        foundPage = await StatusPageSetupApi.findOwnStatusPage({
          name: name,
          userId: userId,
        });

        if (foundPage) {
          page = foundPage;
        } else {
          const statusPageId: string =
            await StatusPageSetupApi.createStatusPage(name);
          saveRun({ [StatusPageSetupRunValue.StatusPageId]: statusPageId });
          page = { id: statusPageId, name: name.trim() };
          setStatusPage(page);
        }
      }

      await StatusPageSetupApi.addMonitors({
        statusPageId: page.id,
        monitors: pickedMonitors,
      });

      /*
       * The page found is the run's once it shows what was picked: a failed
       * add leaves the step as it was, and the next try looks again.
       */
      if (foundPage) {
        saveRun({ [StatusPageSetupRunValue.StatusPageId]: foundPage.id });
        setStatusPage(foundPage);
        setIsFoundStatusPage(true);
      }

      const nextShown: ShownMonitors =
        await StatusPageSetupApi.loadShownMonitors(page.id).catch(() => {
          return {
            count: pickedMonitors.length,
            names: pickedMonitors.map((monitor: StatusPageSetupMonitor) => {
              return monitor.name;
            }),
          };
        });

      setShown(nextShown);

      if (nextShown.count > 0) {
        setOpenStepKey(StatusPageSetupStep.Review);
      }
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const monitorList: ReactElement = (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.monitorsLabel)}
      </legend>
      <p className="mt-1 text-sm text-gray-500">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.monitorsHelp)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          className={linkClassName}
          data-testid="guided-setup-select-all"
          onClick={() => {
            setPicked(pickAllMonitors(monitors));
            setPickError("");
          }}
        >
          {translator.translateText(STATUS_PAGE_SETUP_COPY.selectAll)}
        </button>
        {picked.length > 0 ? (
          <button
            type="button"
            className={linkClassName}
            data-testid="guided-setup-clear-all"
            onClick={() => {
              setPicked([]);
            }}
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.clearAll)}
          </button>
        ) : (
          <></>
        )}
        <span
          className="text-sm text-gray-500"
          data-testid="guided-setup-picked-count"
          aria-live="polite"
        >
          {translator.translatePlural(
            {
              one: "{{count}} of {{total}} picked",
              other: "{{count}} of {{total}} picked",
            },
            picked.length,
            { total: translator.formatNumber(monitors.length) },
          )}
        </span>
      </div>
      <ul
        className="mt-2 max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200"
        data-testid="guided-setup-monitors"
      >
        {monitors.map((monitor: StatusPageSetupMonitor) => {
          return (
            <li
              key={monitor.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <CheckboxElement
                title={monitor.name}
                value={picked.includes(monitor.id)}
                onChange={() => {
                  setPicked(
                    togglePickedMonitor({
                      picked: picked,
                      monitorId: monitor.id,
                    }),
                  );
                  setPickError("");
                }}
                dataTestId={`guided-setup-monitor-${monitor.id}`}
              />
              {monitor.statusName ? (
                <span className="flex-shrink-0 text-sm text-gray-500">
                  {monitor.statusName}
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
      {pickError ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {pickError}
        </p>
      ) : (
        <></>
      )}
    </fieldset>
  );

  const pickContent: ReactElement =
    statusPage && shown.count > 0 ? (
      // Opened again once done: what the page shows, and where to change it.
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          {getPickDoneLine({
            translator: translator,
            name: statusPage.name,
            monitorCount: shown.count,
          })}
        </p>
        <div className={`${ACTIONS_CLASS_NAME} gap-x-4`}>
          <Button
            title={STATUS_PAGE_SETUP_COPY.continueButton}
            buttonStyle={ButtonStyleType.PRIMARY}
            dataTestId="guided-setup-pick-continue"
            onClick={() => {
              setOpenStepKey(
                // The next step not done, or the summary.
                getFirstOpenStepKey(progress),
              );
            }}
          />
          <AppLink
            to={routeOf(PageMap.STATUS_PAGE_VIEW_RESOURCES, statusPage.id)}
            className={linkClassName}
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.changeShown) || ""}
          </AppLink>
        </div>
      </div>
    ) : monitors.length === 0 ? (
      <div className="space-y-4" data-testid="guided-setup-no-monitors">
        <p className="text-sm text-gray-700">
          {translator.translateText(STATUS_PAGE_SETUP_COPY.noMonitors)}
        </p>
        <div className={ACTIONS_CLASS_NAME}>
          <AppLink
            to={routeOf(PageMap.MONITOR_GUIDED_SETUP)}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:ml-3"
            dataTestId="guided-setup-set-up-monitor"
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.setUpMonitor) ||
              ""}
          </AppLink>
        </div>
      </div>
    ) : (
      <form
        className="space-y-5"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void createAndAdd();
        }}
      >
        {statusPage ? (
          <p
            className="text-sm text-gray-700"
            data-testid="guided-setup-empty-page"
          >
            {translator.translateTemplate(
              STATUS_PAGE_SETUP_COPY.emptyPageHelp,
              { name: statusPage.name },
              STATUS_PAGE_NAME_SENTENCE,
            )}
          </p>
        ) : (
          <div>
            <label
              htmlFor="guided-setup-status-page-name"
              className="block text-sm font-medium text-gray-700"
            >
              {translator.translateText(STATUS_PAGE_SETUP_COPY.nameLabel)}
            </label>
            <div className="mt-1">
              <Input
                id="guided-setup-status-page-name"
                value={name}
                placeholder={STATUS_PAGE_SETUP_COPY.namePlaceholder}
                onChange={(value: string) => {
                  setName(value);
                  setNameError("");
                }}
                error={nameError || undefined}
                dataTestId="guided-setup-status-page-name"
              />
            </div>
          </div>
        )}
        {monitorList}
        {statusPage ? (
          <></>
        ) : (
          <p
            className="text-sm text-gray-700"
            data-testid="guided-setup-public-notice"
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.publicNotice)}
          </p>
        )}
        {saveError ? (
          <p role="alert" className="text-sm text-red-600">
            {saveError}
          </p>
        ) : (
          <></>
        )}
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={
              statusPage
                ? STATUS_PAGE_SETUP_COPY.addButton
                : STATUS_PAGE_SETUP_COPY.createButton
            }
            type={ButtonType.Submit}
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            dataTestId="guided-setup-create-status-page"
          />
        </div>
      </form>
    );

  /*
   * STEP 2: THIS IS WHAT YOUR CUSTOMERS SEE.
   */
  const publicUrl: string = statusPage
    ? getStatusPagePublicUrl(statusPage.id)
    : "";

  const publicLink: ReactElement = (
    <a
      href={publicUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-sm font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
      data-testid="guided-setup-public-link"
    >
      {publicUrl}
    </a>
  );

  const byItself: ReactElement = (
    <ul
      className="list-disc space-y-1 ps-5 text-sm text-gray-700"
      data-testid="guided-setup-what-appears"
    >
      <li>
        {translator.translateText(STATUS_PAGE_SETUP_COPY.incidentsAppear)}
      </li>
      <li>{translator.translateText(STATUS_PAGE_SETUP_COPY.alertsNever)}</li>
      <li>{translator.translateText(STATUS_PAGE_SETUP_COPY.postedByYou)}</li>
    </ul>
  );

  const reviewContent: ReactElement = (
    <div className="space-y-4">
      {/* Why no new page appeared, before what the page shows. */}
      {isFoundStatusPage && statusPage ? (
        <p
          className="break-words text-sm text-gray-700"
          data-testid="guided-setup-existing-status-page"
        >
          {translator.translateTemplate(
            STATUS_PAGE_SETUP_COPY.existingStatusPage,
            { name: statusPage.name },
            STATUS_PAGE_NAME_SENTENCE,
          )}
        </p>
      ) : (
        <></>
      )}
      <p className="text-sm text-gray-500">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.reviewHelp)}
      </p>
      {/* The page as a visitor reads it: its name, then each monitor. */}
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
        data-testid="guided-setup-preview"
      >
        {/* A long name wraps inside the preview on a phone (#7252). */}
        <p
          className="break-words text-base font-semibold text-gray-900"
          data-testid="guided-setup-preview-name"
        >
          {statusPage?.name}
        </p>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText(STATUS_PAGE_SETUP_COPY.showsLabel)}
        </p>
        <ul className="mt-2 space-y-1">
          {shown.names.map((shownName: string, index: number) => {
            const monitor: StatusPageSetupMonitor | undefined = monitors.find(
              (candidate: StatusPageSetupMonitor): boolean => {
                return candidate.name === shownName;
              },
            );

            return (
              <li
                key={`${shownName}-${index}`}
                className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words text-gray-900">
                  {shownName}
                </span>
                {monitor?.statusName ? (
                  <span className="flex flex-shrink-0 items-center gap-1.5 text-gray-600">
                    <span
                      className="h-2 w-2 rounded-full bg-emerald-500"
                      style={
                        monitor.statusColor
                          ? { backgroundColor: monitor.statusColor }
                          : undefined
                      }
                      aria-hidden="true"
                    />
                    {monitor.statusName}
                  </span>
                ) : (
                  <></>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-700">
          {translator.translateText(STATUS_PAGE_SETUP_COPY.linkLabel)}
        </p>
        <div className="mt-1">{publicLink}</div>
      </div>
      {byItself}
      <div className={ACTIONS_CLASS_NAME}>
        <Button
          title={STATUS_PAGE_SETUP_COPY.reviewButton}
          buttonStyle={ButtonStyleType.PRIMARY}
          dataTestId="guided-setup-review-continue"
          onClick={() => {
            saveRun({ [StatusPageSetupRunValue.Reviewed]: true });
            setOpenStepKey(null);
          }}
        />
      </div>
    </div>
  );

  const steps: Array<GuidedSetupFrameStep> = [
    {
      ...progress[0]!,
      title: STATUS_PAGE_SETUP_COPY.pickTitle,
      doneLine: statusPage
        ? getPickDoneLine({
            translator: translator,
            name: statusPage.name,
            monitorCount: shown.count,
          })
        : undefined,
      content: pickContent,
    },
    {
      ...progress[1]!,
      title: STATUS_PAGE_SETUP_COPY.reviewTitle,
      doneLine: publicUrl,
      content: reviewContent,
    },
  ];

  /*
   * THE SUMMARY.
   */
  const summary: ReactElement = (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2
        className="break-words text-lg font-semibold text-gray-900"
        data-testid="guided-setup-summary-title"
      >
        {translator.translateTemplate(
          STATUS_PAGE_SETUP_COPY.summaryTitle,
          { name: statusPage?.name || "" },
          STATUS_PAGE_NAME_SENTENCE,
        )}
      </h2>
      <dl className="mt-4 divide-y divide-gray-100">
        <div
          className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
          data-testid="guided-setup-summary-address"
        >
          <dt className="text-sm font-medium text-gray-900">
            {translator.translateText(STATUS_PAGE_SETUP_COPY.summaryAddress)}
          </dt>
          <dd className="mt-1 sm:col-span-3 sm:mt-0">{publicLink}</dd>
        </div>
        <div
          className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
          data-testid="guided-setup-summary-shows"
        >
          <dt className="text-sm font-medium text-gray-900">
            {translator.translateText(STATUS_PAGE_SETUP_COPY.summaryShows)}
          </dt>
          <dd className="mt-1 break-words text-sm text-gray-700 sm:col-span-3 sm:mt-0">
            {describeShownMonitors({
              translator: translator,
              names: shown.names,
              monitorCount: shown.count,
            })}
          </dd>
        </div>
        <div
          className="py-3 sm:grid sm:grid-cols-4 sm:gap-4"
          data-testid="guided-setup-summary-by-itself"
        >
          <dt className="text-sm font-medium text-gray-900">
            {translator.translateText(STATUS_PAGE_SETUP_COPY.summaryByItself)}
          </dt>
          <dd className="mt-1 sm:col-span-3 sm:mt-0">{byItself}</dd>
        </div>
      </dl>
      <h3 className="mt-5 text-sm font-semibold text-gray-900">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.summaryOptional)}
      </h3>
      <ul className="mt-2 space-y-2" data-testid="guided-setup-extras">
        {STATUS_PAGE_SETUP_EXTRAS.map((extra: StatusPageSetupExtra) => {
          const plan: string | null = describeExtraPlan({
            translator: translator,
            extra: extra,
            isBillingEnabled: isBillingEnabled,
          });

          return (
            <li
              key={extra.key}
              className="text-sm"
              data-testid={`guided-setup-extra-${extra.key}`}
            >
              <AppLink
                to={routeOf(extra.page, statusPage?.id)}
                className={linkClassName}
              >
                {translator.translateText(extra.title) || ""}
              </AppLink>
              <span className="text-gray-500">
                {" "}
                {translator.translateText(extra.description)}
              </span>
              {plan ? (
                <span
                  className="ms-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                  data-testid={`guided-setup-extra-${extra.key}-plan`}
                >
                  {plan}
                </span>
              ) : (
                <></>
              )}
            </li>
          );
        })}
      </ul>
      <h3 className="mt-5 text-sm font-semibold text-gray-900">
        {translator.translateText(STATUS_PAGE_SETUP_COPY.summaryNext)}
      </h3>
      <ul className="mt-2 space-y-1">
        <li>
          <AppLink
            to={routeOf(PageMap.ANNOUNCEMENT_CREATE)}
            className={linkClassName}
          >
            {translator.translateText(
              STATUS_PAGE_SETUP_COPY.nextAnnouncement,
            ) || ""}
          </AppLink>
        </li>
        <li>
          <AppLink
            to={routeOf(PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE)}
            className={linkClassName}
          >
            {translator.translateText(STATUS_PAGE_SETUP_COPY.nextMaintenance) ||
              ""}
          </AppLink>
        </li>
        {statusPage ? (
          <>
            <li>
              <AppLink
                to={routeOf(PageMap.STATUS_PAGE_VIEW_EMBEDDED, statusPage.id)}
                className={linkClassName}
              >
                {translator.translateText(STATUS_PAGE_SETUP_COPY.nextEmbed) ||
                  ""}
              </AppLink>
            </li>
            <li>
              <AppLink
                to={routeOf(PageMap.STATUS_PAGE_VIEW, statusPage.id)}
                className={linkClassName}
                dataTestId="guided-setup-open-status-page"
              >
                {translator.translateText(
                  STATUS_PAGE_SETUP_COPY.nextStatusPage,
                ) || ""}
              </AppLink>
            </li>
          </>
        ) : (
          <></>
        )}
      </ul>
      <div className={`mt-5 ${ACTIONS_CLASS_NAME}`}>
        <Button
          title={STATUS_PAGE_SETUP_COPY.startOver}
          buttonStyle={ButtonStyleType.NORMAL}
          icon={IconProp.Add}
          dataTestId="guided-setup-start-over"
          onClick={() => {
            store.forget();
            setRun({});
            setStatusPage(null);
            setIsFoundStatusPage(false);
            setShown({ count: 0, names: [] });
            setPicked([]);
            // Another page needs a name of its own (#7252).
            setName(
              getStartOverStatusPageName({
                defaultName: defaultName,
                finishedName: statusPage?.name,
              }),
            );
            setNameError("");
            setPickError("");
            setSaveError("");
            setOpenStepKey(StatusPageSetupStep.Pick);
          }}
        />
      </div>
    </div>
  );

  return (
    <GuidedSetupFrame
      setup={STATUS_PAGE_SETUP}
      steps={steps}
      openStepKey={openStepKey}
      onOpenStep={(key: string) => {
        setSaveError("");
        setOpenStepKey(key);
      }}
      summary={summary}
      isFinished={isStatusPageSetupFinished(facts)}
      guideDocsPath={STATUS_PAGE_SETUP_GUIDE_DOCS_PATH}
    />
  );
};

export default StatusPageGuidedSetup;
