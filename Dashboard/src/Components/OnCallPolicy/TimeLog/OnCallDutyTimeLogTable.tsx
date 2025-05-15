import React, { FunctionComponent, ReactElement, useEffect, useState } from "react";
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
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import RangeStartAndEndDateTime, { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/UI/Utils/BaseDatabase/ListResult";

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

    const [startAndEndDate, setStartAndEndDate] =
        useState<RangeStartAndEndDateTime>({
            range: TimeRange.PAST_ONE_MONTH,
        });

    const [timeLogs, setTimeLogs] = React.useState<OnCallDutyPolicyTimeLog[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState<boolean>(false);
    const [tableDataItems, setTableDataItems] = React.useState<TableDataItem[]>([]);


    const loadItems: PromiseVoidFunction = async () => {

        setLoading(true);
        setError(null);
        try {
            const pickedStartAndEndDate: InBetween<Date> = RangeStartAndEndDateTimeUtil.getStartAndEndDate(
                startAndEndDate,
            );

            const startDate: Date = pickedStartAndEndDate.startValue;

            const onCallDutyPolicyTimeLogs: ListResult<OnCallDutyPolicyTimeLog> =
                await ModelAPI.getList<OnCallDutyPolicyTimeLog>(
                    {
                        modelType: OnCallDutyPolicyTimeLog,
                        query: {
                            projectId: props.projectId,
                            startsAt: new GreaterThanOrEqual<Date>(startDate),
                            endsAt: new LessThanOrNull<Date>(startDate),
                        },
                        select: {
                            user: {
                                id: true,
                                name: true,
                                email: true,
                                profilePictureId: true,
                            },
                            startsAt: true,
                            endsAt: true,
                        },
                        skip: 0,
                        limit: LIMIT_MAX,
                        sort: {
                            startsAt: SortOrder.Ascending
                        }
                    }
                );

            const timeLogs: OnCallDutyPolicyTimeLog[] = onCallDutyPolicyTimeLogs.data;
            setTimeLogs(timeLogs);


            /// now we need to get the total time in minutes for each user, but we need to remove overlapping time logs
            const timeLogMap: Map<string, number> = new Map<string, number>();
            timeLogs.forEach((timeLog: OnCallDutyPolicyTimeLog) => {    
                const userId: string = timeLog.user!.id!.toString();
                const startDate: Date = timeLog.startsAt!;
                const endDate: Date = timeLog.endsAt || OneUptimeDate.getCurrentDate();

                if (timeLogMap.has(userId)) {
                    const totalTimeInMinutes: number = timeLogMap.get(userId) || 0;
                    const newTotalTimeInMinutes: number =
                        totalTimeInMinutes +
                        OneUptimeDate.getDifferenceInMinutes(startDate, endDate);
                    timeLogMap.set(userId, newTotalTimeInMinutes);
                } else {
                    timeLogMap.set(
                        userId,
                        OneUptimeDate.getDifferenceInMinutes(startDate, endDate),
                    );
                }
            });

            const tableDataItems: TableDataItem[] = [];
            timeLogMap.forEach((totalTimeInMinutesOnCall: number, userId: string) => {
                const user: User | undefined = timeLogs.find(
                    (timeLog: OnCallDutyPolicyTimeLog) => timeLog.user!.id!.toString() === userId,
                )?.user;
                if (user) {
                    tableDataItems.push({
                        user: user,
                        totalTimeInMinutesOnCall: totalTimeInMinutesOnCall,
                    });
                }
            });

            setTableDataItems(tableDataItems);


        } catch (error: unknown) {
            setError(BaseAPI.getFriendlyErrorMessage(error as Error));
        }
        setLoading(false);
    };

    useEffect(() => {
        loadItems().catch((error: Error) => {
            setError(error.message);
        });
    }, []);

    useEffect(() => {
        loadItems().catch((error: Error) => {
            setError(error.message);
        });
    }, [startAndEndDate]);


    if (error) {
        return <ErrorMessage message={error} />;
    }

    if (loading) {
        return <PageLoader isVisible={true} />;
    }

    return <div>
        <Card
            title={'On Call Time Log for Users'}
            description={'This table shows the time logs for users on call duty.'}
            rightElement={
                <RangeStartAndEndDateView
                    dashboardStartAndEndDate={startAndEndDate}
                    onChange={(startAndEndDate: RangeStartAndEndDateTime) => {
                        setStartAndEndDate(startAndEndDate);
                    }}
                />
            }
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
