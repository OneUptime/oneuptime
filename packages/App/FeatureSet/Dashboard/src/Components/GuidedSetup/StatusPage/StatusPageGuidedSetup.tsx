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
  StatusPageSetupMonitorGroup,
  StatusPageSetupPage,
  StatusPageSetupProgressFacts,
  StatusPageSetupRunValue,
  StatusPageSetupStep,
  STATUS_PAGE_SETUP_MONITOR_QUERY,
  describeExtraPlan,
  describeShownMonitors,
  getDefaultStatusPageName,
  getExistingPagesLine,
  getMonitorPickedOnOpen,
  getPickDoneLine,
  getPickedMonitorGroups,
  getPickedMonitors,
  getStartOverStatusPageName,
  getStatusPageSetupProgress,
  isStatusPageNameValid,
  isStatusPageSetupFinished,
} from "./StatusPageSetup";
import StatusPageSetupPicker from "./StatusPageSetupPicker";
import GuidedSetupFrame, { GuidedSetupFrameStep } from "../GuidedSetupFrame";
import {
  GUIDED_SETUP_NAME_QUERY,
  getDescribeItPrompt,
  readGuidedSetupPrefill,
} from "../AskAiGuidedSetupLinks";
import useGuidedSetupRunSync from "../UseGuidedSetupRunSync";
import GuidedSetupRunStore, {
  GuidedSetupRun,
  GuidedSetupRunSync,
  getFirstOpenStepKey,
} from "../GuidedSetupProgress";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  WELCOME_STEP_MINUTES,
  WelcomeStep,
} from "Common/Types/WelcomeChecklist/WelcomeChecklist";
import IconProp from "Common/Types/Icon/IconProp";
import { getStatusPagePublicName } from "Common/Types/StatusPage/StatusPagePublicName";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ButtonType from "Common/UI/Components/Button/ButtonTypes";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { BILLING_ENABLED, STATUS_PAGE_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

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
  // Which monitors and monitor groups they are (#7517), where read.
  monitorIds?: Array<string> | undefined;
  monitorGroupIds?: Array<string> | undefined;
}

const NOTHING_SHOWN: ShownMonitors = { count: 0, names: [] };

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
 * A row of the step's actions, lined up with the words above: the row's gap
 * spaces them (a Button has no margin of its own).
 */
