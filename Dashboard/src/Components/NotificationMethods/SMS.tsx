import UserSMS from 'Model/Models/UserSMS';
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

const SMS: FunctionComponent = (): ReactElement => {
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
            <ModelTable<UserSMS>
                modelType={UserSMS}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString(),
                }}
                refreshToggle={refreshToggle}
                onBeforeCreate={(model: UserSMS): UserSMS => {
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
                        icon: IconProp.SMS,
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
                id="user-sms"
                name="User Settings > Notification Methods > SMS"
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    title: 'Phone Numbers for SMS Notifications',
                    description:
                        'Manage Phone Numbers that will receive SMS notifications for this project.',
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
                showFilterButton={false}
                columns={[
                    {
                        field: {
                            phone: true,
                        },
                        title: 'Phone Number',
                        type: FieldType.Phone,
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
                    title={'Verify Phone Number'}
                    onClose={() => {
                        setShowVerificationCodeModal(false);
                    }}
                    isLoading={isLoading}
                    name="Verify Phone Number"
                    submitButtonText={'Verify'}
                    onSubmit={async (item: JSONObject) => {
                        setIsLoading(true);
                        try {
                            const response:
                                | HTTPResponse<JSONObject>
                                | HTTPErrorResponse = await API.post(
                                URL.fromString(
                                    DASHBOARD_API_URL.toString()
                                ).addRoute('/user-sms/verify'),
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
                                description: `We have sent a SMS with your verification code. Please don't forget to check your spam.`,
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
                                    '/user-sms/resend-verification-code'
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
                    description={`We have sent a verification code via SMS. Please don't forget to check your spam.`}
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

export default SMS;
