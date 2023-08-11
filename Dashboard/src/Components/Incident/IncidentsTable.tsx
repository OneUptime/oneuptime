import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import Incident from 'Model/Models/Incident';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import Pill from 'CommonUI/src/Components/Pill/Pill';
import Color from 'Common/Types/Color';
import Monitor from 'Model/Models/Monitor';
import MonitorsElement from '../../Components/Monitor/Monitors';
import IncidentState from 'Model/Models/IncidentState';
import Label from 'Model/Models/Label';
import LabelsElement from '../../Components/Label/Labels';
import IncidentSeverity from 'Model/Models/IncidentSeverity';
import Query from 'CommonUI/src/Utils/ModelAPI/Query';
import Route from 'Common/Types/API/Route';
import JSONFunctions from 'Common/Types/JSONFunctions';
import GlobalEvents from 'CommonUI/src/Utils/GlobalEvents';
import EventName from '../../Utils/EventName';
import DashboardNavigation from '../../Utils/Navigation';
import Team from 'Model/Models/Team';
import ProjectUser from '../../Utils/ProjectUser';
import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import IncidentTemplate from 'Model/Models/IncidentTemplate';
import IconProp from 'Common/Types/Icon/IconProp';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import API from 'CommonUI/src/Utils/API/API';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import IncidentTemplateOwnerUser from 'Model/Models/IncidentTemplateOwnerUser';
import IncidentTemplateOwnerTeam from 'Model/Models/IncidentTemplateOwnerTeam';
import ObjectID from 'Common/Types/ObjectID';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';

export interface ComponentProps {
    query?: Query<Incident> | undefined;
    viewPageRoute?: Route;
    noItemsMessage?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
}

const IncidentsTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [incidentTemplates, setIncidentTemplates] = useState<
        Array<IncidentTemplate>
    >([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [showIncidentTemplateModal, setShowIncidentTemplateModal] =
        useState<boolean>(false);
    const [initialValuesForIncident, setInitialValuesForIncident] =
        useState<JSONObject>({});

    const fetchIncidentTemplate: (id: ObjectID) => Promise<void> = async (
        id: ObjectID
    ): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            //fetch incident template

            const incidentTemplate: IncidentTemplate | null =
                await ModelAPI.getItem<IncidentTemplate>(IncidentTemplate, id, {
                    title: true,
                    description: true,
                    incidentSeverityId: true,
                    monitors: true,
                    onCallDutyPolicies: true,
                    labels: true,
                    changeMonitorStatusToId: true,
                });

            const teamsListResult: ListResult<IncidentTemplateOwnerTeam> =
                await ModelAPI.getList<IncidentTemplateOwnerTeam>(
                    IncidentTemplateOwnerTeam,
                    {
                        incidentTemplate: id,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        _id: true,
                        teamId: true,
                    },
                    {}
                );

            const usersListResult: ListResult<IncidentTemplateOwnerUser> =
                await ModelAPI.getList<IncidentTemplateOwnerUser>(
                    IncidentTemplateOwnerUser,
                    {
                        incidentTemplate: id,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        _id: true,
                        userId: true,
                    },
                    {}
                );

            if (incidentTemplate) {
                const initialValue: JSONObject = {
                    ...JSONFunctions.toJSONObject(
                        incidentTemplate,
                        IncidentTemplate
                    ),
                    incidentSeverity:
                        incidentTemplate.incidentSeverityId?.toString(),
                    monitors: incidentTemplate.monitors?.map(
                        (monitor: Monitor) => {
                            return monitor.id!.toString();
                        }
                    ),
                    labels: incidentTemplate.labels?.map((label: Label) => {
                        return label.id!.toString();
                    }),
                    changeMonitorStatusTo:
                        incidentTemplate.changeMonitorStatusToId?.toString(),
                    onCallDutyPolicies:
                        incidentTemplate.onCallDutyPolicies?.map(
                            (onCallPolicy: OnCallDutyPolicy) => {
                                return onCallPolicy.id!.toString();
                            }
                        ),
                    ownerUsers: usersListResult.data.map(
                        (user: IncidentTemplateOwnerUser): string => {
                            return user.userId!.toString() || '';
                        }
                    ),
                    ownerTeams: teamsListResult.data.map(
                        (team: IncidentTemplateOwnerTeam): string => {
                            return team.teamId!.toString() || '';
                        }
                    ),
                };

                setInitialValuesForIncident(initialValue);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
        setShowIncidentTemplateModal(false);
    };

    const fetchIncidentTemplates:  () => Promise<void> = async (): Promise<void> => {
        setError('');
        setIsLoading(true);
        setInitialValuesForIncident({});

        try {
            const listResult: ListResult<IncidentTemplate> =
                await ModelAPI.getList<IncidentTemplate>(
                    IncidentTemplate,
                    {},
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        templateName: true,
                        _id: true,
                    },
                    {}
                );

            setIncidentTemplates(listResult.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
    };

    return (
        <>
            <ModelTable<Incident>
                name="Incidents"
                onCreateEditModalClose={(): void => {
                    setInitialValuesForIncident({});
                }}
                modelType={Incident}
                id="incidents-table"
                isDeleteable={false}
                showCreateForm={
                    Object.keys(initialValuesForIncident).length > 0
                }
                onCreateSuccess={(incident: Incident): Promise<Incident> => {
                    GlobalEvents.dispatchEvent(
                        EventName.ACTIVE_INCIDENTS_COUNT_REFRESH
                    );

                    return Promise.resolve(incident);
                }}
                query={props.query || {}}
                isEditable={false}
                isCreateable={true}
                isViewable={true}
                createInitialValues={initialValuesForIncident}
                cardProps={{
                    title: props.title || 'Incidents',
                    buttons: [
                        {
                            title: 'Create from Template',
                            icon: IconProp.Template,
                            buttonStyle: ButtonStyleType.OUTLINE,
                            onClick: async (): Promise<void> => {
                                setShowIncidentTemplateModal(true);
                                await fetchIncidentTemplates();
                            },
                        },
                    ],
                    description:
                        props.description ||
                        'Here is a list of incidents for this project.',
                }}
                noItemsMessage={props.noItemsMessage || 'No incidents found.'}
                formSteps={[
                    {
                        title: 'Incident Details',
                        id: 'incident-details',
                    },
                    {
                        title: 'Resources Affected',
                        id: 'resources-affected',
                    },
                    {
                        title: 'On-Call',
                        id: 'on-call',
                    },
                    {
                        title: 'Owners',
                        id: 'owners',
                    },
                    {
                        title: 'Labels',
                        id: 'labels',
                    },
                ]}
                formFields={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        fieldType: FormFieldSchemaType.Text,
                        stepId: 'incident-details',
                        required: true,
                        placeholder: 'Incident Title',
                        validation: {
                            minLength: 2,
                        },
                    },
                    {
                        field: {
                            description: true,
                        },
                        title: 'Description',
                        stepId: 'incident-details',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                    },
                    {
                        field: {
                            incidentSeverity: true,
                        },
                        title: 'Incident Severity',
                        stepId: 'incident-details',
                        description: 'What type of incident is this?',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: IncidentSeverity,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Incident Severity',
                    },
                    {
                        field: {
                            monitors: true,
                        },
                        title: 'Monitors affected',
                        stepId: 'resources-affected',
                        description:
                            'Select monitors affected by this incident.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Monitor,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: true,
                        placeholder: 'Monitors affected',
                    },
                    {
                        field: {
                            onCallDutyPolicies: true,
                        },
                        title: 'On-Call Policy',
                        stepId: 'on-call',
                        description:
                            'Select on-call duty policy to execute when this incident is created.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: OnCallDutyPolicy,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select on-call policies',
                    },
                    {
                        field: {
                            changeMonitorStatusTo: true,
                        },
                        title: 'Change Monitor Status to ',
                        stepId: 'resources-affected',
                        description:
                            'This will change the status of all the monitors attached to this incident.',
                        fieldType: FormFieldSchemaType.Dropdown,
                        dropdownModal: {
                            type: MonitorStatus,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Monitor Status',
                    },
                    {
                        overrideField: {
                            ownerTeams: true,
                        },
                        forceShow: true,
                        title: 'Owner - Teams',
                        stepId: 'owners',
                        description:
                            'Select which teams own this incident. They will be notified when the incident is created or updated.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Team,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Select Teams',
                        overrideFieldKey: 'ownerTeams',
                    },
                    {
                        overrideField: {
                            ownerUsers: true,
                        },
                        forceShow: true,
                        title: 'Owner - Users',
                        stepId: 'owners',
                        description:
                            'Select which users own this incident. They will be notified when the incident is created or updated.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        fetchDropdownOptions: async () => {
                            return await ProjectUser.fetchProjectUsersAsDropdownOptions(
                                DashboardNavigation.getProjectId()!
                            );
                        },
                        required: false,
                        placeholder: 'Select Users',
                        overrideFieldKey: 'ownerUsers',
                    },
                    {
                        field: {
                            labels: true,
                        },

                        title: 'Labels ',
                        stepId: 'labels',
                        description:
                            'Team members with access to these labels will only be able to access this resource. This is optional and an advanced feature.',
                        fieldType: FormFieldSchemaType.MultiSelectDropdown,
                        dropdownModal: {
                            type: Label,
                            labelField: 'name',
                            valueField: '_id',
                        },
                        required: false,
                        placeholder: 'Labels',
                    },
                ]}
                showRefreshButton={true}
                showFilterButton={true}
                showViewIdButton={true}
                viewPageRoute={props.viewPageRoute}
                columns={[
                    {
                        field: {
                            title: true,
                        },
                        title: 'Title',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            currentIncidentState: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'State',
                        type: FieldType.Entity,
                        isFilterable: true,
                        filterEntityType: IncidentState,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['currentIncidentState']) {
                                return (
                                    <Pill
                                        isMinimal={true}
                                        color={
                                            (
                                                item[
                                                    'currentIncidentState'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'currentIncidentState'
                                                ] as JSONObject
                                            )['name'] as string
                                        }
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        field: {
                            incidentSeverity: {
                                name: true,
                                color: true,
                            },
                        },
                        isFilterable: true,
                        filterEntityType: IncidentSeverity,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        title: 'Severity',
                        type: FieldType.Entity,
                        getElement: (item: JSONObject): ReactElement => {
                            if (item['incidentSeverity']) {
                                return (
                                    <Pill
                                        isMinimal={true}
                                        color={
                                            (
                                                item[
                                                    'incidentSeverity'
                                                ] as JSONObject
                                            )['color'] as Color
                                        }
                                        text={
                                            (
                                                item[
                                                    'incidentSeverity'
                                                ] as JSONObject
                                            )['name'] as string
                                        }
                                    />
                                );
                            }

                            return <></>;
                        },
                    },
                    {
                        field: {
                            monitors: {
                                name: true,
                                _id: true,
                                projectId: true,
                            },
                        },
                        title: 'Monitors Affected',
                        type: FieldType.EntityArray,
                        isFilterable: true,
                        filterEntityType: Monitor,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <MonitorsElement
                                    monitors={
                                        JSONFunctions.fromJSON(
                                            (item['monitors'] as JSONArray) ||
                                                [],
                                            Monitor
                                        ) as Array<Monitor>
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        title: 'Created',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                    {
                        field: {
                            labels: {
                                name: true,
                                color: true,
                            },
                        },
                        title: 'Labels',
                        type: FieldType.EntityArray,
                        isFilterable: true,
                        filterEntityType: Label,
                        filterQuery: {
                            projectId:
                                DashboardNavigation.getProjectId()?.toString(),
                        },
                        filterDropdownField: {
                            label: 'name',
                            value: '_id',
                        },
                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <LabelsElement
                                    labels={
                                        JSONFunctions.fromJSON(
                                            (item['labels'] as JSONArray) || [],
                                            Label
                                        ) as Array<Label>
                                    }
                                />
                            );
                        },
                    },
                ]}
            />

            {incidentTemplates.length === 0 &&
                showIncidentTemplateModal &&
                !isLoading && (
                    <ConfirmModal
                        title={`No Incident Templates`}
                        description={`No incident templates have been created yet. You can create these in Project Settings > Incident Templates.`}
                        submitButtonText={'Close'}
                        onSubmit={() => {
                            return setShowIncidentTemplateModal(false);
                        }}
                    />
                )}

            {error && (
                <ConfirmModal
                    title={`Error`}
                    description={`${error}`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setError('');
                    }}
                />
            )}

            {showIncidentTemplateModal && incidentTemplates.length > 0 ? (
                <BasicFormModal<JSONObject>
                    title="Create Incident from Template"
                    isLoading={isLoading}
                    submitButtonText="Create from Template"
                    onClose={() => {
                        setShowIncidentTemplateModal(false);
                        setIsLoading(false);
                    }}
                    onSubmit={async (data: JSONObject) => {
                        await fetchIncidentTemplate(
                            data['incidentTemplateId'] as ObjectID
                        );
                    }}
                    formProps={{
                        initialValues: {},
                        fields: [
                            {
                                field: {
                                    incidentTemplateId: true,
                                },
                                title: 'Incident Template',
                                description:
                                    'Select an incident template to create an incident from.',
                                fieldType: FormFieldSchemaType.Dropdown,
                                dropdownOptions:
                                    DropdownUtil.getDropdownOptionsFromEntityArray(
                                        {
                                            array: incidentTemplates,
                                            labelField: 'templateName',
                                            valueField: '_id',
                                        }
                                    ),
                                required: true,
                                placeholder: 'Select Template',
                            },
                        ],
                    }}
                />
            ) : (
                <> </>
            )}
        </>
    );
};

export default IncidentsTable;
