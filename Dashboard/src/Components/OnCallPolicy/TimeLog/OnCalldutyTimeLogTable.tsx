import React, { FunctionComponent, ReactElement, useEffect } from "react";
import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyTimeLog from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import User from "Common/Models/DatabaseModels/User";
import FieldType from "Common/UI/Components/Types/FieldType";
import UserElement from "../../User/User";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";

export interface ComponentProps {
    projectId: ObjectID;
}


export interface TableDataItem {
    user: User; 
    totalTimeInMinutesOnCall: number;
}

const OnCallPolicyLogTable: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {

    const [startAndEndTime, setStartAndEndTime] = React.useState<InBetween<Date>>(new InBetween<Date>(OneUptimeDate.getSomeDaysAgo(30), OneUptimeDate.getCurrentDate()));
    const [timeLogs, setTimeLogs] = React.useState<OnCallDutyPolicyTimeLog[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [tableDataItems, setTableDataItems] = React.useState<TableDataItem[]>([]);


    const loadItems: PromiseVoidFunction = async () => {

    }

    useEffect(() => {


    }, []);


    if(error){
        return <ErrorMessage message={error} />;
    }

    if (loading) {
        return <PageLoader isVisible={true}/>;
    }

    return <div>
            <Card
            title={'On Call Time Log for Users'}
            description={'This table shows the time logs for users on call duty.'}
            rightElement={}
        > 
        <LocalTable 
            singularLabel="On Call Policy Time Log"
            pluralLabel="On Call Policy Time Logs"
            data={tableDataItems}
            id="on-call-policy-log-table"
            columns={[
                {
                    title: "User",
                    type: FieldType.Element,
                    key: "user",
                    getElement: (item: TableDataItem) => {
                        return <UserElement user={item.user} />;
                    }
                },
                {
                    title: "Time on Call",
                    type: FieldType.Minutes,
                    key: "totalTimeInMinutesOnCall"
                },
            ]}
        /> 
        </Card>

    </div>
};

export default OnCallPolicyLogTable;
