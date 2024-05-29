import DashboardNavigation from '../../Utils/Navigation';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import URL from 'Common/Types/API/URL';
import { ErrorFunction, VoidFunction } from 'Common/Types/FunctionTypes';
import IconProp from 'Common/Types/Icon/IconProp';
import { JSONObject } from 'Common/Types/JSON';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { APP_API_URL } from 'CommonUI/src/Config';
import API from 'CommonUI/src/Utils/API/API';
import User from 'CommonUI/src/Utils/User';
import UserCall from 'Model/Models/UserCall';
import React, { ReactElement, useEffect, useState } from 'react';

const Call: () => JSX.Element = (): ReactElement => {
    const [showVerificationCodeModal, setShowVerificationCodeModal] =
        useState<boolean>(false);

    const [showResendCodeModal, setShowResendCodeModal] =
        useState<boolean>(false);

    const [error, setError] = useState<string>('');
    const [currentItem, setCurrentItem] = useState<UserCall | null>(null);
    const [refreshToggle, setRefreshToggle] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(false);

    const [
        showVerificationCodeResentModal,
        setShowVerificationCodeResentModal,
    ] = useState<boolean>(false);

    useEffect(() => {
        setError('');
    }, [showVerificationCodeModal]);

    return (
        <>
            <ModelTable<UserCall>
                modelType={UserCall}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString(),
                }}
                filters={[]}
                refreshToggle={refreshToggle}
                onBeforeCreate={(model: UserCall): Promise<UserCall> => {
                    model.projectId = DashboardNavigation.getProjectId()!;
                    model.userId = User.getUserId();
                    return Promise.resolve(model);
                }}
                createVerb={'Add'}
                actionButtons={[
                    {
                        title: 'Verify',
                        buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                        icon: IconProp.Check,
                        isVisible: (item: UserCall): boolean => {
                            if (item['isVerified']) {
                                return false;
                            }

                            return true;
                        },
                        onClick: async (
                            item: UserCall,
                            onCompleteAction: VoidFunction,
                            onError: ErrorFunction
                        ) => {
                            try {
                                setCurrentItem(item);
                                setShowVerificationCodeModal(true);
                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                    {
                        title: 'Resend Code',
                        buttonStyleType: ButtonStyleType.NORMAL,
                        icon: IconProp.Call,
                        isVisible: (item: UserCall): boolean => {
                            if (item['isVerified']) {
                                return false;
                            }

                            return true;
                        },
                        onClick: async (
                            item: UserCall,
                            onCompleteAction: VoidFunction,
                            onError: ErrorFunction
                        ) => {
                            try {
                                setCurrentItem(item);
                                setShowResendCodeModal(true);

                                onCompleteAction();
                            } catch (err) {
                                onCompleteAction();
                                onError(err as Error);
                            }
                        },
                    },
                ]}
                id="user-call"
                name="User Settings > Notification Methods > Call"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    title: 'Phone Numbers for Call Notifications',
                    description:
                        'Manage Phone Numbers that will receive call notifications for this project.',
                }}
                noItemsMessage={
                    'No phone numbers found. Please add one to receive notifications.'
                }
                formFields={[
                    {
                        field: {
                            phone: true,
                        },
                        title: 'Phone Number',
                        fieldType: FormFieldSchemaType.Phone,
                        required: true,
                        placeholder: '+11234567890',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                showRefreshButton={true}
                columns={[
                    {
                        field: {
                            phone: true,
                        },
                        title: 'Phone Number',
                        type: FieldType.Phone,
                    },
                    {
                        field: {
                            isVerified: true,
                        },
                        title: 'Verified',
                        type: FieldType.Boolean,
                    },
                ]}
            />

            {showVerificationCodeModal && currentItem ? (
                <BasicFormModal
                    title={'Verify Phone Number'}
                    onClose={() => {
                        setShowVerificationCodeModal(false);
                    }}
                    isLoading={isLoading}
                    submitButtonText={'Verify'}
                    onSubmit={async (item: JSONObject) => {
                        setIsLoading(true);
                        try {
                            const response:
                                | HTTPResponse<JSONObject>
                                | HTTPErrorResponse = await API.post(
                                URL.fromString(APP_API_URL.toString()).addRoute(
                                    '/user-call/verify'
                                ),
                                {
                                    code: item['code'],
                                    projectId:
                                        DashboardNavigation.getProjectId()?.toString(),
                                    itemId: currentItem['_id'],
                                }
                            );

                            if (response.isFailure()) {
                                setError(API.getFriendlyMessage(response));
                                setIsLoading(false);
                            } else {
                                setIsLoading(false);
                                setShowVerificationCodeModal(false);
                                setRefreshToggle(!refreshToggle);
                            }
                        } catch (e) {
                            setError(API.getFriendlyMessage(e));
                            setIsLoading(false);
                        }
                    }}
                    formProps={{
                        name: 'Verify Phone Number',
                        error: error || '',
                        fields: [
                            {
                                title: 'Verification Code',
                                description: `We're calling you with your verification code. Please make sure this device can receive calls.`,
                                field: {
                                    code: true,
                                },
                                placeholder: '123456',
                                required: true,
                                validation: {
                                    minLength: 6,
                                    maxLength: 6,
                                },
                                fieldType: FormFieldSchemaType.Number,
                            },
                        ],
                    }}
                />
            ) : (
                <></>
            )}

            {showResendCodeModal && currentItem ? (
                <ConfirmModal
                    title={`Resend Code`}
                    error={error}
                    description={
                        'Are you sure you want to resend verification code? We will make a call to this number.'
                    }
                    submitButtonText={'Resend Code'}
                    onClose={() => {
                        setShowResendCodeModal(false);
                        setError('');
                    }}
                    isLoading={isLoading}
                    onSubmit={async () => {
                        try {
                            const response:
                                | HTTPResponse<JSONObject>
                                | HTTPErrorResponse = await API.post(
                                URL.fromString(APP_API_URL.toString()).addRoute(
                                    '/user-call/resend-verification-code'
                                ),
                                {
                                    projectId:
                                        DashboardNavigation.getProjectId()?.toString(),
                                    itemId: currentItem['_id'],
                                }
                            );

                            if (response.isFailure()) {
                                setError(API.getFriendlyMessage(response));
                                setIsLoading(false);
                            } else {
                                setIsLoading(false);
                                setShowResendCodeModal(false);
                                setShowVerificationCodeResentModal(true);
                            }
                        } catch (err) {
                            setError(API.getFriendlyMessage(err));
                            setIsLoading(false);
                        }
                    }}
                />
            ) : (
                <></>
            )}

            {showVerificationCodeResentModal ? (
                <ConfirmModal
                    title={`Calling you with your verification code`}
                    error={error}
                    description={
                        'We are calling you with your verification code. Please make sure this device can receive calls.'
                    }
                    submitButtonText={'Close'}
                    onSubmit={async () => {
                        setShowVerificationCodeResentModal(false);
                        setError('');
                    }}
                />
            ) : (
                <></>
            )}
        </>
    );
};

export default Call;
