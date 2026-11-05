import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Green, Gray500 } from "Common/Types/BrandColors";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";
import useOpenStackRead, { OpenStackRead } from "./Part/UseOpenStackRead";
import {
  OpenStackNoticePreview,
  fetchOpenStackNoticePreview,
  turnOffOpenStackNotice,
  turnOnOpenStackNotice,
} from "../../Pages/OpenStack/Utils/OpenStackStatusPageReads";

/*
 * WHO HEARS WHEN A PART AFFECTING A PROJECT FAILS.
 *
 * An email address or a webhook for each project. A notice starts off, and turning one on is always from its
 * preview: who it tells, what it would say and what the project holds. Nothing here can turn one on without
 * that having been shown, because the server won't, and a recipient changed afterwards is off again.
 */

const PROJECT_OPTIONS: number = 1000;

export interface ComponentProps {
  openStackCloudId: ObjectID;
  // On a project's own page, only that project's, and nothing to pick.
  openStackProjectId?: string | undefined;
}

const OpenStackProjectNoticesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [preview, setPreview] = useState<{
    noticeId: ObjectID;
    answer: OpenStackNoticePreview;
    onDone: VoidFunction;
  } | null>(null);
  const [isTurningOn, setIsTurningOn] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>("");

  const projects: OpenStackRead<Array<DropdownOption>> = useOpenStackRead<
    Array<DropdownOption>
  >(async () => {
    if (props.openStackProjectId) {
      return [];
    }

    const rows: ListResult<OpenStackResource> =
      await ModelAPI.getList<OpenStackResource>({
        modelType: OpenStackResource,
        query: {
          openStackCloudId: props.openStackCloudId,
          kind: OpenStackResourceKind.Project,
        },
        select: { externalId: true, name: true },
        sort: { name: SortOrder.Ascending },
        skip: 0,
        limit: PROJECT_OPTIONS,
      });

    return rows.data.map((row: OpenStackResource): DropdownOption => {
      return {
        value: row.externalId || "",
        label: row.name || row.externalId || "",
      };
    });
  }, [props.openStackCloudId.toString(), props.openStackProjectId || ""]);

  const nameOfProject: (id: string | undefined) => string = (
    id: string | undefined,
  ): string => {
    const option: DropdownOption | undefined = projects.data?.find(
      (entry: DropdownOption): boolean => {
        return entry.value === id;
      },
    );

    return option?.label || id || "";
  };

  return (
    <div data-testid="openstack-project-notices">
      <ModelTable<OpenStackProjectNotice>
        modelType={OpenStackProjectNotice}
        id="openstack-project-notices-table"
        userPreferencesKey="openstack-project-notices-table"
        name="OpenStack > Project Notices"
        isDeleteable={true}
        isEditable={true}
        isCreateable={true}
        isViewable={false}
        showRefreshButton={true}
        sortBy="openStackProjectId"
        sortOrder={SortOrder.Ascending}
        query={{
          openStackCloudId: props.openStackCloudId,
          ...(props.openStackProjectId
            ? { openStackProjectId: props.openStackProjectId }
            : {}),
        }}
        onBeforeCreate={(
          item: OpenStackProjectNotice,
        ): Promise<OpenStackProjectNotice> => {
          item.openStackCloudId = props.openStackCloudId;
          if (props.openStackProjectId) {
            item.openStackProjectId = props.openStackProjectId;
          }
          return Promise.resolve(item);
        }}
        cardProps={{
          title: translationKey("Project Notices"),
          description: translationKey(
            "Who hears when a part affecting a project has an incident or planned maintenance. Off until you have seen who it tells, and only ever about that project.",
          ),
        }}
        noItemsMessage={translationKey(
          "Nobody is told anything yet. Add an email or a webhook for a project, then turn it on from its preview.",
        )}
        selectMoreFields={{
          isEnabled: true,
          email: true,
          webhookUrl: true,
          statusPageId: true,
          previewSeenAt: true,
        }}
        filters={[]}
        actionButtons={[
          {
            title: "Preview and Turn On",
            rowButtonTitle: "Turn On",
            icon: IconProp.Check,
            buttonStyleType: ButtonStyleType.NORMAL,
            isVisible: (item: OpenStackProjectNotice): boolean => {
              return !item.isEnabled;
            },
            onClick: async (
              item: OpenStackProjectNotice,
              onCompleteAction: VoidFunction,
              onError: (error: Error) => void,
            ) => {
              try {
                const noticeId: ObjectID = new ObjectID(item._id!.toString());
                setPreviewError("");
                setPreview({
                  noticeId,
                  answer: await fetchOpenStackNoticePreview(noticeId),
                  onDone: onCompleteAction,
                });
                onCompleteAction();
              } catch (error) {
                onError(error as Error);
              }
            },
          },
          {
            title: "Turn Off",
            icon: IconProp.Close,
            buttonStyleType: ButtonStyleType.OUTLINE,
            isVisible: (item: OpenStackProjectNotice): boolean => {
              return Boolean(item.isEnabled);
            },
            onClick: async (
              item: OpenStackProjectNotice,
              onCompleteAction: VoidFunction,
              onError: (error: Error) => void,
            ) => {
              try {
                await turnOffOpenStackNotice(
                  new ObjectID(item._id!.toString()),
                );
                onCompleteAction();
              } catch (error) {
                onError(error as Error);
              }
            },
          },
        ]}
        columns={[
          {
            field: { openStackProjectId: true },
            title: "Project",
            type: FieldType.Element,
            isNotCustomizable: true,
            getElement: (item: OpenStackProjectNotice): ReactElement => {
              return (
                <span className="break-words text-sm text-gray-900">
                  <bdi>{nameOfProject(item.openStackProjectId)}</bdi>
                </span>
              );
            },
          },
          {
            field: { email: true },
            title: "Who",
            type: FieldType.Element,
            isNotCustomizable: true,
            getElement: (item: OpenStackProjectNotice): ReactElement => {
              return (
                <span
                  className="break-words text-sm text-gray-900"
                  data-testid="openstack-notice-recipient"
                >
                  <bdi>
                    {item.statusPageId
                      ? translator.translateText("Its private status page")
                      : item.email?.toString() ||
                        item.webhookUrl?.toString() ||
                        ""}
                  </bdi>
                </span>
              );
            },
          },
          {
            field: { isEnabled: true },
            title: "Is On",
            type: FieldType.Element,
            isNotCustomizable: true,
            getElement: (item: OpenStackProjectNotice): ReactElement => {
              return (
                <Pill
                  color={item.isEnabled ? Green : Gray500}
                  text={item.isEnabled ? "On" : "Off"}
                />
              );
            },
          },
        ]}
        formFields={[
          ...(props.openStackProjectId
            ? []
            : [
                {
                  field: { openStackProjectId: true },
                  title: "Project",
                  fieldType: FormFieldSchemaType.Dropdown,
                  dropdownOptions: projects.data || [],
                  required: true,
                  placeholder: "Which project",
                  description: "Only ever told about this project.",
                },
              ]),
          {
            field: { email: true },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: false,
            placeholder: "ops@example.com",
            description:
              "An email or a webhook. Changing it later turns this off until you have seen the preview again.",
          },
          {
            field: { webhookUrl: true },
            title: "Webhook",
            fieldType: FormFieldSchemaType.URL,
            required: false,
            placeholder: "https://example.com/openstack-notices",
            description: "A POST of JSON, with an id that doesn't change on a retry.",
          },
        ]}
      />

      {preview ? (
        <Modal
          title={translationKey("Who This Tells")}
          description={translationKey(
            "Nothing has been sent. This is who would be told, and what a failure would say.",
          )}
          modalWidth={ModalWidth.Medium}
          submitButtonText={translationKey("Turn On")}
          isLoading={isTurningOn}
          error={previewError || undefined}
          disableSubmitButton={!preview.answer.isProjectInCloud}
          onClose={() => {
            setPreview(null);
          }}
          onSubmit={() => {
            setIsTurningOn(true);
            setPreviewError("");
            turnOnOpenStackNotice({
              noticeId: preview.noticeId,
              previewToken: preview.answer.previewToken,
            })
              .then(() => {
                preview.onDone();
                setPreview(null);
              })
              .catch((error: unknown) => {
                setPreviewError(API.getFriendlyMessage(error));
              })
              .finally(() => {
                setIsTurningOn(false);
              });
          }}
        >
          <Fragment>
            <dl
              className="mb-4 space-y-2 text-sm"
              data-testid="openstack-notice-preview"
            >
              <div>
                <dt className="font-medium text-gray-900">
                  {translator.translateText("Who is told")}
                </dt>
                <dd className="break-words text-gray-700">
                  <bdi>
                    {preview.answer.address ||
                      translator.translateText(
                        "Whoever you add as a private user of its status page",
                      )}
                  </bdi>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-gray-900">
                  {translator.translateText("About")}
                </dt>
                <dd className="break-words text-gray-700">
                  <bdi>
                    {preview.answer.projectName || preview.answer.projectId}
                  </bdi>{" "}
                  {translator.translateTemplate(
                    "({{count}} instances now, and nothing about any other project)",
                    { count: String(preview.answer.instanceCount) },
                  )}
                </dd>
              </div>
            </dl>
            {preview.answer.isProjectInCloud ? (
              <></>
            ) : (
              <p
                className="mb-4 text-sm text-amber-800"
                data-testid="openstack-notice-project-gone"
              >
                {translator.translateText(
                  "OneUptime does not see this project in the cloud, so nothing would be sent. Check its ID.",
                )}
              </p>
            )}
            <div className="rounded border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-sm font-medium text-gray-900">
                <bdi>{preview.answer.example.subject}</bdi>
              </div>
              <MarkdownViewer text={preview.answer.example.markdown} />
            </div>
          </Fragment>
        </Modal>
      ) : (
        <></>
      )}
    </div>
  );
};

export default OpenStackProjectNoticesCard;
