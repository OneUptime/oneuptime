import MarkdownUtil from "Common/UI/Utils/Markdown";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FetchStatusPages from "../../Components/StatusPage/FetchStatusPages";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import OneUptimeDate from "Common/Types/Date";
import Page from "Common/UI/Components/Page/Page";

const AnnouncementCreate: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [initialValuesForAnnouncement, setInitialValuesForAnnouncement] =
    useState<JSONObject>({});

  useEffect(() => {
    if (Navigation.getQueryStringByName("announcementTemplateId")) {
      fetchAnnouncementTemplate(
        new ObjectID(
          Navigation.getQueryStringByName("announcementTemplateId") || "",
        ),
      );
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchAnnouncementTemplate: (id: ObjectID) => Promise<void> = async (
    id: ObjectID,
  ): Promise<void> => {
    setError("");
    setIsLoading(true);

    try {
      //fetch announcement template

      const announcementTemplate: StatusPageAnnouncementTemplate | null =
        await ModelAPI.getItem<StatusPageAnnouncementTemplate>({
          modelType: StatusPageAnnouncementTemplate,
          id: id,
          select: {
            title: true,
            description: true,
            statusPages: true,
            shouldStatusPageSubscribersBeNotified: true,
          },
        });

      if (announcementTemplate) {
        const initialValue: JSONObject = {
          ...BaseModel.toJSONObject(
            announcementTemplate,
            StatusPageAnnouncementTemplate,
          ),
          statusPages: announcementTemplate.statusPages?.map(
            (statusPage: StatusPage) => {
              return statusPage.id!.toString();
            },
          ),
          showAnnouncementAt: OneUptimeDate.getCurrentDate(),
        };

        setInitialValuesForAnnouncement(initialValue);
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  return (
    <Page
      title={"Create Announcement"}
      breadcrumbLinks={[
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
      ]}
    >
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
              fields={[
                {
                  field: {
                    title: true,
                  },
                  title: "Announcement Title",
                  fieldType: FormFieldSchemaType.Text,
                  stepId: "basic",
                  required: true,
                  placeholder: "Announcement Title",
                  validation: {
                    minLength: 2,
                  },
                },
                {
                  field: {
                    description: true,
                  },
                  title: "Description",
                  stepId: "basic",
                  fieldType: FormFieldSchemaType.Markdown,
                  required: false,
                  description: MarkdownUtil.getMarkdownCheatsheet(
                    "Add an announcement note",
                  ),
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
                        <p>No status pages selected for this announcement.</p>
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
                    showAnnouncementAt: true,
                  },
                  stepId: "more",
                  title: "Start Showing Announcement At",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: true,
                  placeholder: "Pick Date and Time",
                  getDefaultValue: () => {
                    return OneUptimeDate.getCurrentDate();
                  },
                },
                {
                  field: {
                    endAnnouncementAt: true,
                  },
                  stepId: "more",
                  title: "End Showing Announcement At",
                  fieldType: FormFieldSchemaType.DateTime,
                  required: false,
                  placeholder: "Pick Date and Time",
                },
                {
                  field: {
                    shouldStatusPageSubscribersBeNotified: true,
                  },

                  title: "Notify Status Page Subscribers",
                  stepId: "more",
                  description: "Should status page subscribers be notified?",
                  fieldType: FormFieldSchemaType.Checkbox,
                  defaultValue: true,
                  required: false,
                },
              ]}
              steps={[
                {
                  title: "Basic Information",
                  id: "basic",
                },
                {
                  title: "Status Pages",
                  id: "status-pages",
                },
                {
                  title: "Schedule & Settings",
                  id: "more",
                },
              ]}
              onSuccess={(_createdItem: StatusPageAnnouncement) => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
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
