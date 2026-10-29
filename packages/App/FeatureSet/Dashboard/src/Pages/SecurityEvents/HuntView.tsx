import PageComponentProps from "../PageComponentProps";
import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import HuntHeader from "../../Components/SecurityEvents/Hunts/HuntHeader";
import {
  DELETE_HUNT,
  DELETE_HUNT_CONFIRM,
  EDIT_HUNT_TITLE,
  HUNT_NOT_FOUND,
} from "../../Components/SecurityEvents/Hunts/HuntsCopy";
import {
  HUNT_FORM_STEPS,
  getHuntFormFields,
} from "../../Components/SecurityEvents/Hunts/HuntFormFields";
import {
  HuntSearchState,
  getHuntTimeRange,
  getHuntsRoute,
  isHuntSearchChanged,
} from "../../Components/SecurityEvents/Hunts/HuntsModel";
import SecurityEventsViewer from "../../Components/SecurityEvents/SecurityEventsViewer";
import {
  SECURITY_EVENTS_END_PARAM,
  SECURITY_EVENTS_RANGE_PARAM,
  SECURITY_EVENTS_START_PARAM,
} from "../../Components/SecurityEvents/SecurityEventsTimeRange";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import { JSONObject } from "Common/Types/JSON";
import Link from "Common/Types/Link";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityHuntRunWindow,
  readSecurityHuntFilters,
  securityHuntFiltersFromMap,
} from "Common/Types/SecurityEvent/SecurityHunt";
import TimeRange from "Common/Types/Time/TimeRange";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import ModelFormModal from "Common/UI/Components/ModelFormModal/ModelFormModal";
import { nameRecordInTrail } from "Common/UI/Components/Page/RecordNameInTrail";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * ONE HUNT: its search, opened. The hunt's header - what it is, how often
 * it runs, who it tells and what its runs found (HuntHeader) - over the
 * Events explorer searching what the hunt keeps, over the window it opens
 * on (or the one its address names: a notification opens the hunt on the
 * window its run read).
 *
 * The explorer is the hunt's editor: a change to its search or chips is a
 * change to the hunt, which the header offers to save or discard. Events
 * found here are kept on a case with Add to Case, naming the hunt.
 *
 * Inside the Security Events menu, Hunts lit; its crumb names the hunt once
 * it is read (nameRecordInTrail, as a watchlist's does).
 *
 * Each hunt draws afresh (keyed by its id): the toolbar's Hunts list opens
 * another hunt on this same route, and nothing of the one before - its
 * header, its explorer, a dialog - stays on screen while it is read.
 */
const SecurityHuntViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const huntId: ObjectID = Navigation.getLastParamAsObjectID();

  return <HuntOnPage key={huntId.toString()} huntId={huntId} />;
};