const ACTIONS_CLASS_NAME: string = "flex flex-wrap items-center gap-3";

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
  const runSync: GuidedSetupRunSync = useGuidedSetupRunSync(store);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [run, setRun] = useState<GuidedSetupRun>({});
  const [statusPage, setStatusPage] = useState<StatusPageSetupRecord | null>(
    null,
  );
  const [shown, setShown] = useState<ShownMonitors>(NOTHING_SHOWN);
  const [monitors, setMonitors] = useState<Array<StatusPageSetupMonitor>>([]);
  const [monitorGroups, setMonitorGroups] = useState<
    Array<StatusPageSetupMonitorGroup>
  >([]);
  /*
   * The project's status pages this person may change, newest first
   * (#7517): step 1 goes on with one of them unless the person makes a new
   * one (isNewPage). What the one picked shows already is marked on the
   * list (chosenShown).
   */
  const [existingPages, setExistingPages] = useState<
    Array<StatusPageSetupPage>
  >([]);
  const [isNewPage, setIsNewPage] = useState<boolean>(true);
  const [chosenPageId, setChosenPageId] = useState<string>("");
  // The page picked last, for a read of what it shows that arrives late.
  const chosenPageIdRef: MutableRefObject<string> = useRef<string>("");
  const [chosenShown, setChosenShown] = useState<ShownMonitors | null>(null);
  const [openStepKey, setOpenStepKey] = useState<string | null>(
    StatusPageSetupStep.Pick,
  );

  /*
   * Step 1's form: the project's name, to start with, and nothing picked -
   * or the name an Ask AI plan opened it with (?name=, Open in guided
   * setup, #7245): a page of the project's by that name is picked once the
   * pages are read, and a new page takes it otherwise.
   */
  const defaultName: string = getDefaultStatusPageName({
    translator: translator,
    projectName: ProjectUtil.getCurrentProject()?.name,
  });
  const nameFromAskAi: string = readGuidedSetupPrefill(
    Navigation.getQueryStringByName(GUIDED_SETUP_NAME_QUERY),
  );
  const [name, setName] = useState<string>(nameFromAskAi || defaultName);
  const [nameError, setNameError] = useState<string>("");
  const [picked, setPicked] = useState<Array<string>>([]);
  const [pickedGroups, setPickedGroups] = useState<Array<string>>([]);
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

  /*
   * The page the monitors go on, of the project's: what it shows already is
   * read, to mark on the list. A read that fails marks nothing, and the add
   * still skips what the page shows.
   */
  const choosePage: (pageId: string) => void = (pageId: string): void => {
    chosenPageIdRef.current = pageId;
    setChosenPageId(pageId);
    setChosenShown(null);
    setPickError("");
    setSaveError("");

    if (!pageId) {
      return;
    }

    StatusPageSetupApi.loadShownMonitors(pageId)
      .then((pageShown: ShownMonitors) => {
        // A page picked again since: its own read draws its marks.
        if (chosenPageIdRef.current === pageId) {
          setChosenShown(pageShown);
        }
      })
      .catch(() => {
        if (chosenPageIdRef.current === pageId) {
          setChosenShown(null);
        }
      });
  };

  // Reads the run's records: what exists decides which step opens.
  useEffect(() => {
    let isActive: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      // The server's run (#7253): another device's, or this one's.
      const stored: GuidedSetupRun = await store.load();
      let nextRun: GuidedSetupRun = stored;
      let loadedPage: StatusPageSetupRecord | null = null;
      let loadedShown: ShownMonitors = NOTHING_SHOWN;

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
            return NOTHING_SHOWN;
          });
        } else {
          // The page is gone: this run starts again.
          store.forget();
          nextRun = {};
        }
      }

      /*
       * The monitor groups and the pages to offer are extras: a read that
       * fails leaves the list to the monitors, and step 1 to a new page.
       */
      const [loadedMonitors, loadedGroups, loadedPages]: [
        Array<StatusPageSetupMonitor>,
        Array<StatusPageSetupMonitorGroup>,
        Array<StatusPageSetupPage>,
      ] = await Promise.all([
        StatusPageSetupApi.loadMonitors(),
        StatusPageSetupApi.loadMonitorGroups().catch(() => {
          return [] as Array<StatusPageSetupMonitorGroup>;
        }),
        StatusPageSetupApi.loadEditableStatusPages().catch(() => {
          return [] as Array<StatusPageSetupPage>;
        }),
      ]);

      if (!isActive) {
        return;
      }

      setRun(nextRun);
      setStatusPage(loadedPage);
      setShown(loadedShown);
      setMonitors(loadedMonitors);
      setMonitorGroups(loadedGroups);
      setExistingPages(loadedPages);

      /*
       * A project with pages this person may change goes on with the
       * newest - or, opened from an Ask AI plan, with the page it names,
       * and a new page by that name when the project has none of it.
       */
      const namedPage: StatusPageSetupPage | undefined = nameFromAskAi
        ? loadedPages.find((page: StatusPageSetupPage): boolean => {
            return (
              (page.name || "").trim().toLowerCase() ===
              nameFromAskAi.toLowerCase()
            );
          })
        : undefined;
      const goesOnWith: StatusPageSetupPage | undefined = nameFromAskAi
        ? namedPage
        : loadedPages[0];

      setIsNewPage(!goesOnWith);

      if (!loadedPage && goesOnWith) {
        choosePage(goesOnWith.id);
      }
      setPicked(
        getMonitorPickedOnOpen({
          monitorId: Navigation.getQueryStringByName(
            STATUS_PAGE_SETUP_MONITOR_QUERY,
          ),
          monitors: loadedMonitors,
        }),
      );
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
    return <PageSkeleton />;
  }

  if (loadError) {
    return <Alert type={AlertType.DANGER} title={loadError} />;
  }

  const mayCreate: boolean = mayCreateStatusPage();

  // Someone who may neither make a page nor change one of the project's.
  if (!statusPage && !mayCreate && existingPages.length === 0) {
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

  // The project's page the monitors go on, while step 1 offers one (#7517).
  const chosenPage: StatusPageSetupPage | null =
    !statusPage && !isNewPage
      ? existingPages.find((page: StatusPageSetupPage): boolean => {
          return page.id === chosenPageId;
        }) ||
        existingPages[0] ||
        null
      : null;

  // What the page picked shows already: marked on the list, never added twice.
  const onThePageMonitorIds: Array<string> = chosenPage
    ? chosenShown?.monitorIds || []
    : [];
  const onThePageGroupIds: Array<string> = chosenPage
    ? chosenShown?.monitorGroupIds || []
    : [];

  const pickedMonitors: Array<StatusPageSetupMonitor> = getPickedMonitors({
    monitors: monitors,
    picked: picked.filter((monitorId: string): boolean => {
      return !onThePageMonitorIds.includes(monitorId);
    }),
  });
  const pickedMonitorGroups: Array<StatusPageSetupMonitorGroup> =
    getPickedMonitorGroups({
      monitorGroups: monitorGroups,
      picked: pickedGroups.filter((groupId: string): boolean => {
        return !onThePageGroupIds.includes(groupId);
      }),
    });
  const hasNewPick: boolean =
    pickedMonitors.length + pickedMonitorGroups.length > 0;

  /*
   * A page of the project's picked that shows something already, and
   * nothing more to add: step 1 is done as it is, and goes on to step 2.
   */
  const goesOnAsItIs: boolean =
    Boolean(chosenPage) && !hasNewPick && (chosenShown?.count || 0) > 0;

  const createAndAdd: () => Promise<void> = async (): Promise<void> => {
    if (!statusPage && !chosenPage && !isStatusPageNameValid(name)) {
      setNameError(
        translator.translateText(STATUS_PAGE_SETUP_COPY.nameError) || "",
      );
      return;
    }

    if (goesOnAsItIs && chosenPage && chosenShown) {
      setPickError("");
      setSaveError("");
      saveRun({ [StatusPageSetupRunValue.StatusPageId]: chosenPage.id });
      setStatusPage({
        id: chosenPage.id,
        name: chosenPage.name,
        pageTitle: chosenPage.pageTitle,
      });
      setShown(chosenShown);
      setOpenStepKey(StatusPageSetupStep.Review);
      return;
    }

    if (!hasNewPick) {
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
      /*
       * A page that was there already: the project's page picked (#7517),
       * or one of this person's with the name typed (#7252).
       */
      let pageThere: StatusPageSetupRecord | null = null;
      let isFoundByName: boolean = false;

      if (!page && chosenPage) {
        pageThere = {
          id: chosenPage.id,
          name: chosenPage.name,
          pageTitle: chosenPage.pageTitle,
        };
        page = pageThere;
      } else if (!page) {
        /*
         * A page this person already made with this name is this run's: a
         * run the browser lost (a private window, another device, storage
         * cleared) or a second tab makes no second page with the same name
         * (#7252). A look-up that fails throws, and nothing is made.
         */
        pageThere = await StatusPageSetupApi.findOwnStatusPage({
          name: name,
          userId: userId,
        });

        if (pageThere) {
          page = pageThere;
          isFoundByName = true;
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
        ...(pickedMonitorGroups.length > 0
          ? { monitorGroups: pickedMonitorGroups }
          : {}),
      });

      /*
       * The page that was there is the run's once it shows what was picked:
       * a failed add leaves the step as it was, and the next try looks
       * again.
       */
      if (pageThere) {
        saveRun({ [StatusPageSetupRunValue.StatusPageId]: pageThere.id });
        setStatusPage(pageThere);
        setIsFoundStatusPage(isFoundByName);
      }

      const added: Array<string> = [
        ...pickedMonitorGroups.map(
          (group: StatusPageSetupMonitorGroup): string => {
            return group.name;
          },
        ),
        ...pickedMonitors.map((monitor: StatusPageSetupMonitor): string => {
          return monitor.name;
        }),
      ];

      /*
       * A read that fails: what was added, after what the project's page
       * picked showed already - never what a page picked before showed.
       */
      const shownBefore: ShownMonitors =
        (chosenPage && chosenPage.id === page.id ? chosenShown : null) ||
        NOTHING_SHOWN;
      const nextShown: ShownMonitors =
        await StatusPageSetupApi.loadShownMonitors(page.id).catch(() => {
          return {
            count: shownBefore.count + added.length,
            names: [...shownBefore.names, ...added],
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
    <StatusPageSetupPicker
      monitors={monitors}
      monitorGroups={monitorGroups}
      picked={picked}
      pickedGroups={pickedGroups}
      onPick={(nextPicked: Array<string>, nextGroups: Array<string>) => {
        setPicked(nextPicked);
        setPickedGroups(nextGroups);
        setPickError("");
      }}
      onThePageMonitorIds={onThePageMonitorIds}
      onThePageGroupIds={onThePageGroupIds}
      error={pickError || undefined}
    />
  );

  const pageOptions: Array<DropdownOption> = existingPages.map(
    (page: StatusPageSetupPage): DropdownOption => {
      // A page's name as the project wrote it.
      return { value: page.id, label: page.name, isUserContent: true };
    },
  );

  // The project's pages, offered first (#7517): one named, several picked from.
  const existingPagesOffer: ReactElement = (
    <div className="space-y-3">
      <p
        className="break-words text-sm text-gray-700"
        data-testid="guided-setup-existing-pages"
      >
        {getExistingPagesLine({
          translator: translator,
          pages: existingPages,
        })}
      </p>
      {existingPages.length > 1 ? (
        <div>
          <label
            htmlFor="guided-setup-existing-page"
            className="block text-sm font-medium text-gray-700"
          >
            {translator.translateText(
              STATUS_PAGE_SETUP_COPY.existingPagesLabel,
            )}
          </label>
          <div className="mt-1" data-testid="guided-setup-existing-page">
            <Dropdown
              inputId="guided-setup-existing-page"
              options={pageOptions}
              value={pageOptions.find((option: DropdownOption): boolean => {
                return option.value === chosenPage?.id;
              })}
              isClearable={false}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (typeof value === "string") {
                  choosePage(value);
                }
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );

  // The other way: a new page, or back to the project's (#7517).
  const switchPageButton: ReactElement =
    !statusPage && chosenPage && mayCreate ? (
      <Button
        title={STATUS_PAGE_SETUP_COPY.makeNewInstead}
        buttonStyle={ButtonStyleType.LINK}
        dataTestId="guided-setup-make-new-page"
        onClick={() => {
          setIsNewPage(true);
          setPickError("");
          setSaveError("");
        }}
      />
    ) : !statusPage && !chosenPage && existingPages.length > 0 ? (
      <Button
        title={STATUS_PAGE_SETUP_COPY.useExistingInstead}
        buttonStyle={ButtonStyleType.LINK}
        dataTestId="guided-setup-use-existing-page"
        onClick={() => {
          setIsNewPage(false);
          setNameError("");
          setPickError("");
          setSaveError("");

          if (
            !existingPages.some((page: StatusPageSetupPage): boolean => {
              return page.id === chosenPageId;
            }) &&
            existingPages[0]
          ) {
            choosePage(existingPages[0].id);
          }
        }}
      />
    ) : (
      <></>
    );

  const pickButtonTitle: string = statusPage
    ? STATUS_PAGE_SETUP_COPY.addButton
    : chosenPage
      ? goesOnAsItIs
        ? STATUS_PAGE_SETUP_COPY.continueButton
        : STATUS_PAGE_SETUP_COPY.addButton
      : STATUS_PAGE_SETUP_COPY.createButton;

  const pickContent: ReactElement =
    statusPage && shown.count > 0 ? (
      // Opened again once done: what the page shows, and where to change it.
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          {getPickDoneLine({
            translator: translator,
            name: statusPage.name,
            monitorCount: shown.count,
            hasMonitorGroups: (shown.monitorGroupIds || []).length > 0,
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
    ) : monitors.length + monitorGroups.length === 0 ? (
      <div className="space-y-4" data-testid="guided-setup-no-monitors">
        <p className="text-sm text-gray-700">
          {translator.translateText(STATUS_PAGE_SETUP_COPY.noMonitors)}
        </p>
        <div className={ACTIONS_CLASS_NAME}>
          <AppLink
            to={routeOf(PageMap.MONITOR_GUIDED_SETUP)}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
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
        ) : chosenPage ? (
          existingPagesOffer
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
        {statusPage || chosenPage ? (
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
            <ErrorInSentence message={saveError} showWhereToLook={true} />
          </p>
        ) : (
          <></>
        )}
        <div className={ACTIONS_CLASS_NAME}>
          <Button
            title={pickButtonTitle}
            type={ButtonType.Submit}
            buttonStyle={ButtonStyleType.PRIMARY}
            isLoading={isSaving}
            dataTestId="guided-setup-create-status-page"
          />
          {switchPageButton}
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
      {/*
       * The page as a visitor reads it: its name, then each monitor. Its
       * name as the public page names itself, in its header and its tab:
       * its Page Title, else its name (#7467).
       */}
      <div
        className="rounded-lg border border-gray-200 bg-gray-50 p-4"
        data-testid="guided-setup-preview"
      >
        {/* A long name wraps inside the preview on a phone (#7252). */}
        <p
          className="break-words text-base font-semibold text-gray-900"
          data-testid="guided-setup-preview-name"
        >
          {statusPage ? getStatusPagePublicName(statusPage) : ""}
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
                    {translateRecordName(
                      translator,
                      StateListType.MonitorStatus,
                      monitor.statusName,
                    )}
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
      outcome: STATUS_PAGE_SETUP_COPY.pickOutcome,
      doneLine: statusPage
        ? getPickDoneLine({
            translator: translator,
            name: statusPage.name,
            monitorCount: shown.count,
            hasMonitorGroups: (shown.monitorGroupIds || []).length > 0,
          })
        : undefined,
      content: pickContent,
    },
    {
      ...progress[1]!,
      title: STATUS_PAGE_SETUP_COPY.reviewTitle,
      outcome: STATUS_PAGE_SETUP_COPY.reviewOutcome,
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
                <Pill
                  dataTestId={`guided-setup-extra-${extra.key}-plan`}
                  text={plan}
                  isUserContent={true}
                  tone={PillTone.Neutral}
                  isDotHidden={true}
                  className="ms-2"
                />
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
            setShown(NOTHING_SHOWN);
            setPicked([]);
            setPickedGroups([]);
            /*
             * Another page is asked for: a new one, with the project's
             * pages - the one just set up among them - one click away
             * (#7517). Someone who may not make one goes on with those.
             */
            setIsNewPage(mayCreate);
            choosePage("");
            StatusPageSetupApi.loadEditableStatusPages()
              .then((pages: Array<StatusPageSetupPage>) => {
                setExistingPages(pages);

                if (!mayCreate && pages[0]) {
                  choosePage(pages[0].id);
                }
              })
              .catch(() => {
                // The pages offered stay as they were.
              });
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
      runSync={runSync}
      onRetryRunSync={() => {
        store.retry();
      }}
      steps={steps}
      openStepKey={openStepKey}
      onOpenStep={(key: string) => {
        setSaveError("");
        setOpenStepKey(key);
      }}
      summary={summary}
      isFinished={isStatusPageSetupFinished(facts)}
      guideDocsPath={STATUS_PAGE_SETUP_GUIDE_DOCS_PATH}
      minutes={WELCOME_STEP_MINUTES[WelcomeStep.StatusPage]}
      describeItPrompt={getDescribeItPrompt({
        setup: STATUS_PAGE_SETUP,
        facts: { name: isNewPage ? name : "" },
        translator: translator,
      })}
    />
  );
};

export default StatusPageGuidedSetup;
