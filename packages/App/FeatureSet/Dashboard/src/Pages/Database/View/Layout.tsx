import { getDatabaseBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import {
  DATABASE_NOT_FOUND_MESSAGE,
  isDatabaseServerFound,
} from "../Utils/DatabaseServerPresentation";
import { DatabaseViewOutletContext } from "../Utils/DatabaseViewOutletContext";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * Every tab of one database. Two things are the layout's:
 *
 *   - a database that does not exist (deleted, or a mistyped id) says so
 *     on every tab. The API answers such an id with `{}`, which is an empty
 *     model rather than null, so the tabs used to render their tables and
 *     forms — and the Overview its setup buttons — for nothing;
 *   - a rename in Settings refreshes the page header, which the ModelPage
 *     reads once (DatabaseViewOutletContext).
 */
const DatabaseServerViewLayout: FunctionComponent<
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
    ModelAPI.getItem<DatabaseServer>({
      modelType: DatabaseServer,
      id: modelId,
      select: { _id: true },
    })
      .then((item: DatabaseServer | null): void => {
        if (!ignore) {
          setIsMissing(!isDatabaseServerFound(item));
        }
      })
      .catch((): void => {
        // A failed lookup is not "missing": each tab reports its own error.
      });
    return (): void => {
      ignore = true;
    };
  }, [modelId.toString()]);

  const outletContext: DatabaseViewOutletContext = useMemo(() => {
    return {
      refreshDatabaseHeader: (): void => {
        setHeaderRefreshToken((token: number): number => {
          return token + 1;
        });
      },
    };
  }, []);

  return (
    <ModelPage
      title="Database"
      modelType={DatabaseServer}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getDatabaseBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
      refreshToken={headerRefreshToken}
    >
      {isMissing ? (
        <ErrorMessage message={DATABASE_NOT_FOUND_MESSAGE} />
      ) : (
        <Outlet context={outletContext} />
      )}
    </ModelPage>
  );
};

export default DatabaseServerViewLayout;