const HuntOnPage: FunctionComponent<{ huntId: ObjectID }> = (props: {
  huntId: ObjectID;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const huntId: ObjectID = props.huntId;
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  const [hunt, setHunt] = useState<SecurityHunt | null>(null);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  // The read failed (rather than finding no hunt): it may work again.
  const [canRetry, setCanRetry] = useState<boolean>(false);
  // Bumped to start the explorer afresh: after Discard, Edit, Show them.
  const [viewerVersion, setViewerVersion] = useState<number>(0);
  const [searchState, setSearchState] = useState<HuntSearchState | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const item: SecurityHunt | null = await ModelAPI.getItem<SecurityHunt>({
        modelType: SecurityHunt,
        id: huntId,
        select: {
          _id: true,
          name: true,
          description: true,
          searchQuery: true,
          filters: true,
          timeRange: true,
          schedule: true,
          nextRunAt: true,
          lastRunAt: true,
          lastRunError: true,
          lastFoundAt: true,
          lastFoundSinceAt: true,
          lastFoundEventCount: true,
          notifyUsers: {
            _id: true,
            name: true,
            email: true,
          },
          notifyTeams: {
            _id: true,
            name: true,
          },
        },
      });

      setHunt(item);
      setCanRetry(false);
      setError(
        item ? "" : translator.translateText(HUNT_NOT_FOUND) || HUNT_NOT_FOUND,
      );
    } catch (err) {
      setCanRetry(true);
      setError(API.getFriendlyMessage(err));
    }

    setIsLoaded(true);
  }, [huntId.toString()]);

  useEffect(() => {
    void load();
  }, [load]);

  // "Security Events > Events > Hunts > Encoded PowerShell", once it is read.
  const breadcrumbs: Array<Link> | null = useMemo(() => {
    return (
      nameRecordInTrail({
        links: getSecurityEventsBreadcrumbs(path),
        recordId: huntId.toString(),
        recordName: hunt?.name,
      }) || null
    );
  }, [path, huntId.toString(), hunt?.name]);

  usePageBreadcrumbLinks(hunt?.name ? breadcrumbs : null);

  /*
   * The explorer starts again from the hunt as it is kept: its address
   * forgets the search and chips it was changed to (and its page), so the
   * hunt's own are read; `window` names the window to show, else the
   * address keeps the one it has.
   */
  const restartExplorer: (window?: SecurityHuntRunWindow) => void = (
    window?: SecurityHuntRunWindow,
  ): void => {
    Navigation.setQueryString({
      search: null,
      filters: null,
      page: null,
      ...(window
        ? {
            [SECURITY_EVENTS_RANGE_PARAM]: TimeRange.CUSTOM,
            [SECURITY_EVENTS_START_PARAM]: new Date(
              window.startTime,
            ).toISOString(),
            [SECURITY_EVENTS_END_PARAM]: new Date(window.endTime).toISOString(),
          }
        : {}),
    });
    setSearchState(null);
    setViewerVersion((version: number): number => {
      return version + 1;
    });
  };

  const isChanged: boolean = Boolean(
    hunt &&
      searchState &&
      isHuntSearchChanged({
        savedSearch: hunt.searchQuery,
        savedFilters: hunt.filters,
        search: searchState.search,
        filters: searchState.filters,
      }),
  );

  const saveChanges: () => Promise<void> = async (): Promise<void> => {
    if (!searchState) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      await ModelAPI.updateById<SecurityHunt>({
        modelType: SecurityHunt,
        id: huntId,
        data: {
          searchQuery: searchState.search.trim(),
          filters: securityHuntFiltersFromMap(
            searchState.filters,
          ) as unknown as JSONObject,
        },
      });

      await load();
    } catch (err) {
      setSaveError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  if (!isLoaded) {
    return <ComponentLoader />;
  }

  if (error || !hunt) {
    return (
      <ErrorMessage
        message={error || HUNT_NOT_FOUND}
        onRefreshClick={
          canRetry
            ? () => {
                setIsLoaded(false);
                setError("");
                void load();
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <HuntHeader
        hunt={hunt}
        isChanged={isChanged}
        isSaving={isSaving}
        saveError={saveError}
        onSaveChanges={() => {
          void saveChanges();
        }}
        onDiscardChanges={() => {
          setSaveError("");
          restartExplorer();
        }}
        onEdit={() => {
          setIsEditing(true);
        }}
        onDelete={() => {
          setDeleteError("");
          setIsDeleting(true);
        }}
        onShowWindow={(window: SecurityHuntRunWindow) => {
          restartExplorer(window);
        }}
      />

      <SecurityEventsViewer
        key={`${hunt._id?.toString() || ""}-${viewerVersion}`}
        hunt={{
          id: huntId,
          searchQuery: hunt.searchQuery || "",
          filters: readSecurityHuntFilters(hunt.filters),
          timeRange: getHuntTimeRange(hunt.timeRange),
        }}
        onSearchStateChange={setSearchState}
      />

      {isEditing ? (
        <ModelFormModal<SecurityHunt>
          modelType={SecurityHunt}
          name="security-hunt-edit"
          title={EDIT_HUNT_TITLE}
          submitButtonText="Save Changes"
          modelIdToEdit={huntId}
          onClose={() => {
            setIsEditing(false);
          }}
          onSuccess={() => {
            setIsEditing(false);
            void load().then(() => {
              // Its search may have changed: the explorer reads it afresh.
              restartExplorer();
            });
          }}
          formProps={{
            name: "security-hunt-edit-form",
            modelType: SecurityHunt,
            id: "security-hunt-edit-form",
            formType: FormType.Update,
            steps: HUNT_FORM_STEPS,
            fields: getHuntFormFields({ translator }),
          }}
        />
      ) : (
        <></>
      )}

      {isDeleting ? (
        <ConfirmModal
          title={DELETE_HUNT}
          description={translator.translateTemplate(DELETE_HUNT_CONFIRM, {
            name: hunt.name || "",
          })}
          submitButtonText={DELETE_HUNT}
          submitButtonType={ButtonStyleType.DANGER}
          error={deleteError}
          onClose={() => {
            setIsDeleting(false);
          }}
          onSubmit={async () => {
            try {
              await ModelAPI.deleteItem<SecurityHunt>({
                modelType: SecurityHunt,
                id: huntId,
              });
              setIsDeleting(false);
              Navigation.navigate(getHuntsRoute());
            } catch (err) {
              setDeleteError(API.getFriendlyMessage(err));
            }
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SecurityHuntViewPage;
