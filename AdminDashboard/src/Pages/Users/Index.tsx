import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import Route from 'Common/Types/API/Route';
import { ErrorFunction } from 'Common/Types/FunctionTypes';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Page from 'CommonUI/src/Components/Page/Page';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import API from 'CommonUI/src/Utils/API/API';
import ModelAPI from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Navigation from 'CommonUI/src/Utils/Navigation';
import User from 'Model/Models/User';
import React, { FunctionComponent, ReactElement, useState } from 'react';

const Users: FunctionComponent = (): ReactElement => {
    const [showConfirmVerifyEmailModal, setShowConfirmVerifyEmailModal] =
        useState<boolean>(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [isConfimModalLoading, setIsConfirmModalLoading] =
        useState<boolean>(false);

    const [refreshItemsTrigger, setRefreshItemsTrigger] =
        useState<boolean>(false);

    return (
        <Page
            title={'Users'}
            breadcrumbLinks={[
                {
                    title: 'Admin Dashboard',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'Users',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USERS] as Route
                    ),
                },
            ]}
        >
            <ModelTable<User>
                modelType={User}
                id="users-table"
                isDeleteable={false}
                isEditable={false}
                showViewIdButton={true}
                refreshToggle={refreshItemsTrigger}
                isCreateable={true}
                name="Users"
                isViewable={false}
                cardProps={{
                    title: 'Users',
                    description: 'Here is a list of users in OneUptime.',
                }}
                actionButtons={[
                    {
                        title: 'Verify Email',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        isVisible: (item: User) => {
                            return !item.isEmailVerified;
                        },
                        onClick: async (
                            item: User,
                            onCompleteAction: VoidFunction,
                            onError: ErrorFunction
                        ) => {
                            try {
                                setSelectedUser(item);
                                setShowConfirmVerifyEmailModal(true);

                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                noItemsMessage={'No users found.'}
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'email@company.com',
                    },
                    {
                        field: {
                            password: true,
                        },
                        title: 'Password',
                        fieldType: FormFieldSchemaType.Password,
                        required: true,
                        placeholder: 'Password',
                    },
                    {
                        field: {
                            name: true,
                        },
                        title: 'Full Name',
                        fieldType: FormFieldSchemaType.Text,
                        required: true,
                        placeholder: 'John Smith',
                    },
                ]}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Full Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                    },
                ]}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Full Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                    },
                    {
                        field: {
                            isEmailVerified: true,
                        },
                        title: 'Email Verified',
                        type: FieldType.Boolean,
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created At',
                        type: FieldType.DateTime,
                    },
                ]}
            />

            {error ? (
                <ConfirmModal
                    title={`Error`}
                    description={error}
                    submitButtonText={'Close'}
                    onSubmit={async () => {
                        setError(null);
                    }}
                    submitButtonType={ButtonStyleType.NORMAL}
                />
            ) : (
                <></>
            )}

            {showConfirmVerifyEmailModal && selectedUser ? (
                <ConfirmModal
                    title={`Verify Email`}
                    description={`Are you sure you want to verify the email - ${selectedUser.email}?`}
                    isLoading={isConfimModalLoading}
                    submitButtonText={'Verify Email'}
                    onClose={async () => {
                        setShowConfirmVerifyEmailModal(false);
                        setSelectedUser(null);
                    }}
                    onSubmit={async () => {
                        try {
                            setIsConfirmModalLoading(true);
                            await ModelAPI.updateById<User>({
                                modelType: User,
                                id: selectedUser.id!,
                                data: {
                                    isEmailVerified: true,
                                },
                            });
                        } catch (err) {
                            setError(API.getFriendlyMessage(err as Error));
                        }

                        setRefreshItemsTrigger(!refreshItemsTrigger);
                        setIsConfirmModalLoading(false);
                        setShowConfirmVerifyEmailModal(false);
                    }}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Users;
