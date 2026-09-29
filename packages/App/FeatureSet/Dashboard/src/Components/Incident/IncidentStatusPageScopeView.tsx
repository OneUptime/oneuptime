import Incident from "Common/Models/DatabaseModels/Incident";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import AppLink from "../AppLink/AppLink";
import StatusPagesElement from "../StatusPage/StatusPagesElement";
import IncidentStatusPageScopeCopy from "./IncidentStatusPageScopeCopy";
import { TranslatedScopeNotice } from "./IncidentStatusPageScopeNotices";
import { isScopedToDeletedStatusPages } from "./IncidentStatusPageScopeForm";

/*
 * An incident's status page scope, read only: the status pages it is limited
 * to, or that it is not limited at all - and, for an incident whose pages
 * have all been deleted, that it is hidden from every status page (the
 * scope is never recomputed when pages go, so it is limited to nothing).
 *
 * Given `statusPages`, it shows them. Given only the incident's id (the
 * overview, whose detail card already reads several lists), it reads the
 * pages itself, and only when the incident is scoped at all.
 */

export interface ComponentProps {
  isScopedToStatusPages: boolean | undefined;
  statusPages?: Array<StatusPage> | undefined;
  incidentId?: ObjectID | undefined;
  // Where the scope is edited, linked under it.
  editRoute?: Route | undefined;
}

const IncidentStatusPageScopeView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translate: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const shouldFetch: boolean =
    props.isScopedToStatusPages === true &&
    !props.statusPages &&
    Boolean(props.incidentId);

  const [fetchedStatusPages, setFetchedStatusPages] =
    useState<Array<StatusPage> | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!shouldFetch || !props.incidentId) {
      return;
    }

    let isCancelled: boolean = false;

    ModelAPI.getItem<Incident>({
      modelType: Incident,
      id: props.incidentId,
      select: {
        statusPages: {
          _id: true,
          name: true,
        },
      },
    })
      .then((incident: Incident | null) => {
        if (!isCancelled) {
          setFetchedStatusPages(incident?.statusPages || []);
        }
      })
      .catch((err: unknown) => {
        if (!isCancelled) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldFetch, props.incidentId?.toString()]);

  const editLink: ReactElement = props.editRoute ? (
    <AppLink
      to={props.editRoute}
      className="mt-1 inline-block text-xs font-medium text-indigo-600 hover:underline"
    >
      {translate(IncidentStatusPageScopeCopy.overviewEditLink)}
    </AppLink>
  ) : (
    <></>
  );

  if (props.isScopedToStatusPages !== true) {
    return (
      <div data-testid="incident-status-page-scope" data-state="unscoped">
        <p className="text-sm text-gray-500">
          {translate(IncidentStatusPageScopeCopy.noScopeSummary)}
        </p>
        {editLink}
      </div>
    );
  }

  const statusPages: Array<StatusPage> | null =
    props.statusPages || fetchedStatusPages;

  if (error) {
    return (
      <div data-testid="incident-status-page-scope" data-state="error">
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  if (!statusPages) {
    return (
      <div
        data-testid="incident-status-page-scope"
        data-state="loading"
        aria-busy="true"
        className="h-4 w-32 animate-pulse rounded bg-gray-100"
      />
    );
  }

  if (
    isScopedToDeletedStatusPages({
      isScopedToStatusPages: true,
      statusPages: statusPages,
    })
  ) {
    return (
      <div data-testid="incident-status-page-scope" data-state="deleted">
        <TranslatedScopeNotice
          text={IncidentStatusPageScopeCopy.scopedToDeletedPagesWarning}
          dataTestId="incident-scoped-to-deleted-pages"
        />
        {editLink}
      </div>
    );
  }

  return (
    <div data-testid="incident-status-page-scope" data-state="scoped">
      <StatusPagesElement statusPages={statusPages} />
      {editLink}
    </div>
  );
};

export default IncidentStatusPageScopeView;
