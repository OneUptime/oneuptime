import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Navigation from "Common/UI/Utils/Navigation";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import Route from "Common/Types/API/Route";
import RumSessionReplayView from "Common/Models/DatabaseModels/RumSessionReplayView";
import UserElement from "../../../Components/User/User";
import User from "Common/Models/DatabaseModels/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import AppLink from "../../../Components/AppLink/AppLink";
import ProjectUser from "../../../Utils/ProjectUser";
import ProjectUtil from "Common/UI/Utils/Project";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * Who watched a real end user's screen, and for how long.
 *
 * Rows are written by the manifest endpoint before a single recorded byte is
 * served, and they are never editable or deletable from the UI - the whole
 * point of an access log is that the people it records cannot edit it.
 */

/*
 * settings-setup-10: the heartbeat floors watched time to 15-second
 * buckets, so a reviewer who watched 14 seconds of a customer's screen has
 * 0 on record. The old opened-only label claimed more than the data can
 * support; the honest reading of 0 is "less than one bucket".
 */
/*
 * Mirrors SESSION_REPLAY_WATCH_BUCKET_SECONDS in
 * Common/Server/Services/RumSessionReplayViewService.ts, which the browser
 * bundle cannot import. App/Tests/Dashboard/SessionReplaySettingsWiring.test.ts
 * pins the two together.
 */
export const SESSION_REPLAY_WATCH_BUCKET_SECONDS: number = 15;

export function describeSecondsWatched(
  secondsWatched: number | undefined | null,
): string {
  const seconds: number = secondsWatched ?? 0;

  if (seconds <= 0) {
    return `< ${SESSION_REPLAY_WATCH_BUCKET_SECONDS}s`;
  }

  return `${seconds}s`;
}
const RumApplicationSessionReplayAudit: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  // Route is ":id/session-replay-audit", so the model id is one from the end.
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  /*
   * The cast is unavoidable: rumApplicationId is a relation column and
   * Query<T> does not accept the bare foreign key. Pages/Rum/View/Clients.tsx
   * and Overview.tsx carry the same eslint-disable.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Query<RumSessionReplayView> = {
    rumApplicationId: modelId,
  } as any;

  return (
    <Fragment>
      <ModelTable<RumSessionReplayView>
        modelType={RumSessionReplayView}
        id="rum-session-replay-audit-table"
        userPreferencesKey="rum-session-replay-audit-table"
        name="RUM Application Session Replay Access Log"
        isDeleteable={false}
        isEditable={false}
        isCreateable={false}
        isViewable={false}
        showRefreshButton={true}
        query={query}
        sortBy="viewedAt"
        sortOrder={SortOrder.Descending}
        selectMoreFields={{ sessionId: true }}
        cardProps={{
          title: "Replay Access Log",
          description:
            "Every playback of a recording for this application, including who watched it and for how long. Written before any recorded data is served, and not editable by anyone.",
        }}
        noItemsMessage="No one has watched a recording for this application yet."
        filters={[
          /*
           * settings-setup-9: an Entity filter without filterEntityType and
           * filterDropdownField is skipped by BaseModelTable and rendered
           * as a label with no control, so "did person X watch any of our
           * users' screens?" could not be asked. Same wiring as the User
           * filter on Pages/Settings/RunnerView.tsx.
           */
          {
            field: { viewedByUser: true },
            title: "Viewed By",
            type: FieldType.Entity,
            filterEntityType: User,
            fetchFilterDropdownOptions: async (): Promise<
              Array<DropdownOption>
            > => {
              return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                ProjectUtil.getCurrentProjectId()!,
              );
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            field: { viewedAt: true },
            title: "Viewed At",
            type: FieldType.DateTime,
          },
          {
            field: { sessionId: true },
            title: "Session ID",
            type: FieldType.Text,
          },
        ]}
        columns={[
          {
            field: { viewedAt: true },
            title: "Viewed At",
            type: FieldType.DateTime,
          },
          {
            field: { viewedByUser: { name: true, email: true } },
            title: "Viewed By",
            type: FieldType.Element,
            getElement: (item: RumSessionReplayView): ReactElement => {
              if (item.viewedByUser) {
                return <UserElement user={item.viewedByUser as User} />;
              }

              /*
               * viewedByApiKeyId is stored without a relation so revoking a
               * key cannot erase what it read; there is nothing to join to,
               * so the cell says what happened rather than rendering blank.
               */
              if (item.viewedByApiKeyId) {
                return (
                  <span className="text-sm text-gray-600">
                    API key {item.viewedByApiKeyId.toString().slice(0, 8)}
                  </span>
                );
              }

              return <span className="text-sm text-gray-500">Unknown</span>;
            },
          },
          {
            field: { sessionId: true },
            title: "Session",
            type: FieldType.Element,
            getElement: (item: RumSessionReplayView): ReactElement => {
              if (!item.sessionId) {
                return <span className="text-sm text-gray-500">—</span>;
              }

              return (
                <AppLink
                  to={
                    RouteUtil.populateRouteParams(
                      RouteMap[
                        PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW
                      ] as Route,
                      { modelId: modelId, subModelId: item.sessionId },
                    ) as Route
                  }
                  className="font-mono text-sm text-indigo-600 hover:underline"
                >
                  {item.sessionId}
                </AppLink>
              );
            },
          },
          {
            field: { secondsWatched: true },
            title: "Watched",
            type: FieldType.Element,
            getElement: (item: RumSessionReplayView): ReactElement => {
              return (
                <span className="font-mono text-sm tabular-nums text-gray-900">
                  {describeSecondsWatched(item.secondsWatched)}
                </span>
              );
            },
          },
          {
            field: { accessReason: true },
            title: "Reason",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: RumSessionReplayView): ReactElement => {
              /*
               * settings-setup-10: written by the manifest route from the
               * player's linked incident or exception, when there is one.
               * A plain open has none, and an empty cell read as a bug.
               */
              if (!item.accessReason || item.accessReason.trim().length === 0) {
                return (
                  <span className="text-xs text-gray-500">
                    None given (opened from the list)
                  </span>
                );
              }

              return (
                <span className="text-sm text-gray-700">
                  {item.accessReason}
                </span>
              );
            },
          },
          {
            field: { ipAddress: true },
            title: "Viewer IP",
            type: FieldType.Text,
            hideOnMobile: true,
          },
        ]}
      />
    </Fragment>
  );
};

export default RumApplicationSessionReplayAudit;
