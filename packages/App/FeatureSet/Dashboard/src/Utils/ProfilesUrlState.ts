import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";

/*
 * WHAT THE PROFILER IS SHOWING, AS ITS ADDRESS.
 *
 * The Profiler keeps its whole view in the query string, so a view survives
 * a reload, can be shared, and can be opened from anywhere else in
 * OneUptime already pointed at the right thing - a slow trace's service at
 * the trace's time, a deploy's before and after, the function an AI
 * investigation cites, the evidence of a Code task:
 *
 *   serviceId    the service (or host, cluster, ...) whose profiles to read;
 *                absent: every profiled service
 *   profileType  a kind ("cpu", "memory", "wall", ...) or one raw type;
 *                absent: CPU time
 *   rangeMinutes one of the preset windows ending now; absent: the last hour
 *   startTime,   a window of its own (ISO timestamps), which wins over
 *   endTime      rangeMinutes
 *   compare      "previous" (the same length just before), "day" or "week"
 *                (the same time a day or a week earlier), or "change" (the
 *                same length before and after changeTime, a deploy's time)
 *   changeTime   with compare=change: when the deploy or change happened
 *   function,    the function whose panel is open, and its file
 *   file
 *
 * A default is written as nothing, so the plain address is the default
 * view. React-free, so App/Tests can pin it.
 */

export enum ProfilesCompareMode {
  Previous = "previous",
  Day = "day",
  Week = "week",
  Change = "change",
}

export interface ProfilesUrlState {
  serviceId?: string | undefined;
  profileType?: string | undefined;
  rangeMinutes?: number | undefined;
  startTime?: Date | undefined;
  endTime?: Date | undefined;
  compare?: ProfilesCompareMode | undefined;
  changeTime?: Date | undefined;
  functionName?: string | undefined;
  fileName?: string | undefined;
}

// The windows the Profiler offers, in minutes, shortest first.
export const PROFILES_RANGE_MINUTES: ReadonlyArray<number> = [
  15,
  60,
  6 * 60,
  24 * 60,
  7 * 24 * 60,
];

export const DEFAULT_PROFILES_RANGE_MINUTES: number = 60;

// A custom window is at most this long (the longest preset).
export const MAX_PROFILES_WINDOW_MINUTES: number = 7 * 24 * 60;

// Raw profile type names: letters, digits, "_", "-", "." and ":".
const PROFILE_TYPE_NAME_MAX_LENGTH: number = 64;

const QUERY_KEYS: {
  serviceId: string;
  profileType: string;
  rangeMinutes: string;
  startTime: string;
  endTime: string;
  compare: string;
  changeTime: string;
  functionName: string;
  fileName: string;
} = {
  serviceId: "serviceId",
  profileType: "profileType",
  rangeMinutes: "rangeMinutes",
  startTime: "startTime",
  endTime: "endTime",
  compare: "compare",
  changeTime: "changeTime",
  functionName: "function",
  fileName: "file",
};

// The longest function name or file the address carries.
const MAX_NAME_LENGTH: number = 1000;

function isProfileTypeName(value: string): boolean {
  if (value.length === 0 || value.length > PROFILE_TYPE_NAME_MAX_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isLetter: boolean =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit: boolean = code >= 48 && code <= 57;
    // "_", "-", ".", ":"
    const isMark: boolean =
      code === 95 || code === 45 || code === 46 || code === 58;

    if (!isLetter && !isDigit && !isMark) {
      return false;
    }
  }

  return true;
}

function readDate(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return isNaN(date.getTime()) ? undefined : date;
}

function readName(value: string | null): string | undefined {
  if (value === null || value.length === 0 || value.length > MAX_NAME_LENGTH) {
    return undefined;
  }

  return value;
}

/*
 * The view an address asks for. Anything that does not hold up - an id
 * that is not one, a window that ends before it starts or is too long, a
 * compare mode this build does not know - is read as its default.
 */
