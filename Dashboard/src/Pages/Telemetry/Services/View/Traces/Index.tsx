import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import AnalyticsModelTable from 'CommonUI/src/Components/ModelTable/AnalyticsModelTable';
import Span, { SpanKind } from 'Model/AnalyticsModels/Span';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Navigation from 'CommonUI/src/Utils/Navigation';
import DashboardNavigation from '../../../../../Utils/Navigation';
import ObjectID from 'Common/Types/ObjectID';
import IsNull from 'Common/Types/BaseDatabase/IsNull';
import SortOrder from 'Common/Types/BaseDatabase/SortOrder';
import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import { JSONObject } from 'Common/Types/JSON';
import SpanUtil from '../../../../../Utils/SpanUtil';

const TracesList: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

    const spanKindDropdownOptions: Array<DropdownOption> =
        DropdownUtil.getDropdownOptionsFromEnum(SpanKind, true);

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
                    parentSpanId: new IsNull(),
                }}
                showViewIdButton={true}
                noItemsMessage={'No traces found for this service.'}
                showRefreshButton={true}
                showFilterButton={true}
                sortBy="startTime"
                sortOrder={SortOrder.Descending}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            traceId: true,
                        },
                        title: 'Trace ID',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            name: true,
                        },
                        title: 'Root Span Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    },
                    {
                        field: {
                            kind: true,
                        },
                        title: 'Root Span Kind',
                        type: FieldType.Text,
                        filterDropdownOptions: spanKindDropdownOptions,
                        isFilterable: true,
                        getElement: (span: JSONObject): ReactElement => {
                            const spanKind: SpanKind = span['kind'] as SpanKind;

                            const spanKindText: string =
                                SpanUtil.getSpanKindFriendlyName(spanKind);

                            return <span>{spanKindText}</span>;
                        },
                    },
                    {
                        field: {
                            startTime: true,
                        },
                        title: 'Seen At',
                        type: FieldType.DateTime,
                        isFilterable: true,
                    },
                ]}
            />
        </Fragment>
    );
};

export default TracesList;
