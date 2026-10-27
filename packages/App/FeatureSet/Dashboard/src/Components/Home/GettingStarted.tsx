import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Dictionary from "Common/Types/Dictionary";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
} from "Common/UI/Utils/PermissionGate";
import UiAnalytics from "Common/UI/Utils/Analytics";
import useTranslateValue from "Common/UI/Utils/Translation";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import HowOneUptimeWorks from "./HowOneUptimeWorks";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

export interface ComponentProps {
  projectId: ObjectID;
  // Passed to the card, e.g. to drop its margin inside a spaced layout.
  className?: string | undefined;
}

interface GettingStartedTask {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  iconBackgroundClassName: string;
  pageMap: PageMap;
  /*
   * A page of its own that creates what the step asks for. Only someone who
   * may create that model is sent there: a create form they cannot submit
   * would only fail at the end (issue #3306). Everyone else lands on
   * `pageMap`, whose create button is shown disabled, with the reason.
   */
  createPage?:
    | {
        pageMap: PageMap;
        modelType: { new (): PermissionCheckableModel };
      }
    | undefined;
  isComplete: (projectId: ObjectID) => Promise<boolean>;
}

type GetTaskPageMapFunction = (task: GettingStartedTask) => PageMap;

const getTaskPageMap: GetTaskPageMapFunction = (
  task: GettingStartedTask,
): PageMap => {
  if (
    task.createPage &&
    PermissionGate.check(new task.createPage.modelType(), ModelAction.Create)
      .isAllowed
  ) {
    return task.createPage.pageMap;
  }

  return task.pageMap;
};

const gettingStartedTasks: Array<GettingStartedTask> = [
  {
    key: "create-monitor",
    title: "Create your first monitor",
    description:
      "Monitor websites, APIs, servers and more — get notified the moment something goes down.",
    icon: IconProp.AltGlobe,
    iconBackgroundClassName: "bg-indigo-500",
    pageMap: PageMap.MONITORS,
    // The step says "create", so it opens the form, not the (empty) list.
    createPage: {
      pageMap: PageMap.MONITOR_CREATE,
      modelType: Monitor,
    },
    isComplete: async (projectId: ObjectID): Promise<boolean> => {
      return (
        (await ModelAPI.count<Monitor>({
          modelType: Monitor,
          query: { projectId: projectId },
        })) > 0
      );
    },
  },
  {
    key: "create-status-page",
    title: "Publish a status page",
    description:
      "Keep customers in the loop with a public status page for uptime, incidents and maintenance.",
    icon: IconProp.CheckCircle,
    iconBackgroundClassName: "bg-emerald-500",
    pageMap: PageMap.STATUS_PAGES,
    isComplete: async (projectId: ObjectID): Promise<boolean> => {
      return (
        (await ModelAPI.count<StatusPage>({
          modelType: StatusPage,
          query: { projectId: projectId },
        })) > 0
      );
    },
  },
  {
    key: "invite-team",
    title: "Invite your team",
    description:
      "Bring teammates on board so the right people can respond when something breaks.",
    icon: IconProp.Team,
    iconBackgroundClassName: "bg-amber-500",
    /*
     * Users, not Teams: the Teams page lists the three built-in teams and
     * offers "Create Team", with no way to invite anyone. "Invite User" is on
     * the Users page.
     */
    pageMap: PageMap.USERS,
    isComplete: async (projectId: ObjectID): Promise<boolean> => {
      // every project starts with its creator as the first team member.
      return (
        (await ModelAPI.count<TeamMember>({
          modelType: TeamMember,
          query: { projectId: projectId },
        })) > 1
      );
    },
  },
  {
    key: "create-on-call-policy",
    title: "Set up an on-call policy",
    /*
     * Says what happens until then, too: an incident or alert nobody owns
     * is emailed to the project's owners (the Owners workers), so a new
     * project's first monitor already reaches whoever made the project.
     */
    description:
      "Page the right person when an incident or alert opens. Until then, the project's owners get an email.",
    icon: IconProp.Call,
    iconBackgroundClassName: "bg-rose-500",
    pageMap: PageMap.ON_CALL_DUTY,
    isComplete: async (projectId: ObjectID): Promise<boolean> => {
      return (
        (await ModelAPI.count<OnCallDutyPolicy>({
          modelType: OnCallDutyPolicy,
          query: { projectId: projectId },
        })) > 0
      );
    },
  },
];

