import { getMessageQueueBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import {
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  isMessageQueueFound,
} from "../Utils/MessageQueuePresentation";
import { MessageQueueViewOutletContext } from "../Utils/MessageQueueViewOutletContext";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * Every tab of one queue. Two things are the layout's:
 *
 *   - a queue that does not exist (deleted, or a mistyped id) says so on
 *     every tab. The API answers such an id with `{}`, an empty model rather
 *     than null, so the guard is the queue's identifier — every row has one,
 *     and every telemetry tab is scoped by the entity key built from it;
 *   - a rename in Settings refreshes the page header, which the ModelPage
 *     reads once (MessageQueueViewOutletContext).
 */
const MessageQueueViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [headerRefreshToken, setHeaderRefreshToken] = useState<number>(0);
  const [isMissing, setIsMissing] = useState<boolean>(false);

  useEffect(() => {
    let ignore: boolean = false;
    setIsMissing(false);
    ModelAPI.getItem<MessageQueue>({
      modelType: MessageQueue,
      id: modelId,
      select: { _id: true, queueIdentifier: true },
    })
      .then((item: MessageQueue | null): void => {
        if (!ignore) {
          setIsMissing(!isMessageQueueFound(item));
        }
      })
      .catch((): void => {
        // A failed lookup is not "missing": each tab reports its own error.
      });
    return (): void => {
      ignore = true;
    };
  }, [modelId.toString()]);

  const outletContext: MessageQueueViewOutletContext = useMemo(() => {
    return {
      refreshMessageQueueHeader: (): void => {
        setHeaderRefreshToken((token: number): number => {
          return token + 1;
        });
      },
    };
  }, []);

  return (
    <ModelPage
      title="Queue"
      modelType={MessageQueue}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getMessageQueueBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
      refreshToken={headerRefreshToken}
    >
      {isMissing ? (
        <ErrorMessage message={MESSAGE_QUEUE_NOT_FOUND_MESSAGE} />
      ) : (
        <Outlet context={outletContext} />
      )}
    </ModelPage>
  );
};

export default MessageQueueViewLayout;
