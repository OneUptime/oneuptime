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
  ANNOUNCEMENT_TEMPLATE_QUERY_PARAM,
  AnnouncementFormKind,
  getStatusPageToReturnTo,
  readAnnouncementQueryId,
  readRecordIds,
} from "../../Components/Announcement/AnnouncementForm";
import {
  CreatedRecordKind,
  pickRecordToCreateFrom,
} from "../../Components/CreateFromRecord/CreateFromRecord";
import useRecordToCreateFrom, {
  RecordToCreateFromState,
} from "../../Components/CreateFromRecord/useRecordToCreateFrom";
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

  // What the template picked in "Create from Template" fills in.
  const [initialValuesForAnnouncement, setInitialValuesForAnnouncement] =
    useState<JSONObject>({});

  /*
   * The status page whose Announcements tab the page was opened from
   * (?statusPageId=), once it is known to exist and the viewer can read it:
   * it is picked on the form, ahead of the template's pages, the trail goes
   * back through its tab, and Create goes back there. A page that cannot be
   * read leaves the form as the project's list opens it, rather than in its
   * way (Components/CreateFromRecord).
   */
  const recordToCreateFrom: RecordToCreateFromState = useRecordToCreateFrom(
    CreatedRecordKind.Announcement,
  );

  const fromStatusPageId: string | null = recordToCreateFrom.record?.id || null;

  // The status pages the announcement was created on, read as it is sent.
  const createdStatusPageIds: MutableRefObject<Array<string>> = useRef<
    Array<string>
  >([]);

  const fields: Array<ModelField<StatusPageAnnouncement>> = useMemo(() => {
    return getAnnouncementFormFields(AnnouncementFormKind.Create);
  }, []);

  useEffect(() => {
    loadTemplate(
      readAnnouncementQueryId(
        Navigation.getQueryStringByName(ANNOUNCEMENT_TEMPLATE_QUERY_PARAM),
      ),
    );
  }, []);

  const loadTemplate: (
    announcementTemplateId: string | null,
  ) => Promise<void> = async (
    announcementTemplateId: string | null,
  ): Promise<void> => {
    if (!announcementTemplateId) {
      setIsLoading(false);
      return;
    }

    setError("");
    setTemplateError("");
    setIsLoading(true);

    try {
      const announcementTemplate: StatusPageAnnouncementTemplate | null =
        await ModelAPI.getItem<StatusPageAnnouncementTemplate>({
          modelType: StatusPageAnnouncementTemplate,
          id: new ObjectID(announcementTemplateId),
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
        });

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

      // The template's pages, by ID; the status page opened from goes first.
      const templateStatusPageIds: Array<string> = readRecordIds(
        announcementTemplate?.statusPages,
      );

      if (templateStatusPageIds.length > 0) {
        initialValue["statusPages"] = templateStatusPageIds;
      } else {
        delete initialValue["statusPages"];
      }

      setInitialValuesForAnnouncement(initialValue);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  // One identity per load: the form latches its initial values once.
  const formInitialValues: JSONObject = useMemo(() => {
    return pickRecordToCreateFrom({
      values: initialValuesForAnnouncement,
      record: recordToCreateFrom.record,
      created: CreatedRecordKind.Announcement,
    });
  }, [initialValuesForAnnouncement, recordToCreateFrom.record]);

  const isPageLoading: boolean = isLoading || recordToCreateFrom.isLoading;

  /*
   * Opened from a status page, the trail goes back through that page's
   * Announcements tab, as the tab's own trail reads (CreateFromRecord);
   * otherwise through the project's Announcements list. Both start at the
   * project, as every page's trail does. The last link is this page, which
   * Breadcrumbs draws as text, so the address keeps what it was opened with.
   */
  const breadcrumbLinks: Array<Link> = recordToCreateFrom.breadcrumbLinks || [
    {
      title: "Project",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: "Status Pages",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGES] as Route,
      ),
    },
    {
      title: "Announcements",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.STATUS_PAGE_ANNOUNCEMENTS] as Route,
      ),
    },
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
          {isPageLoading && <PageLoader isVisible={true} />}
          {error && <ErrorMessage message={error} />}
          {!isPageLoading && !error && templateError && (
            <div className="mb-5">
              <ErrorMessage message={templateError} />
            </div>
          )}
          {!isPageLoading && !error && (
            <ModelForm<StatusPageAnnouncement>
              modelType={StatusPageAnnouncement}
              initialValues={formInitialValues}
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
