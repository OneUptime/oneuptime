import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ModelForm, {
  FormType,
  ModelField,
} from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import Card from "Common/UI/Components/Card/Card";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Page from "Common/UI/Components/Page/Page";
import {
  ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM,
  ANNOUNCEMENT_TEMPLATE_QUERY_PARAM,
  AnnouncementFormKind,
  getInitialAnnouncementStatusPageIds,
  getStatusPageToReturnTo,
  readAnnouncementQueryId,
  readRecordIds,
} from "../../Components/Announcement/AnnouncementForm";
import {
  ANNOUNCEMENT_FORM_STEPS,
  getAnnouncementFormFields,
} from "../../Components/Announcement/AnnouncementFormFields";

/*
 * Two steps - Announcement and Status Pages - and the review step (see
 * Components/Announcement/AnnouncementForm for why, and
 * AnnouncementFormFields for the fields, which the announcement's Edit
 * shares).
 */
const AnnouncementCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * A template that could not be read. The form still opens - with the
   * status page it was opened from picked - and says why it is empty.
   */
  const [templateError, setTemplateError] = useState<string>("");

  const [initialValuesForAnnouncement, setInitialValuesForAnnouncement] =
    useState<JSONObject>({});

  /*
   * The status page whose Announcements tab the page was opened from, once
   * it is known to exist: it is picked on the form, and Create goes back to
   * its tab.
   */
  const [fromStatusPageId, setFromStatusPageId] = useState<string | null>(null);

  // The status pages the announcement was created on, read as it is sent.
  const createdStatusPageIds: MutableRefObject<Array<string>> = useRef<
    Array<string>
  >([]);

  const fields: Array<ModelField<StatusPageAnnouncement>> = useMemo(() => {
    return getAnnouncementFormFields(AnnouncementFormKind.Create);
  }, []);

  useEffect(() => {
    loadInitialValues({
      statusPageId: readAnnouncementQueryId(
        Navigation.getQueryStringByName(ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM),
      ),
      announcementTemplateId: readAnnouncementQueryId(
        Navigation.getQueryStringByName(ANNOUNCEMENT_TEMPLATE_QUERY_PARAM),
      ),
    });
  }, []);

  const loadInitialValues: (data: {
    statusPageId: string | null;
    announcementTemplateId: string | null;
  }) => Promise<void> = async (data: {
    statusPageId: string | null;
    announcementTemplateId: string | null;
  }): Promise<void> => {
    if (!data.statusPageId && !data.announcementTemplateId) {
      setIsLoading(false);
      return;
    }

    setError("");
    setTemplateError("");
    setIsLoading(true);

    try {
      const [statusPage, announcementTemplate]: [
        StatusPage | null,
        StatusPageAnnouncementTemplate | null,
      ] = await Promise.all([
        /*
         * The page only saves picking it: one that cannot be read leaves the
         * form as the project's list opens it, rather than in its way.
         */
        data.statusPageId
          ? ModelAPI.getItem<StatusPage>({
              modelType: StatusPage,
              id: new ObjectID(data.statusPageId),
              select: {
                _id: true,
                name: true,
              },
            }).catch((): null => {
              return null;
            })
          : Promise.resolve(null),
        data.announcementTemplateId
          ? ModelAPI.getItem<StatusPageAnnouncementTemplate>({
              modelType: StatusPageAnnouncementTemplate,
              id: new ObjectID(data.announcementTemplateId),
              select: {
                title: true,
                description: true,
                statusPages: true,
                monitors: true,
                shouldStatusPageSubscribersBeNotified: true,
              },
            }).catch((err: unknown): null => {
              setTemplateError(API.getFriendlyMessage(err));
              return null;
            })
          : Promise.resolve(null),
      ]);

      /*
       * A page that is gone, or not in this project, comes back without an
       * ID, and is not picked either.
       */
      const statusPageId: string | null = statusPage?.id?.toString() || null;

      let initialValue: JSONObject = {};

      if (announcementTemplate) {
        initialValue = {
          ...BaseModel.toJSONObject(
            announcementTemplate,
            StatusPageAnnouncementTemplate,
          ),
          monitors: announcementTemplate.monitors?.map((monitor: Monitor) => {
            return monitor.id!.toString();
          }),
        };
      }

      const statusPageIds: Array<string> = getInitialAnnouncementStatusPageIds({
        statusPageId: statusPageId,
        templateStatusPageIds: readRecordIds(announcementTemplate?.statusPages),
      });

      if (statusPageIds.length > 0) {
        initialValue["statusPages"] = statusPageIds;
      } else {
        delete initialValue["statusPages"];
      }

      setFromStatusPageId(statusPageId);
      setInitialValuesForAnnouncement(initialValue);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  /*
   * Opened from a status page, the trail goes back through that page's
   * Announcements tab, as the tab's own trail reads; otherwise through the
   * project's Announcements list. The last link is this page, which
   * Breadcrumbs draws as text, so the address keeps what it was opened with.
   */
  const breadcrumbLinks: Array<Link> = [
    {
      title: "Status Pages",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
    },
    ...(fromStatusPageId
      ? [
          {
            title: "View Status Page",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
              { modelId: fromStatusPageId },
            ),
          },
          {
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS] as Route,
              { modelId: fromStatusPageId },
            ),
          },
        ]
      : [
          {
            title: "Announcements",
            to: RouteUtil.populateRouteParams(
              RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
            ),
          },
        ]),
    {
      title: "Create Announcement",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.ANNOUNCEMENT_CREATE] as Route,
      ),
    },
  ];

  return (
    <Page title={"Create Announcement"} breadcrumbLinks={breadcrumbLinks}>
      <Card
        title="Create New Announcement"
        description={
          "Create a new announcement to keep your users informed about important updates, maintenance, or other news."
        }
        className="mb-10"
      >
        <div>
          {isLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isLoading && !error && templateError && (
            <div className="mb-5">
              <ErrorMessage message={templateError} />
            </div>
          )}
          {!isLoading && !error && (
            <ModelForm<StatusPageAnnouncement>
              modelType={StatusPageAnnouncement}
              initialValues={initialValuesForAnnouncement}
              name="Create New Announcement"
              id="create-announcement-form"
              steps={ANNOUNCEMENT_FORM_STEPS}
              fields={fields}
              onBeforeCreate={async (
                item: StatusPageAnnouncement,
              ): Promise<StatusPageAnnouncement> => {
                createdStatusPageIds.current = readRecordIds(item.statusPages);
                return item;
              }}
              onSuccess={(_createdItem: StatusPageAnnouncement) => {
                /*
                 * Back where Create was pressed: the status page's own
                 * Announcements tab - while the announcement still shows
                 * there - or the project's list.
                 */
                const returnTo: string | null = getStatusPageToReturnTo({
                  fromStatusPageId: fromStatusPageId,
                  createdStatusPageIds: createdStatusPageIds.current,
                });

                Navigation.navigate(
                  returnTo
                    ? RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                        ] as Route,
                        { modelId: returnTo },
                      )
                    : RouteUtil.populateRouteParams(
                        RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
                      ),
                );
              }}
              submitButtonText={"Create Announcement"}
              formType={FormType.Create}
              summary={{
                enabled: true,
              }}
            />
          )}
        </div>
      </Card>
    </Page>
  );
};

export default AnnouncementCreate;
