import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { Black } from "Common/Types/BrandColors";
import Exception from "Common/Types/Exception/Exception";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  EPISODE_MEMBERS_PREVIEW_LIMIT,
  EpisodeMemberPill,
  EpisodeMemberRow,
} from "./EpisodeMembers";
import RelativeTime from "./RelativeTime";

export interface ComponentProps<TMember extends BaseModel> {
  // Incident or Alert.
  modelType: { new (): TMember };
  episodeId: ObjectID;
  // The member's foreign key to its episode: "incidentEpisodeId" / "alertEpisodeId".
  episodeIdField: keyof TMember & string;
  select: Select<TMember>;
  // Newest first by this date: "declaredAt" for incidents, "createdAt" for alerts.
  sortField: keyof TMember & string;
  toRow: (member: TMember) => EpisodeMemberRow;
  title: string; // "Incidents in this episode"
  description?: string | undefined;
  singularNoun: string; // "incident"
  pluralNoun: string; // "incidents"
  // The full member list for this episode.
  viewAllRoute: Route;
  getMemberRoute: (memberId: ObjectID) => Route;
  // Bump to reload in place, e.g. after the episode state changed.
  refreshToken?: number | undefined;
  limit?: number | undefined;
}

interface LoadedMembers {
  episodeId: string;
  rows: Array<EpisodeMemberRow>;
  totalCount: number;
}

type PillFunction = (
  pill: EpisodeMemberPill,
  testId: string,
  tooltip: string,
) => ReactElement;

