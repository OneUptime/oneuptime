import Navigation from 'CommonUI/src/Utils/Navigation';
import React, { Fragment, FunctionComponent, ReactElement, useEffect } from 'react';
import PageComponentProps from '../../../../../PageComponentProps';
import FiltersForm from 'CommonUI/src/Components/Filters/FiltersForm';
import Metric from 'Model/AnalyticsModels/Metric';
import FieldType from 'CommonUI/src/Components/Types/FieldType';
import FilterData from 'CommonUI/src/Components/Filters/Types/FilterData';
import ObjectID from 'Common/Types/ObjectID';
import LineChart, { AxisType, XScalePrecision, XScaleType, YScaleType } from 'CommonUI/src/Components/Charts/Line/LineChart';

const MonitorDelete: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {
    const metricName: string = Navigation.getLastParamAsString();
    const serviceId: ObjectID = Navigation.getLastParamAsObjectID(2);

    const [filterData, setFilterData] = React.useState<FilterData<Metric>>({
        name: metricName,
        serviceId: serviceId,
    });

    const [isLoading, setIsLoading] = React.useState<boolean>(true);

    const [values, setValues] = React.useState<Metric[]>([]);

    useEffect(() => {   

    }, []);

    return (
        <Fragment>
            <div>
                <FiltersForm<Metric>
                    showFilter={true}
                    id="metrics-filter"
                    filterData={filterData}
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
                            filterDropdownOptions: []
                        }
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
                    data={[{
                        seriesName: metricName,
                        data: [{ x: new Date(), y: 0 }]
                    }]}
                />
            </div>
        </Fragment>
    );
};

export default MonitorDelete;
