import Route from 'Common/Types/API/Route';
import ModelPage from 'CommonUI/src/Components/Page/ModelPage';
import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageMap from '../../../Utils/PageMap';
import RouteMap, { RouteUtil } from '../../../Utils/RouteMap';
import PageComponentProps from '../../PageComponentProps';
import SideMenu from './SideMenu';
import DashboardNavigation from '../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import ModelTable, {
    ShowTableAs,
} from 'CommonUI/src/Components/ModelTable/ModelTable';
import BadDataException from 'Common/Types/Exception/BadDataException';
import FormFieldSchemaType from 'CommonUI/src/Components/Forms/Types/FormFieldSchemaType';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import { JSONObject } from 'Common/Types/JSON';
import UserElement from '../../../Components/User/User';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Navigation from 'CommonUI/src/Utils/Navigation';
import AlignItem from 'CommonUI/src/Types/AlignItem';
import { ModalWidth } from 'CommonUI/src/Components/Modal/Modal';
import Incident from 'Model/Models/Incident';
import IncidentNoteTemplate from 'Model/Models/IncidentNoteTemplate';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import API from 'CommonUI/src/Utils/API/API';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import IconProp from 'Common/Types/Icon/IconProp';
import { ButtonStyleType } from 'CommonUI/src/Components/Button/Button';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import BasicFormModal from 'CommonUI/src/Components/FormModal/BasicFormModal';
import ConfirmModal from 'CommonUI/src/Components/Modal/ConfirmModal';

