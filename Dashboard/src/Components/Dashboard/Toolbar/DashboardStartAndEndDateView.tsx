import React, { FunctionComponent, ReactElement } from "react";
import DashboardStartAndEndDate from "../Types/DashboardStartAndEndDate";
import DashboardStartAndEndDateRange from "../Types/DashboardStartAndEndDateRange";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { GetReactElementFunction } from "Common/UI/Types/FunctionTypes";
import HeaderAlert, { HeaderAlertType } from "Common/UI/Components/HeaderAlert/HeaderAlert";
import ColorSwatch from "Common/Types/ColorSwatch";

export interface ComponentProps {
    dashboardStartAndEndDate: DashboardStartAndEndDate;
    onClick: () => void;
}

const DashboardStartAndEndDateView: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {
    const isCustomRange: boolean =
        props.dashboardStartAndEndDate.range ===
        DashboardStartAndEndDateRange.CUSTOM;

    const getContent: GetReactElementFunction = (): ReactElement => {

        const title: string = isCustomRange ? `${OneUptimeDate.getDateAsLocalFormattedString(
            props.dashboardStartAndEndDate.startAndEndDate?.startValue ||
            OneUptimeDate.getCurrentDate(),
        )} - ${OneUptimeDate.getDateAsLocalFormattedString(
            props.dashboardStartAndEndDate.startAndEndDate?.endValue ||
            OneUptimeDate.getCurrentDate(),
        )}` : props.dashboardStartAndEndDate.range

        return (
            <HeaderAlert
                icon={IconProp.Clock}
                onClick={props.onClick}
                title={title}
                alertType={HeaderAlertType.INFO}
                colorSwatch={ColorSwatch.Blue}
                tooltip="Click to change the date and time range of data on this dashboard."
            />
        );

    };

    return (
    <div>
        {getContent()}
    </div>
  );
};

export default DashboardStartAndEndDateView;
