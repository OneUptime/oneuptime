import {
  DashboardPlaylistDashboard,
  isSameDashboardId,
} from "Common/Types/Dashboard/DashboardPlaylist";
import {
  DurationTextPart,
  formatDurationText,
  getDateLocale,
  isEnglishDateLanguage,
} from "Common/Types/DateLanguage";
import {
  PluralTemplate,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the playlist pages and the player make of a playlist's dashboards
 * (issue #5235), as plain functions: React-free, so App's tests and the
 * Common component tests read the same rules.
 */

/*
 * A dashboard of the playlist as the viewer may read it: its id, its name,
 * and whether it is archived - an archived one is listed, and skipped.
 */
export interface PlaylistReadableDashboard {
  id: string;
  name: string;
  isArchived?: boolean | undefined;
}

/*
 * One turn of the rotation: a dashboard of the playlist the viewer may read,
 * at its place in the list. `key` tells two turns of the same dashboard
 * apart (one may appear more than once) and stays the same while the list
 * around it does not change.
 */
export interface PlaylistEntry {
  key: string;
  dashboardId: string;
  name: string;
}

/*
 * A stored entry as the pages show it: the dashboard's name when the viewer
 * may read it, or none - deleted, or out of their reach - and whether it is
 * archived. The player skips all but the named ones that are not archived.
 */
export interface PlaylistListedDashboard {
  key: string;
  dashboardId: string;
  name: string | null;
  isArchived: boolean;
}

function findReadable(
  readable: ReadonlyArray<PlaylistReadableDashboard>,
  dashboardId: string,
): PlaylistReadableDashboard | undefined {
  return readable.find((dashboard: PlaylistReadableDashboard): boolean => {
    return isSameDashboardId(dashboard.id, dashboardId);
  });
}

function getEntryKey(index: number, dashboardId: string): string {
  return `${index}-${dashboardId.toLowerCase()}`;
}

// The ids to read, each once, in the order they first appear.
export function getPlaylistDashboardIds(
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
): Array<string> {
  const ids: Array<string> = [];

  for (const dashboard of dashboards) {
    if (
      !ids.some((id: string): boolean => {
        return isSameDashboardId(id, dashboard.dashboardId);
      })
    ) {
      ids.push(dashboard.dashboardId);
    }
  }

  return ids;
}

/*
 * The rotation: the playlist's dashboards in its order, each that the
 * viewer may read and that is not archived, as often as the playlist names
 * it. The others are skipped.
 */
export function getPlaylistEntries(data: {
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>;
  readable: ReadonlyArray<PlaylistReadableDashboard>;
}): Array<PlaylistEntry> {
  const entries: Array<PlaylistEntry> = [];

  data.dashboards.forEach(
    (dashboard: DashboardPlaylistDashboard, index: number): void => {
      const found: PlaylistReadableDashboard | undefined = findReadable(
        data.readable,
        dashboard.dashboardId,
      );

      if (found && !found.isArchived) {
        entries.push({
          key: getEntryKey(index, dashboard.dashboardId),
          dashboardId: found.id,
          name: found.name,
        });
      }
    },
  );

  return entries;
}

// Every stored entry, named when the viewer may read it.
export function getPlaylistListedDashboards(data: {
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>;
  readable: ReadonlyArray<PlaylistReadableDashboard>;
}): Array<PlaylistListedDashboard> {
  return data.dashboards.map(
    (
      dashboard: DashboardPlaylistDashboard,
      index: number,
    ): PlaylistListedDashboard => {
      const found: PlaylistReadableDashboard | undefined = findReadable(
        data.readable,
        dashboard.dashboardId,
      );

      return {
        key: getEntryKey(index, dashboard.dashboardId),
        dashboardId: dashboard.dashboardId,
        name: found ? found.name : null,
        isArchived: Boolean(found && found.isArchived),
      };
    },
  );
}

// The list with the entry at `from` moved to `to`, both from 0.
export function movePlaylistDashboard(
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
  from: number,
  to: number,
): Array<DashboardPlaylistDashboard> {
  const list: Array<DashboardPlaylistDashboard> = [...dashboards];

  if (
    from < 0 ||
    from >= list.length ||
    to < 0 ||
    to >= list.length ||
    from === to
  ) {
    return list;
  }

  const [moved] = list.splice(from, 1);

  if (moved) {
    list.splice(to, 0, moved);
  }

  return list;
}

// The list without the entry at `index`.
export function removePlaylistDashboard(
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
  index: number,
): Array<DashboardPlaylistDashboard> {
  return dashboards.filter(
    (_dashboard: DashboardPlaylistDashboard, position: number): boolean => {
      return position !== index;
    },
  );
}

// The list with a dashboard added at its end.
export function addPlaylistDashboard(
  dashboards: ReadonlyArray<DashboardPlaylistDashboard>,
  dashboardId: string,
): Array<DashboardPlaylistDashboard> {
  return [...dashboards, { dashboardId: dashboardId }];
}

const SECONDS_PER_MINUTE: number = 60;
const SECONDS_PER_HOUR: number = 60 * SECONDS_PER_MINUTE;

// An interval's units: 90 seconds is 1 minute and 30 seconds.
export function getPlaylistIntervalParts(
  seconds: number,
): Array<DurationTextPart> {
  const whole: number = Math.max(0, Math.round(seconds));
  const hours: number = Math.floor(whole / SECONDS_PER_HOUR);
  const minutes: number = Math.floor(
    (whole % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE,
  );
  const rest: number = whole % SECONDS_PER_MINUTE;
  const parts: Array<DurationTextPart> = [];

  if (hours > 0) {
    parts.push({ count: hours, unit: "hour" });
  }

  if (minutes > 0) {
    parts.push({ count: minutes, unit: "minute" });
  }

  if (rest > 0 || parts.length === 0) {
    parts.push({ count: rest, unit: "second" });
  }

  return parts;
}

function writeEnglishPart(part: DurationTextPart): string {
  return `${part.count} ${part.unit}${part.count === 1 ? "" : "s"}`;
}

/*
 * How long each dashboard is shown, in words of the reader's language, from
 * the browser's own unit names: "1 minute", "1 Minute", "1 分钟", "30
 * seconds", "1 hour, 30 minutes". English, or an engine that cannot write
 * a unit, reads the English words.
 */
export function formatPlaylistInterval(
  seconds: number,
  language?: string | undefined,
): string {
  const parts: Array<DurationTextPart> = getPlaylistIntervalParts(seconds);
  const english: string = parts.map(writeEnglishPart).join(", ");

  if (isEnglishDateLanguage(language)) {
    return english;
  }

  return (
    formatDurationText({
      parts: parts,
      locale: getDateLocale(language),
      unitDisplay: "long",
      listStyle: "long",
    }) || english
  );
}

export const PLAYLIST_DASHBOARD_COUNT: PluralTemplate = {
  one: "{{count}} dashboard",
  other: "{{count}} dashboards",
};

export const PLAYLIST_SUMMARY: string = translationKey(
  "{{dashboards}}, {{interval}} each",
);

export const PLAYLIST_WITHOUT_DASHBOARDS: string =
  translationKey("No dashboards");

/*
 * A playlist's row in the Playlists list, in one phrase: how many dashboards
 * it plays and how long each is shown - "3 dashboards, 1 minute each" - or
 * "No dashboards" for one with none yet. One column instead of two, so the
 * list fits beside the side menu, in German too, without scrolling sideways.
 * The count and the time are written in the phrase's own language: English
 * while a language has no wording of it, its own once it has.
 */
export function getPlaylistSummary(data: {
  translator: Translator;
  dashboardCount: number;
  intervalInSeconds: number;
}): string {
  if (data.dashboardCount <= 0) {
    return (
      data.translator.translateText(PLAYLIST_WITHOUT_DASHBOARDS) ||
      PLAYLIST_WITHOUT_DASHBOARDS
    );
  }

  return data.translator.translateTemplate(PLAYLIST_SUMMARY, {
    dashboards: composedValue((sentence: Translator): string => {
      return sentence.translatePlural(
        PLAYLIST_DASHBOARD_COUNT,
        data.dashboardCount,
      );
    }),
    interval: composedValue((sentence: Translator): string => {
      return formatPlaylistInterval(data.intervalInSeconds, sentence.language);
    }),
  });
}
