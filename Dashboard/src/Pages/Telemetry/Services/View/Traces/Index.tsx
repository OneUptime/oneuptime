import React, { Fragment, FunctionComponent, ReactElement } from 'react';
import PageComponentProps from '../../../../PageComponentProps';
import ModelTable from 'CommonUI/src/Components/ModelTable/ModelTable';
import Span from 'Model/AnalyticsModels/Span';
import Navigation from 'CommonUI/src/Utils/Navigation';
import FieldType from 'CommonUI/src/Components/Types/FieldType';

const TracesList: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    return (
        <Fragment>
            <ModelTable<Span>
                modelType={Span}
                id="traces-table"
                isDeleteable={false}
                isEditable={false}
                isCreateable={false}
                name="Status Pages"
                isViewable={true}
                cardProps={{
                    title: 'Traces',
                    description:
                        'Traces are the individual spans that make up a request. They are the building blocks of a trace and represent the work done by a single service.',
                }}
                showViewIdButton={true}
                noItemsMessage={'No traces found for this service.'}
                showRefreshButton={true}
                showFilterButton={true}
                viewPageRoute={Navigation.getCurrentRoute()}
                columns={[
                    {
                        field: {
                            name: true,
                        },
                        title: 'Name',
                        type: FieldType.Text,
                        isFilterable: true,
                    }
                ]}
            />
        </Fragment>
    );
};

export default TracesList;