type GetDismissKeyFunction = (projectId: ObjectID) => string;

const getDismissKey: GetDismissKeyFunction = (projectId: ObjectID): string => {
  return `getting-started-dismissed-${projectId.toString()}`;
};

type GetCompleteKeyFunction = (projectId: ObjectID) => string;

const getCompleteKey: GetCompleteKeyFunction = (
  projectId: ObjectID,
): string => {
  return `getting-started-complete-${projectId.toString()}`;
};

const GettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  const [isDismissed, setIsDismissed] = useState<boolean>(
    Boolean(LocalStorage.getItem(getDismissKey(props.projectId))),
  );

  const [taskCompletion, setTaskCompletion] =
    useState<Dictionary<boolean> | null>(null);

  const fetchTaskCompletion: PromiseVoidFunction = async (): Promise<void> => {
    /*
     * Each step is checked on its own. One count that failed - a role that
     * may not read on-call policies, a request that did not come back - used
     * to hide the whole checklist, and every step that could be checked with
     * it. A step whose check failed is left out of this visit (it would only
     * lead somewhere the user may not go), and the checklist is a
     * progressive enhancement: it goes only when no step could be checked.
     */
    const results: Array<PromiseSettledResult<boolean>> =
      await Promise.allSettled(
        gettingStartedTasks.map((task: GettingStartedTask) => {
          return task.isComplete(props.projectId);
        }),
      );

    const completion: Dictionary<boolean> = {};

    gettingStartedTasks.forEach((task: GettingStartedTask, i: number) => {
      const result: PromiseSettledResult<boolean> | undefined = results[i];

      if (result && result.status === "fulfilled") {
        completion[task.key] = Boolean(result.value);
      }
    });

    if (Object.keys(completion).length === 0) {
      setTaskCompletion(null);
      return;
    }

    const isEveryTaskComplete: boolean = gettingStartedTasks.every(
      (task: GettingStartedTask) => {
        return completion[task.key] === true;
      },
    );

    if (isEveryTaskComplete) {
      /*
       * A finished checklist never renders again — remember that, so
       * future Home visits skip these count requests entirely. Only when
       * every step was checked: a step that could not be is not done.
       */
      LocalStorage.setItem(getCompleteKey(props.projectId), true);
    }

    setTaskCompletion(completion);
  };

  useEffect(() => {
    const dismissed: boolean = Boolean(
      LocalStorage.getItem(getDismissKey(props.projectId)),
    );

    setIsDismissed(dismissed);

    /*
     * A dismissed or already-completed checklist renders nothing, so bail
     * out BEFORE firing the four count requests — otherwise every Home
     * visit pays for a card that will never be shown.
     */
    if (
      dismissed ||
      Boolean(LocalStorage.getItem(getCompleteKey(props.projectId)))
    ) {
      return;
    }

    fetchTaskCompletion().catch(() => {
      // handled in fetchTaskCompletion.
    });
    /*
     * Keyed on the string VALUE, not the ObjectID instance: callers that
     * rebuild the id each render (identity churn) must not re-fire these
     * count requests.
     */
  }, [props.projectId.toString()]);

  if (isDismissed || !taskCompletion) {
    return <></>;
  }

  // The steps that could be checked this visit (fetchTaskCompletion).
  const shownTasks: Array<GettingStartedTask> = gettingStartedTasks.filter(
    (task: GettingStartedTask) => {
      return task.key in taskCompletion;
    },
  );

  const completedCount: number = shownTasks.filter(
    (task: GettingStartedTask) => {
      return taskCompletion[task.key];
    },
  ).length;

  if (completedCount === shownTasks.length) {
    return <></>;
  }

  const dismiss: () => void = (): void => {
    LocalStorage.setItem(getDismissKey(props.projectId), true);
    setIsDismissed(true);
    UiAnalytics.capture("dashboard/home/getting-started-dismissed", {
      projectId: props.projectId.toString(),
    });
  };

  return (
    <Card
      className={props.className}
      title="Welcome to OneUptime 👋"
      description="A few quick steps and your project will be up and running. Pick up where you left off anytime."
      rightElement={
        <Button
          title="Dismiss"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          onClick={dismiss}
          dataTestId="getting-started-dismiss"
        />
      }
    >
      <div data-testid="getting-started">
        <div className="mb-6 max-w-md">
          <ProgressBar
            count={completedCount}
            totalCount={shownTasks.length}
            suffix={tx("steps completed")}
            size={ProgressBarSize.Small}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shownTasks.map((task: GettingStartedTask) => {
            const isComplete: boolean = taskCompletion[task.key] || false;

            // Spans, not divs: a button may only hold phrasing content.
            const tileContent: ReactElement = (
              <>
                <span
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                    isComplete ? "bg-emerald-100" : task.iconBackgroundClassName
                  }`}
                >
                  <Icon
                    icon={isComplete ? IconProp.Check : task.icon}
                    className={`h-5 w-5 ${
                      isComplete ? "text-emerald-600" : "text-white"
                    }`}
                  />
                </span>
                <span className="block min-w-0 flex-1">
                  <span
                    className={`block text-sm font-medium ${
                      isComplete ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    {tx(task.title)}
                  </span>
                  <span className="mt-1 block text-sm text-gray-500">
                    {tx(task.description)}
                  </span>
                </span>
                {isComplete ? (
                  <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-emerald-600">
                    {tx("Done")}
                  </span>
                ) : (
                  /*
                   * Grey at rest, indigo on hover - on two elements: the dark
                   * theme paints any hovered group child that carries a
                   * text-gray-* class near-white, which would outrank the
                   * indigo on one element.
                   */
                  <span className="mt-0.5 flex-shrink-0 text-gray-400">
                    <Icon
                      icon={IconProp.ChevronRight}
                      className="h-5 w-5 transition group-hover:text-indigo-500"
                    />
                  </span>
                )}
              </>
            );

            // A done step is a record, not a way anywhere.
            if (isComplete) {
              return (
                <div
                  key={task.key}
                  data-testid={`getting-started-task-${task.key}`}
                  className="group flex items-start gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4 transition"
                >
                  {tileContent}
                </div>
              );
            }

            const goToTask: () => void = (): void => {
              UiAnalytics.capture("dashboard/home/getting-started-task", {
                projectId: props.projectId.toString(),
                task: task.key,
              });
              /*
               * Where to go is decided at the click, not at the first paint:
               * the permission snapshot that says whether the create form is
               * open to this user can arrive after it (getTaskPageMap).
               */
              Navigation.navigate(
                RouteUtil.populateRouteParams(
                  RouteMap[getTaskPageMap(task)] as Route,
                ),
              );
            };

            /*
             * A step to do is a button: Tab reaches it, and Enter or Space
             * opens it. It was a clickable box with role="button" that the
             * keyboard could neither reach nor press.
             */
            return (
              <button
                key={task.key}
                type="button"
                onClick={goToTask}
                data-testid={`getting-started-task-${task.key}`}
                className="group flex w-full items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 text-left transition hover:border-indigo-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                {tileContent}
              </button>
            );
          })}
        </div>
        {/*
         * The checklist says what to do; this says how the pieces connect.
         * It lives in the same card so it goes away with the checklist once
         * the project is set up (or the user dismisses it).
         */}
        <div className="mt-6">
          <HowOneUptimeWorks projectId={props.projectId.toString()} />
        </div>
      </div>
    </Card>
  );
};

export default GettingStarted;
