import Route from 'Common/Types/API/Route';
import Page from 'CommonUI/src/Components/Page/Page';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageMap from '../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageComponentProps from '../PageComponentProps';
import DashboardSideMenu from './SideMenu';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import DashboardNavigation from '../../Utils/Navigation';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import API from 'CommonUI/src/Utils/API/API';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import User from 'CommonUI/src/Utils/User';
import UserNotificationRule from 'Model/Models/UserNotificationRule';
import UserCall from 'Model/Models/UserCall';
import UserEmail from 'Model/Models/UserEmail';
import UserSMS from 'Model/Models/UserSMS';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import BaseModel from 'Common/Models/BaseModel';
import NotifyAfterDropdownOptions from '../../Components/NotificationRule/NotifyAfterMinutesDropdownOptions';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
import SortOrder from 'Common/Types/Database/SortOrder';
import NotificationMethodView from '../../Components/NotificationMethods/NotificationMethod';
import JSONFunctions from 'Common/Types/JSONFunctions';

const Settings: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const [error, setError] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [incidentSeverities, setIncidentSeverities] = useState<
        Array<IncidentSeverity>
    >([]);
    const [userEmails, setUserEmails] = useState<Array<UserEmail>>([]);
    const [userSMSs, setUserSMSs] = useState<Array<UserSMS>>([]);
    const [userCalls, setUserCalls] = useState<Array<UserCall>>([]);
    const [
        notificationMethodsDropdownOptions,
        setNotificationMethodsDropdownOptions,
    ] = useState<Array<DropdownOption>>([]);

    const getModelTable: Function = (options: {
        incidentSeverity?: IncidentSeverity;
        ruleType: NotificationRuleType;
        title: string;
        description: string;
    }): ReactElement => {
        return (
            <ModelTable<UserNotificationRule>
                modelType={UserNotificationRule}
                query={{
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                    userId: User.getUserId().toString(),
                    ruleType: options.ruleType,
                    incidentSeverityId:
                        options.incidentSeverity?.id?.toString() || undefined,
                }}
                onBeforeCreate={(
                    model: UserNotificationRule,
                    miscDataProps: JSONObject
                ): Promise<UserNotificationRule> => {
                    model.projectId = DashboardNavigation.getProjectId()!;
                    model.userId = User.getUserId();
                    model.ruleType = options.ruleType;
                    if (options.incidentSeverity?.id) {
                        model.incidentSeverityId = options.incidentSeverity?.id;
                    }

                    if (miscDataProps['notificationMethod']) {
                        const userEmail: UserEmail | undefined =
                            userEmails.find((userEmail: UserEmail) => {
                                return (
                                    userEmail.id!.toString() ===
                                    miscDataProps[
                                        'notificationMethod'
                                    ]?.toString()
                                );
                            });

                        if (userEmail) {
                            model.userEmailId = userEmail.id!;
                        }

                        const userSMS: UserSMS | undefined = userSMSs.find(
                            (userSMS: UserSMS) => {
                                return (
                                    userSMS.id!.toString() ===
                                    miscDataProps[
                                        'notificationMethod'
                                    ]?.toString()
                                );
                            }
                        );

                        if (userSMS) {
                            model.userSmsId = userSMS.id!;
                        }

                        const userCall: UserCall | undefined = userCalls.find(
                            (userCall: UserCall) => {
                                return (
                                    userCall.id!.toString() ===
                                    miscDataProps[
                                        'notificationMethod'
                                    ]?.toString()
                                );
                            }
                        );

                        if (userCall) {
                            model.userCallId = userCall.id!;
                        }
                    }

                    return Promise.resolve(model);
                }}
                sortOrder={SortOrder.Ascending}
                sortBy="notifyAfterMinutes"
                createVerb={'Add'}
                id="notification-rules"
                name={`User Settings > Notification Rules > ${
                    options.incidentSeverity?.name || options.ruleType
                }`}
                isDeleteable={true}
                isEditable={false}
                isCreateable={true}
                cardProps={{
                    title: options.title,
                    description: options.description,
                }}
                noItemsMessage={
                    'No notification rules found. Please add one to receive notifications.'
                }
                formFields={[
                    {
                        overrideField: {
                            notificationMethod: true,
                        },
                        forceShow: true,
                        overrideFieldKey: 'notificationMethod',
                        title: 'Notification Method',
                        description: 'How do you want to be notified?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Notification Method',
                        dropdownOptions: notificationMethodsDropdownOptions,
                    },
                    {
                        field: {
                            notifyAfterMinutes: true,
                        },
                        title: 'Notify me after',
                        fieldType: FormFieldSchemaType.Dropdown,
                        required: true,
                        placeholder: 'Immediately',
                        dropdownOptions: NotifyAfterDropdownOptions,
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={false}
                selectMoreFields={{
                    userEmail: {
                        email: true,
                    },
                    userSms: {
                        phone: true,
                    },
                }}
                columns={[
                    {
                        field: {
                            userCall: {
                                phone: true,
                            },
                        },
                        title: 'Notification Method',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <NotificationMethodView
                                    item={item}
                                    modelType={UserNotificationRule}
                                />
                            );
                        },
                        isFilterable: false,
                    },
                    {
                        field: {
                            notifyAfterMinutes: true,
                        },
                        title: 'Notify After',
                        type: FieldType.Text,
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <div>
                                    {item['notifyAfterMinutes'] === 0 && (
                                        <p>Immediately</p>
                                    )}
                                    {(item['notifyAfterMinutes'] as number) >
                                        0 && (
                                        <p>
                                            {
                                                item[
                                                    'notifyAfterMinutes'
                                                ] as number
                                            }{' '}
                                            minutes
                                        </p>
                                    )}
                                </div>
                            );
                        },
                    },
                ]}
            />
        );
    };

    const init: Function = async (): Promise<void> => {
        // Ping an API here.
        setError('');
        setIsLoading(true);

        try {
            const incidentSeverities: ListResult<IncidentSeverity> =
                await ModelAPI.getList(
                    IncidentSeverity,
                    {
                        projectId: DashboardNavigation.getProjectId(),
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        name: true,
                    },
                    {}
                );

            const userEmails: ListResult<UserEmail> = await ModelAPI.getList(
                UserEmail,
                {
                    projectId: DashboardNavigation.getProjectId(),
                    userId: User.getUserId(),
                    isVerified: true,
                },
                LIMIT_PER_PROJECT,
                0,
                {
                    email: true,
                },
                {}
            );

            setUserEmails(userEmails.data);

            const userSMSes: ListResult<UserSMS> = await ModelAPI.getList(
                UserSMS,
                {
                    projectId: DashboardNavigation.getProjectId(),
                    userId: User.getUserId(),
                    isVerified: true,
                },
                LIMIT_PER_PROJECT,
                0,
                {
                    phone: true,
                },
                {}
            );

            setUserSMSs(userSMSes.data);

            const userCalls: ListResult<UserCall> = await ModelAPI.getList(
                UserCall,
                {
                    projectId: DashboardNavigation.getProjectId(),
                    userId: User.getUserId(),
                    isVerified: true,
                },
                LIMIT_PER_PROJECT,
                0,
                {
                    phone: true,
                },
                {}
            );

            setUserCalls(userCalls.data);

            setIncidentSeverities(incidentSeverities.data);

            const dropdownOptions: Array<DropdownOption> = [
                ...userCalls.data,
                ...userEmails.data,
                ...userSMSes.data,
            ].map((model: BaseModel) => {
                const isUserCall: boolean = model instanceof UserCall;
                const isUserSms: boolean = model instanceof UserSMS;

                const option: DropdownOption = {
                    label: model.getColumnValue('phone')
                        ? model.getColumnValue('phone')?.toString()!
                        : model.getColumnValue('email')?.toString()!,
                    value: model.id!.toString(),
                };

                if (isUserCall) {
                    option.label = 'Call: ' + option.label;
                } else if (isUserSms) {
                    option.label = 'SMS: ' + option.label;
                } else {
                    option.label = 'Email: ' + option.label;
                }

                return option;
            });

            setNotificationMethodsDropdownOptions(dropdownOptions);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    useEffect(() => {
        init().catch((err: Error) => {
            setError(err.toString());
        });
    }, []);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Page
            title={'User Settings'}
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route
                    ),
                },
                {
                    title: 'User Settings',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_SETTINGS] as Route
                    ),
                },
                {
                    title: 'Notification Rules',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.USER_SETTINGS_ON_CALL_RULES] as Route
                    ),
                },
            ]}
            sideMenu={<DashboardSideMenu />}
        >
            <div>
                {incidentSeverities.map(
                    (incidentSeverity: IncidentSeverity, i: number) => {
                        return (
                            <div key={i}>
                                {getModelTable({
                                    incidentSeverity: incidentSeverity,
                                    ruleType:
                                        NotificationRuleType.ON_CALL_INCIDENT_CREATED,
                                    title:
                                        'When I am on call and ' +
                                        incidentSeverity.name +
                                        ' is assigned to me...',
                                    description:
                                        'Here are the rules when you are on call and ' +
                                        incidentSeverity.name +
                                        ' is assigned to you.',
                                })}
                            </div>
                        );
                    }
                )}
            </div>

            {/* <div>
                {getModelTable({
                    incidentSeverity: undefined,
                    ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
                    title: 'When I go on call...',
                    description:
                        'Here are the rules to notify you when you go on call.',
                })}
            </div>

            <div>
                {getModelTable({
                    incidentSeverity: undefined,
                    ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
                    title: 'When I go off call...',
                    description:
                        'Here are the rules to notify you when you go off call.',
                })}
            </div> */}
        </Page>
    );
};

export default Settings;
