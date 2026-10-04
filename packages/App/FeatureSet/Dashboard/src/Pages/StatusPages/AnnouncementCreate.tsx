import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import Navigation from "Common/UI/Utils/Navigation";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
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
import FetchStatusPages from "../../Components/StatusPage/FetchStatusPages";
import FetchMonitors from "../../Components/Monitor/FetchMonitors";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import OneUptimeDate from "Common/Types/Date";
import Page from "Common/UI/Components/Page/Page";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ANNOUNCEMENT_STATUS_PAGE_QUERY_PARAM,
  ANNOUNCEMENT_TEMPLATE_QUERY_PARAM,
  AnnouncementFormKind,
  getAnnouncementEndsAtError,
  getInitialAnnouncementStatusPageIds,
  getScheduleAndNotificationsSection,
  readAnnouncementQueryId,
} from "../../Components/Announcement/AnnouncementForm";

/*
 * Two steps - Announcement and Status Pages - and the review step (see
 * Components/Announcement/AnnouncementForm for why). Built once: BasicForm
 * folds the fields next to each other that carry the same section.
 */
const advancedSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getAdvancedFormSection<StatusPageAnnouncement>();

const scheduleAndNotificationsSection: FormFieldCollapsibleSection<StatusPageAnnouncement> =
  getScheduleAndNotificationsSection<StatusPageAnnouncement>(
    AnnouncementFormKind.Create,
  );

const AnnouncementCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [initialValuesForAnnouncement, setInitialValuesForAnnouncement] =
    useState<JSONObject>({});

  /*
   * The status page whose Announcements tab the page was opened from, once
   * it is known to exist: it is picked on the form, and Create goes back to
   * its tab.
   */
  const [fromStatusPageId, setFromStatusPageId] = useState<string | null>(null);

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
        templateStatusPageIds: announcementTemplate?.statusPages?.map(
          (templateStatusPage: StatusPage) => {
            return templateStatusPage.id!.toString();
          },
        ),
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
   * project's Announcements list.
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
          {!isLoading && !error && (
            <ModelForm<StatusPageAnnouncement>
              modelType={StatusPageAnnouncement}
              initialValues={initialValuesForAnnouncement}
              name="Create New Announcement"
              id="create-announcement-form"
              steps={[
                {
                  title: "Announcement",
                  id: "announcement",
                },
                {
                  title: "Status Pages",
                  id: "status-pages",
                },
              ]}
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "announcement",
                  required: true,
                  placeholder: "Announcement Title",
                  validation: {
                    minLength: 2,
                  },
                },
                /*
                 * Required, as the server requires it: the text people read
                 * on the status page.
                 */
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "announcement",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: true,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Add an announcement note",
                  ),
                },
                {
                  field: {
                    attachments: true,
                  },
                  title: "Attachments",
                  stepId: "announcement",
                  fieldType: FormFieldSchemaType.MultipleFiles,
                  required: false,
                  description:
                    "Attach files that should be available with this announcement on the status page.",
                  collapsibleSection: advancedSection,
                },
                {
                  field: {
                    statusPages: true,
                  },
                  title: "Show announcement on these status pages",
                  stepId: "status-pages",
                  description:
                    "Select status pages to show this announcement on",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: StatusPage,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: true,
                  placeholder: "Select Status Pages",
                  getSummaryElement: (
                    item: FormValues<StatusPageAnnouncement>,
                  ) => {
                    if (!item.statusPages || !Array.isArray(item.statusPages)) {
                      return (
                        <p>
                          {translator.translateText(
                            "No status pages selected for this announcement.",
                          )}
                        </p>
                      );
                    }

                    const statusPageIds: Array<ObjectID> = [];

                    for (const statusPage of item.statusPages) {
                      if (typeof statusPage === "string") {
                        statusPageIds.push(new ObjectID(statusPage));
                        continue;
                      }

                      if (statusPage instanceof ObjectID) {
                        statusPageIds.push(statusPage);
                        continue;
                      }

                      if (statusPage instanceof StatusPage) {
                        statusPageIds.push(
                          new ObjectID(statusPage._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchStatusPages statusPageIds={statusPageIds} />
                      </div>
                    );
                  },
                },
                {
                  field: {
                    monitors: true,
                  },
                  title: "Monitors Affected",
                  stepId: "status-pages",
                  description:
                    "Select monitors affected by this announcement. If none selected, all subscribers will be notified.",
                  fieldType: FormFieldSchemaType.MultiSelectDropdown,
                  dropdownModal: {
                    type: Monitor,
                    labelField: "name",
                    valueField: "_id",
                  },
                  required: false,
                  placeholder: "Select Monitors",
                  getSummaryElement: (
                    item: FormValues<StatusPageAnnouncement>,
                  ) => {
                    if (!item.monitors || !Array.isArray(item.monitors)) {
                      return (
                        <p>
                          {translator.translateText(
                            "No monitors selected. All subscribers will be notified.",
                          )}
                        </p>
                      );
                    }

                    const monitorIds: Array<ObjectID> = [];

                    for (const monitor of item.monitors) {
                      if (typeof monitor === "string") {
                        monitorIds.push(new ObjectID(monitor));
                        continue;
                      }

                      if (monitor instanceof ObjectID) {
                        monitorIds.push(monitor);
                        continue;
                      }

                      if (monitor instanceof Monitor) {
                        monitorIds.push(
                          new ObjectID(monitor._id?.toString() || ""),
                        );
                        continue;
                      }
                    }

                    return (
                      <div>
                        <FetchMonitors monitorIds={monitorIds} />
                      </div>
                    );
                  },
                },
                /*
                 * Folded to one line that says what happens: it shows now,
                 * stays until someone ends it, and the subscribers are told
                 * when it starts showing - the model's defaults.
                 */
                {
                  field: {
                    showAnnouncementAt: true,
                  },
                  stepId: "status-pages",
                  title: "Start Showing Announcement At",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                  collapsibleSection: scheduleAndNotificationsSection,
                  getDefaultValue: () => {
                    return OneUptimeDate.getCurrentDate();
                  },
                },
                {
                  field: {
                    endAnnouncementAt: true,
                  },
                  stepId: "status-pages",
                  title: "End Showing Announcement At",
                  description:
                    "Leave empty to keep the announcement up until you set an end.",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: false,
                  placeholder: "Pick Date and Time",
                  collapsibleSection: scheduleAndNotificationsSection,
                  customValidation: (
                    values: FormValues<StatusPageAnnouncement>,
                  ): string | null => {
                    return getAnnouncementEndsAtError(values);
                  },
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotified: true,
                  },
                  title: "Notify Status Page Subscribers",
                  stepId: "status-pages",
                  description:
                    "Subscribers of these status pages are told when the announcement starts showing.",
                  fieldType: FormFieldSchemaType.Checkbox,
                  collapsibleSection: scheduleAndNotificationsSection,
                  defaultValue: true,
                  required: false,
                },
              ]}
              onSuccess={(_createdItem: StatusPageAnnouncement) => {
                /*
                 * Back where Create was pressed: the status page's own
                 * Announcements tab, or the project's list.
                 */
                Navigation.navigate(
                  fromStatusPageId
                    ? RouteUtil.populateRouteParams(
                        RouteMap[
                          PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                        ] as Route,
                        { modelId: fromStatusPageId },
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