const getStatusPill: PillFunction = (
  pill: EpisodeMemberPill,
  testId: string,
  tooltip: string,
): ReactElement => {
  return (
    <span
      data-testid={testId}
      title={`${tooltip}: ${pill.name}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
        style={{ backgroundColor: (pill.color || Black).toString() }}
      />
      <span className="truncate">{pill.name}</span>
    </span>
  );
};

/*
 * The core of an episode is the set of incidents (or alerts) it groups, so
 * the overview previews the newest few with their state and severity instead
 * of only a count. Every row links to the member's own page; "View all" opens
 * the full member table.
 */
const EpisodeMembersCard: <TMember extends BaseModel>(
  props: ComponentProps<TMember>,
) => ReactElement = <TMember extends BaseModel>(
  props: ComponentProps<TMember>,
): ReactElement => {
  const episodeIdString: string = props.episodeId.toString();
  const limit: number = props.limit || EPISODE_MEMBERS_PREVIEW_LIMIT;

  const [loaded, setLoaded] = useState<LoadedMembers | null>(null);
  const [error, setError] = useState<string>("");

  // Only the latest request may write state; older responses are dropped.
  const requestIdRef: MutableRefObject<number> = useRef<number>(0);

  const loadMembers: () => Promise<void> = async (): Promise<void> => {
    const requestId: number = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const requestedEpisodeId: string = episodeIdString;

    try {
      const result: ListResult<TMember> = await ModelAPI.getList<TMember>({
        modelType: props.modelType,
        query: {
          [props.episodeIdField]: props.episodeId,
        } as unknown as Query<TMember>,
        limit: limit,
        skip: 0,
        select: props.select,
        sort: {
          [props.sortField]: SortOrder.Descending,
        } as Sort<TMember>,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      setLoaded({
        episodeId: requestedEpisodeId,
        rows: result.data.map((member: TMember): EpisodeMemberRow => {
          return props.toRow(member);
        }),
        totalCount: Math.max(result.count || 0, result.data.length),
      });
      setError("");
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setError(API.getFriendlyMessage(err as Exception));
    }
  };

  useEffect(() => {
    setError("");

    loadMembers().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });

    return () => {
      requestIdRef.current += 1;
    };
  }, [episodeIdString]);

  const lastRefreshTokenRef: MutableRefObject<number | undefined> = useRef<
    number | undefined
  >(props.refreshToken);

  useEffect(() => {
    if (lastRefreshTokenRef.current === props.refreshToken) {
      return;
    }

    lastRefreshTokenRef.current = props.refreshToken;

    loadMembers().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  }, [props.refreshToken]);

  // Rows from a previous episode are never shown for this one.
  const current: LoadedMembers | null =
    loaded && loaded.episodeId === episodeIdString ? loaded : null;

  const retry: () => void = (): void => {
    setError("");

    loadMembers().catch((err: unknown) => {
      setError(API.getFriendlyMessage(err as Exception));
    });
  };

  const countLabel: string | undefined = current
    ? `${current.totalCount} ${
        current.totalCount === 1 ? props.singularNoun : props.pluralNoun
      }`
    : undefined;

  const title: ReactElement = (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{props.title}</span>
      {countLabel && (
        <span
          data-testid="episode-members-count"
          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
        >
          {countLabel}
        </span>
      )}
    </span>
  );

  const viewAllLink: ReactElement = (
    <Link
      to={props.viewAllRoute}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
    >
      <span>View all {props.pluralNoun}</span>
      <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
    </Link>
  );

  const getBody: () => ReactElement = (): ReactElement => {
    if (error && !current) {
      return <ErrorMessage message={error} onRefreshClick={retry} />;
    }

    if (!current) {
      return (
        <div role="status" aria-live="polite">
          <span className="sr-only">Loading {props.pluralNoun}</span>
          <ul
            aria-hidden="true"
            data-testid="episode-members-skeleton"
            className="divide-y divide-gray-100 motion-safe:animate-pulse"
          >
            {[0, 1, 2].map((row: number) => {
              return (
                <li key={row} className="flex items-center gap-3 py-3">
                  <div className="h-5 w-12 flex-shrink-0 rounded-md bg-gray-100" />
                  <div className="h-4 min-w-0 flex-1 rounded bg-gray-200" />
                  <div className="hidden h-5 w-20 rounded-full bg-gray-100 sm:block" />
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    if (current.rows.length === 0) {
      return (
        <div
          data-testid="episode-members-empty"
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center"
        >
          <Icon icon={IconProp.Layers} className="h-6 w-6 text-gray-400" />
          <div className="mt-2 text-sm font-medium text-gray-900">
            No {props.pluralNoun} in this episode yet
          </div>
          <div className="mt-1 text-xs leading-5 text-gray-500">
            {`Matching ${props.pluralNoun} show up here as they are grouped into this episode.`}
          </div>
        </div>
      );
    }

    const hiddenCount: number = current.totalCount - current.rows.length;

    return (
      <div>
        {error && (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-100"
          >
            {`Couldn't refresh ${props.pluralNoun}: ${error}`}
          </div>
        )}
        <ul
          data-testid="episode-members-list"
          className="divide-y divide-gray-100"
        >
          {current.rows.map((row: EpisodeMemberRow) => {
            return (
              <li
                key={row.id}
                data-testid="episode-member-row"
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  {row.number && (
                    <span
                      data-testid="episode-member-number"
                      className="inline-flex flex-shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-gray-600"
                    >
                      {row.number}
                    </span>
                  )}
                  {row.id ? (
                    <Link
                      to={props.getMemberRoute(new ObjectID(row.id))}
                      title={row.title}
                      className="block min-w-0 truncate rounded-sm text-sm font-medium text-gray-900 hover:text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {row.title}
                    </Link>
                  ) : (
                    <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                      {row.title}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0 sm:justify-end">
                  {row.state &&
                    getStatusPill(row.state, "episode-member-state", "State")}
                  {row.severity &&
                    getStatusPill(
                      row.severity,
                      "episode-member-severity",
                      "Severity",
                    )}
                  {row.occurredAt && (
                    <RelativeTime
                      date={row.occurredAt}
                      className="whitespace-nowrap text-xs tabular-nums text-gray-500"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {hiddenCount > 0 && (
          <div className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
            {`Showing the newest ${current.rows.length} of ${current.totalCount} ${props.pluralNoun}.`}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card
      title={title}
      description={
        props.description ||
        `The newest ${props.pluralNoun} grouped into this episode, with their current state and severity.`
      }
      rightElement={viewAllLink}
    >
      {getBody()}
    </Card>
  );
};

export default EpisodeMembersCard;
