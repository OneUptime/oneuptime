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

/*
 * Who watched a real end user's screen, and for how long.
 *
 * Rows are written by the manifest endpoint before a single recorded byte is
 * served, and they are never editable or deletable from the UI - the whole
 * point of an access log is that the people it records cannot edit it.
 */
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
          {
            field: { viewedByUser: true },
            title: "Viewed By",
            type: FieldType.Entity,
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

              return <span className="text-sm text-gray-400">Unknown</span>;
            },
          },
          {
            field: { sessionId: true },
            title: "Session",
            type: FieldType.Element,
            getElement: (item: RumSessionReplayView): ReactElement => {
              if (!item.sessionId) {
                return <span className="text-sm text-gray-400">—</span>;
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
              const seconds: number = item.secondsWatched ?? 0;

              return (
                <span className="font-mono text-sm tabular-nums text-gray-900">
                  {seconds > 0 ? `${seconds}s` : "Opened only"}
                </span>
              );
            },
          },
          {
            field: { accessReason: true },
            title: "Reason",
            type: FieldType.Text,
            hideOnMobile: true,
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
