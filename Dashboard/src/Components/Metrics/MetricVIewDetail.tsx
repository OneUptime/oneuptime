import ObjectID from 'Common/Types/ObjectID';
import LineChart, {
    AxisType,
    XScalePrecision,
    XScaleType,
    YScaleType,
} from 'CommonUI/src/Components/Charts/Line/LineChart';
import FilterComponent from 'CommonUI/src/Components/Filters/FilterViewer';
import FilterData from 'CommonUI/src/Components/Filters/Types/FilterData';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import Metric from 'Model/AnalyticsModels/Metric';
import React, {
    Fragment,
    FunctionComponent,
    ReactElement,
    useEffect,
} from 'react';

export interface ComponentProps {
    metricName: string;
    serviceId: ObjectID;
    showFilterModal: boolean;
    onFilterModalClose: () => void;
    onFilterModalOpen: () => void;
}

const MetricViewDetail: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [filterData, setFilterData] = React.useState<FilterData<Metric>>({
        name: props.metricName,
        serviceId: props.serviceId,
    });

    // const [isLoading, setIsLoading] = React.useState<boolean>(true);

    // const [values, setValues] = React.useState<Metric[]>([]);

    useEffect(() => {}, []);

    return (
        <Fragment>
            <div>
                <FilterComponent<Metric>
                    id="metrics-filter"
                    initialFilterData={filterData}
                    showFilterModal={props.showFilterModal}
                    onFilterModalClose={() => {
                        props.onFilterModalClose();
                    }}
                    onFilterModalOpen={() => {
                        props.onFilterModalOpen();
                    }}
                    onFilterChanged={(filterData: FilterData<Metric>) => {
                        setFilterData(filterData);
                    }}
                    filters={[
                        {
                            key: 'name',
                            title: 'Name',
                            type: FieldType.Text,
                        },
                        {
                            key: 'createdAt',
                            title: 'Created At',
                            type: FieldType.Date,
                        },
                        {
                            key: 'serviceId',
                            title: 'Service',
                            type: FieldType.Dropdown,
                            filterDropdownOptions: [],
                        },
                    ]}
                />

                <LineChart
                    xScale={{
                        type: XScaleType.TIME,
                        max: 'auto',
                        min: 'auto',
                        precision: XScalePrecision.MINUTE,
                    }}
                    yScale={{
                        type: YScaleType.LINEAR,
                        min: 'auto',
                        max: 'auto',
                    }}
                    axisBottom={{
                        type: AxisType.Time,
                        legend: 'Time',
                    }}
                    axisLeft={{
                        type: AxisType.Number,
                        legend: 'Value',
                    }}
                    data={[
                        {
                            seriesName: props.metricName,
                            data: [{ x: new Date(), y: 0 }],
                        },
                    ]}
                />
            </div>
        </Fragment>
    );
};

export default MetricViewDetail;
