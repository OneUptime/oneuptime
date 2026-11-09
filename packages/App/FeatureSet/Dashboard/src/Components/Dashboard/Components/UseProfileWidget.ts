import { useMemo } from "react";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import Service from "Common/Models/DatabaseModels/Service";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  readProfileWidgetKind,
  readProfileWidgetServiceId,
} from "Common/Utils/Dashboard/Components/DashboardProfileWidgetShared";
import {
  ProfileCategory,
  ProfileTypeActivity,
} from "Common/Utils/Profiles/ProfileTypes";
import {
  ProfileKindChoice,
  getProfileKindChoices,
  resolveProfileKind,
} from "../../../Utils/ProfilesView";
import { fetchProfileTypes } from "../../Profiles/ProfilesApi";
import useProfileRequest, {
  ProfileRequestState,
} from "../../Profiles/UseProfileRequest";
import DashboardResourceList from "../Utils/DashboardResourceList";
import {
  ProfileWidgetScope,
  ProfileWidgetWindow,
  getProfileWidgetScope,
  getProfileWidgetScopeKey,
  getProfileWidgetServiceNames,
  getProfileWidgetServicesKey,
  getProfileWidgetWindow,
} from "./ProfileWidgetData";

/*
 * WHAT A PROFILE WIDGET IS LOOKING AT.
 *
 * Shared by the Flame Graph and Top Functions widgets, and read the way the
 * Profiler reads its scope bar: a window, the services, and a kind of
 * profile resolved against the raw types those services sent in that
 * window - all in one unit (getProfileKindChoices), so a sum never adds
 * eBPF sample counts to nanoseconds. Each widget then makes its own read
 * with `readKey`, which is null while there is nothing to read.
 *
 * Every answer is kept with what it was read for. A refresh keeps what is
 * drawn until the new answer lands; a new service or kind never draws the
 * old one's answer, even for a moment.
 *
 * Nothing is read on a public dashboard: it serves no profiles, and each
 * widget says so in its place.
 */

export interface ProfileWidgetState {
  isPublic: boolean;
  // Null when the dashboard's range is no window (an end before its start).
  window: ProfileWidgetWindow | null;
  scope: ProfileWidgetScope;
  // The services the dashboard's service variable picks, by name.
  variableServiceNames: Array<string> | null;
  // The kind as the settings name it, and as this scope reads it.
  category: ProfileCategory;
  kind: ProfileKindChoice;
  // The scope has profiles of this kind in the window.
  hasData: boolean;
  // Still finding the services or the kinds, with nothing to draw yet.
  isLoading: boolean;
  error: string;
  retry: () => void;
  /*
   * A key for the widget's own read, changing with everything that read
   * depends on - a refresh included - and null while there is nothing to
   * read.
   */
  readKey: string | null;
  /*
   * What the widget's answer is about - the services and the kind, not
   * the window or the refresh - so a widget can tell an answer it may keep
   * drawing while it reads again from one about something else.
   */
  contentKey: string;
}

// An answer, kept with what it was read for.
export interface ProfileWidgetAnswer<T> {
  forKey: string;
  value: T;
}

