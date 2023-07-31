import UserEmail from 'Model/Models/UserEmail';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import IconProp from 'Common/Types/Icon/IconProp';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import DashboardNavigation from '../../Utils/Navigation';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import User from 'CommonUI/src/Utils/User';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import { JSONObject } from 'Common/Types/JSON';
import URL from 'Common/Types/API/URL';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import API from 'CommonUI/src/Utils/API/API';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const Email: FunctionComponent = (): ReactElement => {
    const [showVerificationCodeModal, setShowVerificationCodeModal] =
        useState<boolean>(false);

    const [showResendCodeModal, setShowResendCodeModal] =
        useState<boolean>(false);

    const [error, setError] = useState<string>('');
    const [currentItem, setCurrentItem] = useState<JSONObject | null>(null);
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
            <ModelTable<UserEmail>
                modelType={UserEmail}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString(),
                }}
                refreshToggle={refreshToggle}
                onBeforeCreate={(model: UserEmail): UserEmail => {
                    model.projectId = DashboardNavigation.getProjectId()!;
                    model.userId = User.getUserId();
                    return model;
                }}
                createVerb={'Add'}
                actionButtons={[
                    {
                        title: 'Verify',
                        buttonStyleType: ButtonStyleType.SUCCESS_OUTLINE,
                        icon: IconProp.Check,
                        isVisible: (item: JSONObject): boolean => {
                            if (item['isVerified']) {
                                return false;
                            }

                            return true;
                        },
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
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
                        icon: IconProp.Email,
                        isVisible: (item: JSONObject): boolean => {
                            if (item['isVerified']) {
                                return false;
                            }

                            return true;
                        },
                        onClick: async (
                            item: JSONObject,
                            onCompleteAction: Function,
                            onError: (err: Error) => void
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
                id="user-emails"
                name="User Settings > Notification Methods > Emails"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    icon: IconProp.Email,
                    title: 'Emails for Notifications',
                    description:
                        'Manage emails that will receive notifications for this project.',
                }}
                noItemsMessage={
                    'No emails found. Please add one to receive notifications.'
                }
                formFields={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        fieldType: FormFieldSchemaType.Email,
                        required: true,
                        placeholder: 'you@company.com',
                        validation: {
                            minLength: 2,
                        },
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={false}
                columns={[
                    {
                        field: {
                            email: true,
                        },
                        title: 'Email',
                        type: FieldType.Email,
                        isFilterable: false,
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
                    title={'Verify Email'}
                    onClose={() => {
                        setShowVerificationCodeModal(false);
                    }}
                    isLoading={isLoading}
                    name="Verify Email"
                    submitButtonText={'Verify'}
                    onSubmit={async (item: JSONObject) => {
                        setIsLoading(true);
                        try {
                            const response:
                                | HTTPResponse<JSONObject>
                                | HTTPErrorResponse = await API.post(
                                URL.fromString(
                                    DASHBOARD_API_URL.toString()
                                ).addRoute('/user-email/verify'),
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
                        error: error || '',
                        fields: [
                            {
                                title: 'Verification Code',
                                description: `We have sent verification code to your email. Please don't forget to check your spam.`,
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
                        'Are you sure you want to resend verification code?'
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
                                URL.fromString(
                                    DASHBOARD_API_URL.toString()
                                ).addRoute(
                                    '/user-email/resend-verification-code'
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
                    title={`Code sent successfully`}
                    error={error}
                    description={`We have sent a verification code to your email. Please don't forget to check your spam.`}
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

export default Email;
