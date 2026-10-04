import PageComponentProps from "../../PageComponentProps";
import { Green, Red, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import Email from "Common/Types/Email";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  getStatusPageAccess,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import StatusPageAccessCopy, {
  getStatusPageAccessState,
  PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID,
} from "../../../Components/StatusPage/StatusPageAccessCopy";

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  /*
   * Whether visitors enter the master password instead of signing in: the
   * server then lets no private user sign in, so the page says so, with the
   * way to Access, where who can see the page is chosen.
   */
  const [isPasswordRequired, setIsPasswordRequired] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);
  const [showProgressModal, setShowProgressModal] = useState<boolean>(false);
  const [bulkActionInProgress, setBulkActionInProgress] =
    useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<{
    completed: number;
    total: number;
    succeeded: number;
    failed: Array<{ email: string; error: string }>;
    skippedInvalid: Array<string>;
  }>({
    completed: 0,
    total: 0,
    succeeded: 0,
    failed: [],
    skippedInvalid: [],
  });
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );

  const parseBulkEmails: (input: string) => {
    valid: Array<string>;
    invalid: Array<string>;
  } = (input: string) => {
    const tokens: Array<string> = (input || "")
      .split(/[\s,;]+/)
      .map((t: string) => {
        return t.trim();
      })
      .filter((t: string) => {
        return t.length > 0;
      });

    const seen: Set<string> = new Set<string>();
    const valid: Array<string> = [];
    const invalid: Array<string> = [];

    for (const token of tokens) {
      const normalized: string = token.toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      if (Email.isValid(normalized)) {
        valid.push(normalized);
      } else {
        invalid.push(token);
      }
    }

    return { valid, invalid };
  };

  interface BulkAddFormData {
    emails: string;
  }

  const handleBulkAddSubmit: (data: BulkAddFormData) => Promise<void> = async (
    data: BulkAddFormData,
  ): Promise<void> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }

    const { valid, invalid } = parseBulkEmails(data.emails);

    if (valid.length === 0) {
      throw new BadDataException(
        "No valid email addresses found. Please enter one email per line.",
      );
    }

    setShowBulkAddModal(false);
    setShowProgressModal(true);
    setBulkActionInProgress(true);
    setBulkProgress({
      completed: 0,
      total: valid.length,
      succeeded: 0,
      failed: [],
      skippedInvalid: invalid,
    });

    const projectId: ObjectID = new ObjectID(props.currentProject._id);
    let succeeded: number = 0;
    const failed: Array<{ email: string; error: string }> = [];

    for (let i: number = 0; i < valid.length; i++) {
      const emailStr: string = valid[i]!;

      try {
        const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
        privateUser.email = new Email(emailStr);
        privateUser.statusPageId = modelId;
        privateUser.projectId = projectId;

        await ModelAPI.create<StatusPagePrivateUser>({
          model: privateUser,
          modelType: StatusPagePrivateUser,
        });
        succeeded++;
      } catch (err) {
        failed.push({
          email: emailStr,
          error: API.getFriendlyMessage(err),
        });
      }

      setBulkProgress({
        completed: i + 1,
        total: valid.length,
        succeeded,
        failed: [...failed],
        skippedInvalid: invalid,
      });
    }

    setBulkActionInProgress(false);
    setRefreshToggle(Date.now().toString());
  };

  useEffect(() => {
    const fetchStatusPage: () => Promise<void> = async (): Promise<void> => {
      try {
        const statusPage: StatusPage | null = await ModelAPI.getItem({
          modelType: StatusPage,
          id: modelId,
          select: {
            isPublicStatusPage: true,
            enableMasterPassword: true,
            masterPassword: true,
          },
        });

        setIsPasswordRequired(
          Boolean(
            statusPage &&
              getStatusPageAccess(getStatusPageAccessState(statusPage)) ===
                StatusPageAccess.Password,
          ),
        );
        setFetchError(null);
      } catch (error) {
        const newErrorMessage: string =
          error instanceof Error && error.message
            ? error.message
            : "Failed to fetch status page details.";
        setFetchError(newErrorMessage);
      }
    };

    void fetchStatusPage();
  }, [modelId]);

  return (
    <Fragment>
      {fetchError && (
        <Alert className="mb-5" type={AlertType.DANGER} title={fetchError} />
      )}
      {isPasswordRequired && (
        <Alert
          className="mb-5"
          type={AlertType.INFO}
          title={StatusPageAccessCopy.privateUsersPasswordNotice}
          textOnRight={StatusPageAccessCopy.privateUsersPasswordNoticeAction}
          dataTestId={PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID}
          onClick={() => {
            Navigation.navigate(
              RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                ] as Route,
                { modelId },
              ),
            );
          }}
        />
      )}
      <ModelTable<StatusPagePrivateUser>
        modelType={StatusPagePrivateUser}
        id="status-page-group"
        name="Status Page > Private Users"
        userPreferencesKey="status-page-private-user-table"
        saveFilterProps={{
          tableId: "status-page-private-users-table",
        }}
        isDeleteable={true}
        showViewIdButton={true}
        isCreateable={true}
        isViewable={false}
        query={{
          statusPageId: modelId,
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        onBeforeCreate={(
          item: StatusPagePrivateUser,
        ): Promise<StatusPagePrivateUser> => {
          item.statusPageId = modelId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        refreshToggle={refreshToggle}
        cardProps={{
          title: "Private Users",
          description:
            "People who can sign in to see this status page. Each one gets an email invitation to set a password.",
          buttons: [
            {
              title: "Add in Bulk",
              buttonStyle: ButtonStyleType.OUTLINE,
              icon: IconProp.UserGroup,
              onClick: () => {
                setShowBulkAddModal(true);
              },
            },
          ],
        }}
        noItemsMessage={"No private users created for this status page."}
        formFields={[
          {
            field: {
              email: true,
            },
            title: "Email",
            fieldType: FormFieldSchemaType.Email,
            required: true,
            placeholder: "user@company.com",
            disableSpellCheck: true,
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
        ]}
        columns={[
          {
            field: {
              email: true,
            },
            title: "Email",
            type: FieldType.Email,
          },
          {
            field: {
              password: true,
            },
            title: "Status",
            type: FieldType.Password,

            getElement: (item: StatusPagePrivateUser): ReactElement => {
              if (item["password"]) {
                return <Pill color={Green} text={"Signed up"} />;
              }
              return <Pill color={Yellow} text={"Invite Sent"} />;
            },
          },
        ]}
      />

      {showBulkAddModal && (
        <BasicFormModal<BulkAddFormData>
          title="Add Private Users in Bulk"
          description="Paste email addresses below. An invitation email will be sent to each user."
          submitButtonText="Add Private Users"
          onClose={() => {
            setShowBulkAddModal(false);
          }}
          onSubmit={handleBulkAddSubmit}
          formProps={{
            name: "Bulk Add Private Users",
            fields: [
              {
                field: { emails: true },
                title: "Emails",
                description:
                  "One email per line (or separated by commas, semicolons, or spaces). Invalid or duplicate entries will be skipped.",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder:
                  "user1@example.com\nuser2@example.com\nuser3@example.com",
              },
            ],
          }}
        />
      )}

      {showProgressModal && (
        <ConfirmModal
          title={
            bulkActionInProgress
              ? "Adding Private Users..."
              : "Bulk Add Complete"
          }
          description={
            <div>
              {bulkActionInProgress ? (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    {translator.translateText(
                      "Please wait while private users are being added. This may take a moment.",
                    )}
                  </p>
                  <ProgressBar
                    count={bulkProgress.completed}
                    totalCount={bulkProgress.total}
                    suffix="users"
                    size={ProgressBarSize.Small}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col space-y-3">
                    {bulkProgress.succeeded > 0 && (
                      <div className="flex items-center rounded-lg bg-green-50 p-3">
                        <Icon
                          className="h-5 w-5 flex-shrink-0"
                          icon={IconProp.CheckCircle}
                          color={Green}
                        />
                        <div className="ml-2 text-sm font-medium text-green-800">
                          {translator.translatePlural(
                            {
                              one: "{{count}} private user added successfully",
                              other:
                                "{{count}} private users added successfully",
                            },
                            bulkProgress.succeeded,
                          )}
                        </div>
                      </div>
                    )}
                    {bulkProgress.failed.length > 0 && (
                      <div className="flex items-center rounded-lg bg-red-50 p-3">
                        <Icon
                          className="h-5 w-5 flex-shrink-0"
                          icon={IconProp.Close}
                          color={Red}
                        />
                        <div className="ml-2 text-sm font-medium text-red-800">
                          {translator.translatePlural(
                            {
                              one: "{{count}} private user failed",
                              other: "{{count}} private users failed",
                            },
                            bulkProgress.failed.length,
                          )}
                        </div>
                      </div>
                    )}
                    {bulkProgress.skippedInvalid.length > 0 && (
                      <div className="flex items-center rounded-lg bg-yellow-50 p-3">
                        <Icon
                          className="h-5 w-5 flex-shrink-0"
                          icon={IconProp.Alert}
                          color={Yellow}
                        />
                        <div className="ml-2 text-sm font-medium text-yellow-800">
                          {translator.translatePlural(
                            {
                              one: "{{count}} invalid email skipped",
                              other: "{{count}} invalid emails skipped",
                            },
                            bulkProgress.skippedInvalid.length,
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {bulkProgress.failed.length > 0 && (
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      <div className="max-h-64 overflow-y-auto divide-y divide-gray-200">
                        {bulkProgress.failed.map(
                          (
                            failedItem: {
                              email: string;
                              error: string;
                            },
                            i: number,
                          ) => {
                            return (
                              <div className="px-4 py-3 text-sm" key={i}>
                                <div className="font-medium text-gray-900">
                                  {failedItem.email}
                                </div>
                                <div className="text-gray-500 mt-0.5">
                                  {failedItem.error}
                                </div>
                              </div>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          }
          submitButtonType={ButtonStyleType.NORMAL}
          disableSubmitButton={bulkActionInProgress}
          submitButtonText="Close"
          onSubmit={() => {
            setShowProgressModal(false);
          }}
        />
      )}
    </Fragment>
  );
};

export default StatusPageDelete;
