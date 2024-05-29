import SpanStatusElement from '../../../../../Components/Span/SpanStatusElement';
import DashboardNavigation from '../../../../../Utils/Navigation';
import PageComponentProps from '../../../../PageComponentProps';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import ObjectID from 'Common/Types/ObjectID';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import AnalyticsModelTable from 'CommonUI/src/Components/ModelTable/AnalyticsModelTable';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Span, { SpanKind, SpanStatus } from 'Model/AnalyticsModels/Span';
import React, { Fragment, FunctionComponent, ReactElement } from 'react';

const TracesList: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const spanKindDropdownOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(SpanKind);

    return (
        <Fragment>
            <AnalyticsModelTable<Span>
                modelType={Span}
                id="traces-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                singularName="Trace"
                pluralName="Traces"
                name="Traces"
                isViewable={true}
                cardProps={{
                    title: 'Traces',
                    description:
                        'Traces are the individual spans that make up a request. They are the building blocks of a trace and represent the work done by a single service.',
                }}
                query={{
                    projectId: DashboardNavigation.getProjectId(),
                    serviceId: modelId,
                }}
                showViewIdButton={true}
                noItemsMessage={'No traces found for this service.'}
                showRefreshButton={true}
                sortBy="startTime"
                sortOrder={SortOrder.Descending}
                viewPageRoute={Navigation.getCurrentRoute()}
                filters={[
                    {
                        field: {
                            traceId: true,
                        },
                        type: FieldType.Text,
                        title: 'Trace ID',
                    },
                    {
                        field: {
                            statusCode: true,
                        },
                        type: FieldType.Dropdown,
                        filterDropdownOptions:
                            DropdownUtil.getDropdownOptionsFromEnum(
                                SpanStatus,
                                true
                            ).filter((dropdownOption: DropdownOption) => {
                                return (
                                    dropdownOption.label === 'Unset' ||
                                    dropdownOption.label === 'Ok' ||
                                    dropdownOption.label === 'Error'
                                );
                            }),
                        title: 'Span Status',
                    },
                    {
                        field: {
                            name: true,
                        },
                        type: FieldType.Text,
                        title: 'Root Span Name',
                    },
                    {
                        field: {
                            kind: true,
                        },
                        type: FieldType.Text,
                        title: 'Root Span Kind',
                        filterDropdownOptions: spanKindDropdownOptions,
                    },
                    {
                        field: {
                            startTime: true,
                        },
                        type: FieldType.Date,
                        title: 'Seen At',
                    },
                    {
                        field: {
                            attributes: true,
                        },
                        type: FieldType.JSON,
                        title: 'Attributes',
                    },
                ]}
                selectMoreFields={{
                    statusCode: true,
                }}
                columns={[
                    {
                        field: {
                            traceId: true,
                        },
                        title: 'Span ID',
                        type: FieldType.Element,
                        getElement: (span: Span): ReactElement => {
                            return (
                                <Fragment>
                                    <SpanStatusElement
                                        span={span}
                                        title={span.traceId?.toString()}
                                    />
                                </Fragment>
                            );
                        },
                    },
                    {
                        field: {
                            name: true,
                        },
                        title: 'Span Name',
                        type: FieldType.Text,
                    },
                    {
                        field: {
                            startTime: true,
                        },
                        title: 'Seen At',
                        type: FieldType.DateTime,
                    },
                ]}
            />
        </Fragment>
    );
};

export default TracesList;
