import PrivateAccessCopy, {
  hasPrivateUserJoined,
  PRIVATE_USERS_TABLE_TEST_ID,
} from "./PrivateAccessCopy";
import { PrivateAccessKind, PrivateUserModel } from "./PrivateAccessKinds";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The people who may sign in to a public link that asks its visitors to
 * (#10250): a dashboard's private users, and a form's next
 * (PrivateAccessKinds). Each is added by their email address - "Add
 * Private User", not "Create Dashboard Private User" - and emailed an
 * invitation whose link sets their first password, unless the link takes
 * only single sign-on; single sign-on adds the people it lets in by
 * itself. Remove ends every session they hold.
 *
 * Whether each has joined is read from hasPassword and when they last
 * signed in, never from their password, which the API does not return.
 */
export interface ComponentProps {
  kind: PrivateAccessKind;
  // The dashboard (or form) whose private users these are.
  parentId: ObjectID;
}

const PrivateUsersTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const kind: PrivateAccessKind = props.kind;

  const query: Query<PrivateUserModel> = {
    [kind.parentColumn]: props.parentId,
    projectId: ProjectUtil.getCurrentProjectId()!,
  } as Query<PrivateUserModel>;

  return (
    <div data-testid={PRIVATE_USERS_TABLE_TEST_ID}>
      <ModelTable<PrivateUserModel>
        modelType={kind.privateUserModel}
        id={kind.privateUsersTable.tableId}
        name={kind.privateUsersTable.tableName}
        singularName={PrivateAccessCopy.privateUser}
        pluralName={PrivateAccessCopy.privateUsers}
        createVerb="Add"
        userPreferencesKey={kind.privateUsersTable.userPreferencesKey}
        saveFilterProps={{
          tableId: kind.privateUsersTable.saveFilterTableId,
        }}
        isDeleteable={true}
        isCreateable={true}
        isEditable={false}
        isViewable={false}
        showViewIdButton={true}
        documentationLink={Route.fromString(kind.docsPath)}
        query={query}
        onBeforeCreate={(item: PrivateUserModel): Promise<PrivateUserModel> => {
          (item as unknown as Record<string, unknown>)[kind.parentColumn] =
            props.parentId;
          item.projectId = ProjectUtil.getCurrentProjectId()!;
          return Promise.resolve(item);
        }}
        cardProps={{
          title: PrivateAccessCopy.privateUsersTitle,
          description: kind.copy.privateUsersDescription,
        }}
        formFields={[
          {
            field: {
              email: true,
            },
            title: PrivateAccessCopy.emailTitle,
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
            title: PrivateAccessCopy.emailTitle,
            type: FieldType.Email,
          },
        ]}
        selectMoreFields={{
          // A user who signs in with single sign-on has joined too.
          lastActive: true,
        }}
        columns={[
          {
            field: {
              email: true,
            },
            title: PrivateAccessCopy.emailTitle,
            type: FieldType.Email,
          },
          {
            field: {
              hasPassword: true,
            },
            title: PrivateAccessCopy.statusTitle,
            type: FieldType.Element,
            getElement: (item: PrivateUserModel): ReactElement => {
              return hasPrivateUserJoined(item) ? (
                <Pill tone={PillTone.Success} text={PrivateAccessCopy.joined} />
              ) : (
                <Pill
                  tone={PillTone.Warning}
                  text={PrivateAccessCopy.invited}
                />
              );
            },
          },
          {
            field: {
              lastActive: true,
            },
            title: PrivateAccessCopy.lastSignedIn,
            type: FieldType.DateTime,
            hideOnMobile: true,
          },
        ]}
      />
    </div>
  );
};

export default PrivateUsersTable;