// The ids of the services with these names, in the reader's project.
async function fetchServiceIdsByName(
  names: Array<string>,
): Promise<Array<string>> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<Service> = await ModelAPI.getList<Service>({
    modelType: Service,
    query: {
      ...(projectId ? { projectId: projectId } : {}),
      name: new Includes(names),
    } as Query<Service>,
    limit: 50,
    skip: 0,
    select: { _id: true, name: true },
    sort: {},
  });

  return result.data
    .map((service: Service): string => {
      return service.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

export interface UseProfileWidgetProps {
  serviceId: unknown;
  profileKind: unknown;
  dashboardStartAndEndDate: RangeStartAndEndDateTime;
  variables?: Array<DashboardVariable> | undefined;
  refreshTick?: number | undefined;
}

const useProfileWidget: (props: UseProfileWidgetProps) => ProfileWidgetState =
  (props: UseProfileWidgetProps): ProfileWidgetState => {
    const isPublic: boolean = DashboardResourceList.isPublic();
    const refreshTick: number = props.refreshTick || 0;

    /*
     * A preset range ("Past 1 hour") ends now: it is worked out again when
     * the range or the refresh tick changes, never on a render of its own,
     * so a re-render does not move the window and read again.
     */
    const rangeKey: string = JSON.stringify(props.dashboardStartAndEndDate);

    const window: ProfileWidgetWindow | null = useMemo(() => {
      const range: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(
          props.dashboardStartAndEndDate,
        );

      return getProfileWidgetWindow({
        startTime: range.startValue,
        endTime: range.endValue,
      });
    }, [rangeKey, refreshTick]);

    const pinnedServiceId: string | null = readProfileWidgetServiceId(
      props.serviceId,
    );

    const variablesKey: string = JSON.stringify(props.variables || []);

    const pickedNames: Array<string> | null = useMemo(() => {
      return isPublic ? null : getProfileWidgetServiceNames(props.variables);
    }, [variablesKey, isPublic]);

    // The services the picked names are, when the widget follows them.
    const followsVariable: boolean = !pinnedServiceId && pickedNames !== null;
    const namesKey: string = (pickedNames || []).join("\u0000");

    const variableServices: ProfileRequestState<
      ProfileWidgetAnswer<Array<string>>
    > = useProfileRequest<ProfileWidgetAnswer<Array<string>>>(
      followsVariable ? `services|${namesKey}|${refreshTick}` : null,
      async (): Promise<ProfileWidgetAnswer<Array<string>>> => {
        return {
          forKey: namesKey,
          value: await fetchServiceIdsByName(pickedNames || []),
        };
      },
    );

    const variableServiceIds: Array<string> | null =
      variableServices.data && variableServices.data.forKey === namesKey
        ? variableServices.data.value
        : null;

    const scope: ProfileWidgetScope = getProfileWidgetScope({
      pinnedServiceId,
      variableServiceNames: pickedNames,
      variableServiceIds,
    });

    const isScopeKnown: boolean =
      !followsVariable || variableServiceIds !== null;
    const hasServices: boolean =
      scope.serviceIds === undefined || scope.serviceIds.length > 0;

    const servicesKey: string = getProfileWidgetServicesKey(scope.serviceIds);

    const scopeKey: string | null =
      window && isScopeKnown
        ? `${getProfileWidgetScopeKey({ window, serviceIds: scope.serviceIds })}|${refreshTick}`
        : null;

    const needsKinds: boolean = !isPublic && scopeKey !== null && hasServices;

    // The kinds the scope has data for in the window.
    const types: ProfileRequestState<
      ProfileWidgetAnswer<Array<ProfileTypeActivity>>
    > = useProfileRequest<ProfileWidgetAnswer<Array<ProfileTypeActivity>>>(
      needsKinds ? `types|${scopeKey}` : null,
      async (): Promise<ProfileWidgetAnswer<Array<ProfileTypeActivity>>> => {
        return {
          forKey: servicesKey,
          value: await fetchProfileTypes({
            window: {
              startTime: window!.startTime,
              endTime: window!.endTime,
            },
            serviceIds: scope.serviceIds,
          }),
        };
      },
    );

    // An answer about other services is never this scope's.
    const activity: Array<ProfileTypeActivity> | null =
      needsKinds && types.data && types.data.forKey === servicesKey
        ? types.data.value
        : null;

    const category: ProfileCategory = readProfileWidgetKind(
      props.profileKind,
    );

    const kind: ProfileKindChoice = useMemo(() => {
      return resolveProfileKind({
        selection: category,
        choices: getProfileKindChoices(activity || []),
      });
    }, [category, activity]);

    const hasData: boolean = activity !== null && kind.sampleCount > 0;

    const error: string = followsVariable
      ? variableServices.error || types.error
      : types.error;

    const isLoading: boolean =
      !isPublic &&
      window !== null &&
      !error &&
      (!isScopeKnown || (needsKinds && activity === null));

    const retry: () => void = (): void => {
      if (variableServices.error) {
        variableServices.reload();
        return;
      }

      types.reload();
    };

    const contentKey: string = `${servicesKey}|${kind.selection}|${kind.queryTypes.join(",")}`;

    const readKey: string | null =
      scopeKey && hasData ? `${scopeKey}|${contentKey}` : null;

    return {
      isPublic,
      window,
      scope,
      variableServiceNames: pickedNames,
      category,
      kind,
      hasData,
      isLoading,
      error,
      retry,
      readKey,
      contentKey,
    };
  };

export default useProfileWidget;
