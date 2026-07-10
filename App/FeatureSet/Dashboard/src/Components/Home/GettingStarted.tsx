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
import UiAnalytics from "Common/UI/Utils/Analytics";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
}

interface GettingStartedTask {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  iconBackgroundClassName: string;
  pageMap: PageMap;
  isComplete: (projectId: ObjectID) => Promise<boolean>;
}

const gettingStartedTasks: Array<GettingStartedTask> = [
  {
    key: "create-monitor",
    title: "Create your first monitor",
    description:
      "Monitor websites, APIs, servers and more — get notified the moment something goes down.",
    icon: IconProp.AltGlobe,
    iconBackgroundClassName: "bg-indigo-500",
    pageMap: PageMap.MONITORS,
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
    pageMap: PageMap.TEAMS,
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
    description:
      "Route alerts and incidents to the right person at the right time.",
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

const GettingStarted: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isDismissed, setIsDismissed] = useState<boolean>(
    Boolean(LocalStorage.getItem(getDismissKey(props.projectId))),
  );

  const [taskCompletion, setTaskCompletion] =
    useState<Dictionary<boolean> | null>(null);

  const fetchTaskCompletion: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const results: Array<boolean> = await Promise.all(
        gettingStartedTasks.map((task: GettingStartedTask) => {
          return task.isComplete(props.projectId);
        }),
      );

      const completion: Dictionary<boolean> = {};

      gettingStartedTasks.forEach((task: GettingStartedTask, i: number) => {
        completion[task.key] = results[i] || false;
      });

      setTaskCompletion(completion);
    } catch {
      // the checklist is a progressive enhancement — hide it if we cannot load it.
      setTaskCompletion(null);
    }
  };

  useEffect(() => {
    setIsDismissed(
      Boolean(LocalStorage.getItem(getDismissKey(props.projectId))),
    );

    fetchTaskCompletion().catch(() => {
      // handled in fetchTaskCompletion.
    });
  }, [props.projectId]);

  if (isDismissed || !taskCompletion) {
    return <></>;
  }

  const completedCount: number = gettingStartedTasks.filter(
    (task: GettingStartedTask) => {
      return taskCompletion[task.key];
    },
  ).length;

  if (completedCount === gettingStartedTasks.length) {
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
            totalCount={gettingStartedTasks.length}
            suffix="steps completed"
            size={ProgressBarSize.Small}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {gettingStartedTasks.map((task: GettingStartedTask) => {
            const isComplete: boolean = taskCompletion[task.key] || false;

            const goToTask: () => void = (): void => {
              if (isComplete) {
                return;
              }
              UiAnalytics.capture("dashboard/home/getting-started-task", {
                projectId: props.projectId.toString(),
                task: task.key,
              });
              Navigation.navigate(
                RouteUtil.populateRouteParams(RouteMap[task.pageMap] as Route),
              );
            };

            return (
              <div
                key={task.key}
                onClick={goToTask}
                role={isComplete ? undefined : "button"}
                data-testid={`getting-started-task-${task.key}`}
                className={`group flex items-start gap-4 rounded-lg border p-4 transition ${
                  isComplete
                    ? "border-gray-200 bg-gray-50"
                    : "cursor-pointer border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md"
                }`}
              >
                <div
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
                </div>
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium ${
                      isComplete ? "text-gray-500" : "text-gray-900"
                    }`}
                  >
                    {task.title}
                  </div>
                  <div className="mt-1 text-sm text-gray-500">
                    {task.description}
                  </div>
                </div>
                {isComplete ? (
                  <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-emerald-600">
                    Done
                  </span>
                ) : (
                  <Icon
                    icon={IconProp.ChevronRight}
                    className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400 transition group-hover:text-indigo-500"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
};

export default GettingStarted;