const PublicNote: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const [incidentNoteTemplates, setIncidentNoteTemplates] = useState<
        Array<IncidentNoteTemplate>
    >([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string>('');
    const [showIncidentNoteTemplateModal, setShowIncidentNoteTemplateModal] =
        useState<boolean>(false);
    const [initialValuesForIncident, setInitialValuesForIncident] =
        useState<JSONObject>({});

    const fetchIncidentNoteTemplate: (id: ObjectID) => Promise<void> = async (
        id: ObjectID
    ): Promise<void> => {
        setError('');
        setIsLoading(true);

        try {
            //fetch incident template

            const incidentNoteTemplate: IncidentNoteTemplate | null =
                await ModelAPI.getItem<IncidentNoteTemplate>(
                    IncidentNoteTemplate,
                    id,
                    {
                        note: true,
                    }
                );

            if (incidentNoteTemplate) {
                const initialValue: JSONObject = {
                    ...JSONFunctions.toJSONObject(
                        incidentNoteTemplate,
                        IncidentNoteTemplate
                    ),
                };

                setInitialValuesForIncident(initialValue);
            }
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setIsLoading(false);
        setShowIncidentNoteTemplateModal(false);
    };

    const fetchIncidentNoteTemplates: () => Promise<void> =
        async (): Promise<void> => {
            setError('');
            setIsLoading(true);
            setInitialValuesForIncident({});

            try {
                const listResult: ListResult<IncidentNoteTemplate> =
                    await ModelAPI.getList<IncidentNoteTemplate>(
                        IncidentNoteTemplate,
                        {},
                        LIMIT_PER_PROJECT,
                        0,
                        {
                            templateName: true,
                            _id: true,
                        },
                        {}
                    );

                setIncidentNoteTemplates(listResult.data);
            } catch (err) {
                setError(API.getFriendlyMessage(err));
            }

            setIsLoading(false);
        };

    return (
        <ModelPage
            title="Incident"
            modelType={Incident}
            modelId={modelId}
            modelNameField="title"
            breadcrumbLinks={[
                {
                    title: 'Project',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.HOME] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENTS] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'View Incident',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_VIEW] as Route,
                        { modelId }
                    ),
                },
                {
                    title: 'Public Notes',
                    to: RouteUtil.populateRouteParams(
                        RouteMap[PageMap.INCIDENT_PUBLIC_NOTE] as Route,
                        { modelId }
                    ),
                },
            ]}
            sideMenu={<SideMenu modelId={modelId} />}
        >
            <ModelTable<IncidentPublicNote>
                modelType={IncidentPublicNote}
                id="table-incident-internal-note"
                name="Monitor > Public Note"
                isDeleteable={true}
                showCreateForm={
                    Object.keys(initialValuesForIncident).length > 0
                }
                createInitialValues={initialValuesForIncident}
                isCreateable={true}
                showViewIdButton={true}
                isEditable={true}
                createEditModalWidth={ModalWidth.Large}
                isViewable={false}
                query={{
                    incidentId: modelId,
                    projectId: DashboardNavigation.getProjectId()?.toString(),
                }}
                onBeforeCreate={(
                    item: IncidentPublicNote
                ): Promise<IncidentPublicNote> => {
                    if (!props.currentProject || !props.currentProject._id) {
                        throw new BadDataException('Project ID cannot be null');
                    }
                    item.incidentId = modelId;
                    item.projectId = new ObjectID(props.currentProject._id);
                    return Promise.resolve(item);
                }}
                cardProps={{
                    title: 'Public Notes',
                    buttons: [
                        {
                            title: 'Create from Template',
                            icon: IconProp.Template,
                            buttonStyle: ButtonStyleType.OUTLINE,
                            onClick: async (): Promise<void> => {
                                setShowIncidentNoteTemplateModal(true);
                                await fetchIncidentNoteTemplates();
                            },
                        },
                    ],
                    description:
                        'Here are public notes for this incident. This will show up on the status page.',
                }}
                noItemsMessage={
                    'No public notes created for this incident so far.'
                }
                formFields={[
                    {
                        field: {
                            note: true,
                        },
                        title: 'Public Incident Note',
                        fieldType: FormFieldSchemaType.Markdown,
                        required: true,
                        description:
                            'This note is visible on your Status Page. This is in Markdown.',
                    },
                ]}
                showTableAs={ShowTableAs.List}
                showRefreshButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            createdByUser: {
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                        },
                        title: '',

                        type: FieldType.Entity,
                        isFilterable: true,

                        getElement: (item: JSONObject): ReactElement => {
                            return (
                                <UserElement
                                    user={
                                        JSONFunctions.fromJSON(
                                            item['createdByUser'] as JSONObject,
                                            User
                                        ) as User
                                    }
                                    suffix={'wrote'}
                                    usernameClassName={
                                        'text-base text-gray-900'
                                    }
                                    suffixClassName={
                                        'text-base text-gray-500 mt-1'
                                    }
                                />
                            );
                        },
                    },
                    {
                        field: {
                            createdAt: true,
                        },
                        isFilterable: true,
                        alignItem: AlignItem.Right,
                        title: '',
                        type: FieldType.DateTime,
                        contentClassName:
                            'mt-1 whitespace-nowrap text-sm text-gray-600 sm:mt-0 sm:ml-3 text-right',
                    },
                    {
                        field: {
                            note: true,
                        },
                        isFilterable: true,
                        title: '',
                        type: FieldType.Markdown,
                        contentClassName:
                            '-mt-3 space-y-6 text-sm text-gray-800',
                        colSpan: 2,
                    },
                ]}
            />

            {incidentNoteTemplates.length === 0 &&
            showIncidentNoteTemplateModal &&
            !isLoading ? (
                <ConfirmModal
                    title={`No Incident Note Templates`}
                    description={`No incident note templates have been created yet. You can create these in Project Settings > Incident > Note Templates.`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setShowIncidentNoteTemplateModal(false);
                    }}
                />
            ) : (
                <></>
            )}

            {error ? (
                <ConfirmModal
                    title={`Error`}
                    description={`${error}`}
                    submitButtonText={'Close'}
                    onSubmit={() => {
                        return setError('');
                    }}
                />
            ) : (
                <></>
            )}

            {showIncidentNoteTemplateModal &&
            incidentNoteTemplates.length > 0 ? (
                <BasicFormModal<JSONObject>
                    title="Create Note from Template"
                    isLoading={isLoading}
                    submitButtonText="Create from Template"
                    onClose={() => {
                        setShowIncidentNoteTemplateModal(false);
                        setIsLoading(false);
                    }}
                    onSubmit={async (data: JSONObject) => {
                        await fetchIncidentNoteTemplate(
                            data['incidentNoteTemplateId'] as ObjectID
                        );
                    }}
                    formProps={{
                        initialValues: {},
                        fields: [
                            {
                                field: {
                                    incidentNoteTemplateId: true,
                                },
                                title: 'Select Note Template',
                                description:
                                    'Select a template to create a note from.',
                                fieldType: FormFieldSchemaType.Dropdown,
                                dropdownOptions:
                                    DropdownUtil.getDropdownOptionsFromEntityArray(
                                        {
                                            array: incidentNoteTemplates,
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
        </ModelPage>
    );
};

export default PublicNote;
