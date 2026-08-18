import LoadingRegion from "./LoadingRegion";
import Skeleton from "./Skeleton";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Content-shaped placeholders for each status page view.
 *
 * These stand in for the real content while it loads. They exist for two
 * reasons beyond looking nicer than a spinner:
 *
 *   1. They reserve roughly the height the real content will occupy, so the
 *      page does not collapse to nothing and then jerk back open when the data
 *      lands — and so the footer is never dragged up into the middle of the
 *      viewport.
 *   2. They tell the reader what is coming (a status banner, a list of
 *      resources, a list of events) instead of a bare bar that says nothing.
 */

const UPTIME_BAR_COUNT: number = 60;
const RESOURCE_ROW_COUNT: number = 4;
const EVENT_CARD_COUNT: number = 3;

const ResourceRow: FunctionComponent = (): ReactElement => {
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-40 sm:w-56" />
        <Skeleton className="h-4 w-16" />
      </div>
      {/*
       * The uptime bar strip is the tallest, most recognisable part of a
       * resource row, so mirroring it keeps the pre/post-load heights close.
       */}
      <div className="flex items-end gap-[2px] overflow-hidden">
        {Array.from({ length: UPTIME_BAR_COUNT }).map(
          (_value: unknown, index: number) => {
            return (
              <Skeleton
                key={index}
                className="h-8 flex-1 min-w-[3px] rounded-sm"
              />
            );
          },
        )}
      </div>
    </div>
  );
};

const ResourceGroupCard: FunctionComponent = (): ReactElement => {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-5 py-2 shadow-sm">
      {Array.from({ length: RESOURCE_ROW_COUNT }).map(
        (_value: unknown, index: number) => {
          return (
            <div
              key={index}
              className={index > 0 ? "border-t border-gray-100" : ""}
            >
              <ResourceRow />
            </div>
          );
        },
      )}
    </div>
  );
};

export const OverviewSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <LoadingRegion className="space-y-5">
      {/* Overall status banner */}
      <Skeleton className="h-20 w-full rounded-xl" />
      <ResourceGroupCard />
    </LoadingRegion>
  );
};

export const EventListSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <LoadingRegion className="space-y-5">
      {Array.from({ length: EVENT_CARD_COUNT }).map(
        (_value: unknown, index: number) => {
          return (
            <div
              key={index}
              className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-2/3" />
              <div className="space-y-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/6" />
              </div>
            </div>
          );
        },
      )}
    </LoadingRegion>
  );
};

export const EventDetailSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <LoadingRegion className="space-y-5">
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-6 w-3/5" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-10/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      </div>
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <Skeleton className="h-4 w-40" />
        <div className="space-y-3">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-8/12" />
        </div>
      </div>
    </LoadingRegion>
  );
};

/*
 * Shown while the status page's own branding is still being fetched, when we do
 * not yet know the logo, the navigation items or the footer links. It stands in
 * for the entire shell so the first paint has the same overall geometry as the
 * loaded page.
 */
export const ShellSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <LoadingRegion className="flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-5xl grow flex-col px-3 sm:px-5">
        <div className="mt-5 flex h-12 items-center justify-between">
          <Skeleton className="h-10 w-40" />
          <div className="hidden gap-4 md:flex">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <Skeleton className="mt-5 h-12 w-full rounded-lg" />
        <div className="mt-8 grow space-y-5">
          <Skeleton className="h-20 w-full rounded-xl" />
          <ResourceGroupCard />
        </div>
        <div className="flex justify-center py-6">
          <Skeleton className="h-4 w-52" />
        </div>
      </div>
    </LoadingRegion>
  );
};

/*
 * Suspense fallback for a lazily-loaded route. At this point we do not know
 * which page is coming, so this stays deliberately generic — it only has to
 * hold the page's shape and padding steady while the chunk downloads.
 */
export const RouteFallbackSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <div className="mt-3 w-full sm:mt-5">
      <LoadingRegion className="space-y-5">
        <Skeleton className="h-20 w-full rounded-xl" />
        <ResourceGroupCard />
      </LoadingRegion>
    </div>
  );
};

/*
 * Stands in for a settings card and its fields — the subscribe and manage
 * subscription pages.
 */
export const FormSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <LoadingRegion className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
      <div className="mt-6 space-y-5">
        {Array.from({ length: 3 }).map((_value: unknown, index: number) => {
          return (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end">
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </LoadingRegion>
  );
};