export function parseProfilesUrlState(
  getParam: (name: string) => string | null,
): ProfilesUrlState {
  const state: ProfilesUrlState = {};

  const serviceId: string | null = getParam(QUERY_KEYS.serviceId);

  if (serviceId && ObjectID.isValidUUID(serviceId)) {
    state.serviceId = serviceId;
  }

  const profileType: string | null = getParam(QUERY_KEYS.profileType);

  if (profileType && isProfileTypeName(profileType)) {
    state.profileType = profileType;
  }

  const rangeMinutes: number = Number(getParam(QUERY_KEYS.rangeMinutes));

  if (PROFILES_RANGE_MINUTES.includes(rangeMinutes)) {
    state.rangeMinutes = rangeMinutes;
  }

  const startTime: Date | undefined = readDate(getParam(QUERY_KEYS.startTime));
  const endTime: Date | undefined = readDate(getParam(QUERY_KEYS.endTime));

  if (
    startTime &&
    endTime &&
    startTime.getTime() < endTime.getTime() &&
    endTime.getTime() - startTime.getTime() <=
      MAX_PROFILES_WINDOW_MINUTES * 60 * 1000
  ) {
    state.startTime = startTime;
    state.endTime = endTime;
  }

  const compare: string | null = getParam(QUERY_KEYS.compare);

  if (
    compare &&
    (Object.values(ProfilesCompareMode) as Array<string>).includes(compare)
  ) {
    const mode: ProfilesCompareMode = compare as ProfilesCompareMode;

    if (mode === ProfilesCompareMode.Change) {
      const changeTime: Date | undefined = readDate(
        getParam(QUERY_KEYS.changeTime),
      );

      if (changeTime) {
        state.compare = mode;
        state.changeTime = changeTime;
      }
    } else {
      state.compare = mode;
    }
  }

  const functionName: string | undefined = readName(
    getParam(QUERY_KEYS.functionName),
  );

  if (functionName) {
    state.functionName = functionName;

    const fileName: string | undefined = readName(getParam(QUERY_KEYS.fileName));

    if (fileName) {
      state.fileName = fileName;
    }
  }

  return state;
}

/*
 * The query parameters of a view, a default written as nothing: every key
 * the Profiler owns is present, null when it is to be removed.
 */
export function getProfilesQueryParams(
  state: ProfilesUrlState,
): Record<string, string | null> {
  const hasWindow: boolean = Boolean(state.startTime && state.endTime);

  return {
    [QUERY_KEYS.serviceId]: state.serviceId || null,
    [QUERY_KEYS.profileType]:
      state.profileType && state.profileType !== "cpu"
        ? state.profileType
        : null,
    [QUERY_KEYS.rangeMinutes]:
      !hasWindow &&
      state.rangeMinutes &&
      state.rangeMinutes !== DEFAULT_PROFILES_RANGE_MINUTES
        ? String(state.rangeMinutes)
        : null,
    [QUERY_KEYS.startTime]: hasWindow ? state.startTime!.toISOString() : null,
    [QUERY_KEYS.endTime]: hasWindow ? state.endTime!.toISOString() : null,
    [QUERY_KEYS.compare]: state.compare || null,
    [QUERY_KEYS.changeTime]:
      state.compare === ProfilesCompareMode.Change && state.changeTime
        ? state.changeTime.toISOString()
        : null,
    [QUERY_KEYS.functionName]: state.functionName || null,
    [QUERY_KEYS.fileName]:
      state.functionName && state.fileName ? state.fileName : null,
  };
}

// The Profiler's address for a view.
export function buildProfilesRoute(state: ProfilesUrlState): Route {
  const base: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.PROFILES] as Route,
  );

  const search: URLSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(getProfilesQueryParams(state))) {
    if (value !== null) {
      search.set(key, value);
    }
  }

  const query: string = search.toString();

  return query ? new Route(`${base.toString()}?${query}`) : base;
}

/*
 * A view of one service's profiles around a moment - a slow trace, an
 * incident: the window from `before` minutes before it to `after` minutes
 * after it, never ending in the future.
 */
export function getProfilesWindowAround(data: {
  time: Date;
  beforeMinutes: number;
  afterMinutes: number;
  now: Date;
}): { startTime: Date; endTime: Date } {
  const startTime: Date = new Date(
    data.time.getTime() - data.beforeMinutes * 60 * 1000,
  );
  const endTime: Date = new Date(
    Math.min(
      data.now.getTime(),
      data.time.getTime() + data.afterMinutes * 60 * 1000,
    ),
  );

  return endTime.getTime() > startTime.getTime()
    ? { startTime, endTime }
    : { startTime, endTime: new Date(startTime.getTime() + 60 * 1000) };
}
