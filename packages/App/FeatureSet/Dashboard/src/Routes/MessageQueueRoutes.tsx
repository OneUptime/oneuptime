import ComponentProps from "../Pages/PageComponentProps";
import MessageQueueLayout from "../Pages/MessageQueue/Layout";
import MessageQueueViewLayout from "../Pages/MessageQueue/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, MessageQueueRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import MessageQueues from "../Pages/MessageQueue/MessageQueues";
import MessageQueueArchived from "../Pages/MessageQueue/Archived";
import MessageQueueProductDocumentation from "../Pages/MessageQueue/Documentation";
import MessageQueueLabelRules from "../Pages/MessageQueue/Settings/LabelRules";
import MessageQueueOwnerRules from "../Pages/MessageQueue/Settings/OwnerRules";
import MessageQueueOverview from "../Pages/MessageQueue/View/Overview";
import MessageQueueTraces from "../Pages/MessageQueue/View/Traces";
import MessageQueueMetrics from "../Pages/MessageQueue/View/Metrics";
import MessageQueueOwners from "../Pages/MessageQueue/View/Owners";
import MessageQueueSettings from "../Pages/MessageQueue/View/Settings";
import MessageQueueDocumentation from "../Pages/MessageQueue/View/Documentation";
import MessageQueueDelete from "../Pages/MessageQueue/View/Delete";
import MessageQueueLabelRule from "Common/Models/DatabaseModels/MessageQueueLabelRule";
import MessageQueueOwnerRule from "Common/Models/DatabaseModels/MessageQueueOwnerRule";
import MessageQueueModel from "Common/Models/DatabaseModels/MessageQueue";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

const MessageQueueRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<MessageQueueLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <MessageQueues
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUES] as Route}
            />
          }
        />
        <PageRoute
          path={
            MessageQueueRoutePath[PageMap.MESSAGE_QUEUES_DOCUMENTATION] || ""
          }
          element={
            <MessageQueueProductDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.MESSAGE_QUEUES_DOCUMENTATION] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            MessageQueueRoutePath[
              PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES
            ] || ""
          }
          element={
            <MessageQueueLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            MessageQueueRoutePath[
              PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW
            ] || ""
          }
          element={
            <MessageQueueLabelRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.MESSAGE_QUEUES_SETTINGS_LABEL_RULES_VIEW
                ] as Route
              }
              ruleViewModelType={MessageQueueLabelRule}
            />
          }
        />
        <PageRoute
          path={
            MessageQueueRoutePath[
              PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES
            ] || ""
          }
          element={
            <MessageQueueOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            MessageQueueRoutePath[
              PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW
            ] || ""
          }
          element={
            <MessageQueueOwnerRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.MESSAGE_QUEUES_SETTINGS_OWNER_RULES_VIEW
                ] as Route
              }
              ruleViewModelType={MessageQueueOwnerRule}
            />
          }
        />
        <PageRoute
          path={MessageQueueRoutePath[PageMap.MESSAGE_QUEUES_ARCHIVED] || ""}
          element={
            <MessageQueueArchived
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUES_ARCHIVED] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: MessageQueueModel,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.MESSAGE_QUEUE_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={MessageQueueRoutePath[PageMap.MESSAGE_QUEUE_VIEW] || ""}
        element={<MessageQueueViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <MessageQueueOverview
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MESSAGE_QUEUE_VIEW_TRACES)}
          element={
            <MessageQueueTraces
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MESSAGE_QUEUE_VIEW_METRICS)}
          element={
            <MessageQueueMetrics
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MESSAGE_QUEUE_VIEW_OWNERS)}
          element={
            <MessageQueueOwners
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MESSAGE_QUEUE_VIEW_SETTINGS,
          )}
          element={
            <MessageQueueSettings
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION,
          )}
          element={
            <MessageQueueDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.MESSAGE_QUEUE_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MESSAGE_QUEUE_VIEW_DELETE)}
          element={
            <MessageQueueDelete
              {...props}
              pageRoute={RouteMap[PageMap.MESSAGE_QUEUE_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: MessageQueueModel,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default MessageQueueRoutes;
