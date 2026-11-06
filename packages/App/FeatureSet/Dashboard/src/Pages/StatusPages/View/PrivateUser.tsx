import PageComponentProps from "../../PageComponentProps";
import useStatusPageBulkAdd, {
  StatusPageBulkAdd,
} from "../../../Components/StatusPage/useStatusPageBulkAdd";
import {
  BULK_ADD_NO_VALID_EMAIL,
  getBulkAddNothingToAddError,
  getBulkEmailEntries,
  hasBulkAddEntryToAdd,
  StatusPageBulkAddEntry,
} from "../../../Components/StatusPage/StatusPageBulkAddEntries";
import { Green, Yellow } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import Email from "Common/Types/Email";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  getStatusPageAccess,
  StatusPageAccess,
} from "Common/Types/StatusPage/StatusPageAccess";
import StatusPageAccessCopy, {
  getStatusPageAccessState,
  PRIVATE_USER_PLURAL_NAME,
  PRIVATE_USER_SINGULAR_NAME,
  PRIVATE_USERS_PASSWORD_NOTICE_TEST_ID,
} from "../../../Components/StatusPage/StatusPageAccessCopy";
import StatusPageMagicLinkCard from "../../../Components/StatusPage/StatusPageMagicLinkCard";
import StatusPageMagicLinkCopy, {
  getMagicLinkFoldedItem,
  STATUS_PAGE_MAGIC_LINK_SECTION_TEST_ID,
} from "../../../Components/StatusPage/StatusPageMagicLinkCopy";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";

/*
 * Whether a private user has joined: they set a password, or they have
 * signed in at least once - with a sign-in link or SSO, which need none.
 * Somebody who has done neither has only been sent their invitation.
 */
export const hasPrivateUserJoined: (user: StatusPagePrivateUser) => boolean = (
  user: StatusPagePrivateUser,
): boolean => {
  return Boolean(user.password) || Boolean(user.lastActive);
};

const StatusPageDelete: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  /*
   * Whether visitors enter the master password instead of signing in: the
   * server then lets no private user sign in, so the page says so, with the
   * way to Access, where who can see the page is chosen.
   */
  const [isPasswordRequired, setIsPasswordRequired] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [showBulkAddModal, setShowBulkAddModal] = useState<boolean>(false);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    Date.now().toString(),
  );
  /*
   * Add in Bulk: the shared bulk runner and its progress dialog - several
   * at once, the time left and Stop, and what happened to every entry
   * (useStatusPageBulkAdd). The list is read again once it ends.
   */
  const bulkAdd: StatusPageBulkAdd = useStatusPageBulkAdd({
    singularLabel: PRIVATE_USER_SINGULAR_NAME,
    pluralLabel: PRIVATE_USER_PLURAL_NAME,
    onFinished: (): void => {
      setRefreshToggle(Date.now().toString());
    },
  });
  // Whether sign-in links are on, once read: undefined until then.
  const [isMagicLinkOn, setIsMagicLinkOn] = useState<boolean | undefined>(
    undefined,
  );

  interface BulkAddFormData {
    emails: string;
  }

  const handleBulkAddSubmit: (data: BulkAddFormData) => Promise<void> = async (
    data: BulkAddFormData,
  ): Promise<void> => {
    if (!props.currentProject || !props.currentProject._id) {
      throw new BadDataException("Project ID cannot be null");
    }

    const entries: Array<StatusPageBulkAddEntry> = getBulkEmailEntries(
      data.emails,
    );

    /*
     * The field says so when nothing in it can be added, and the form waits
     * (getBulkAddNothingToAddError): there is always an entry to add here.
     */
    if (!hasBulkAddEntryToAdd(entries)) {
      return;
    }

    // The form goes; the progress dialog takes over.
    setShowBulkAddModal(false);

    const projectId: ObjectID = new ObjectID(props.currentProject._id);

    await bulkAdd.run(
      entries,
      async (entry: StatusPageBulkAddEntry): Promise<void> => {
        const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
        privateUser.email = new Email(entry.value);
        privateUser.statusPageId = modelId;
        privateUser.projectId = projectId;

        await ModelAPI.create<StatusPagePrivateUser>({
          model: privateUser,
          modelType: StatusPagePrivateUser,
        });
      },
    );
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
        /*
         * On a status page's own Private Users page the rows are its private
         * users, and they are added, as subscribers are: "Add Private User",
         * not "Create Status Page Private User". An empty list reads the
         * table's own "No private users yet."
         */
        singularName={PRIVATE_USER_SINGULAR_NAME}
        pluralName={PRIVATE_USER_PLURAL_NAME}
        createVerb="Add"
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
            "People who can sign in to see this status page. Each one is emailed an invitation when you add them.",
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
        selectMoreFields={{
          // A user who signs in without a password has joined too.
          lastActive: true,
        }}
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
              if (hasPrivateUserJoined(item)) {
                return <Pill color={Green} text={"Signed up"} />;
              }
              return <Pill color={Yellow} text={"Invite Sent"} />;
            },
          },
        ]}
      />

      <AdvancedPageSection
        description={StatusPageMagicLinkCopy.sectionDescription}
        items={[getMagicLinkFoldedItem(isMagicLinkOn)]}
        dataTestId={STATUS_PAGE_MAGIC_LINK_SECTION_TEST_ID}
      >
        <StatusPageMagicLinkCard
          statusPageId={modelId}
          onChange={(isOn: boolean) => {
            setIsMagicLinkOn(isOn);
          }}
        />
      </AdvancedPageSection>

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
                  "One email per line. Invalid and duplicate ones are skipped.",
                fieldType: FormFieldSchemaType.LongText,
                required: true,
                placeholder:
                  "user1@example.com\nuser2@example.com\nuser3@example.com",
                // Nothing in it an address: said under it, and Add waits.
                customValidation: (
                  values: FormValues<BulkAddFormData>,
                ): string | null => {
                  return getBulkAddNothingToAddError(
                    getBulkEmailEntries(String(values.emails || "")),
                    BULK_ADD_NO_VALID_EMAIL,
                  );
                },
              },
            ],
          }}
        />
      )}

      {bulkAdd.dialog}
    </Fragment>
  );
};

export default StatusPageDelete;
