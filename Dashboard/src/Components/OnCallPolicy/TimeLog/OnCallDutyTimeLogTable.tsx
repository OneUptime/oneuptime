import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
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
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import BaseAPI from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import LessThan from "Common/Types/BaseDatabase/LessThan";
import GreaterThanOrNull from "Common/Types/BaseDatabase/GreaterThanOrNull";

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

  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [tableDataItems, setTableDataItems] = React.useState<TableDataItem[]>(
    [],
  );

  const loadItems: PromiseVoidFunction = async () => {
    setLoading(true);
    setError(null);
    try {
      const pickedStartAndEndDate: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate(startAndEndDate);

      const startDate: Date = pickedStartAndEndDate.startValue;
      const endDate: Date = pickedStartAndEndDate.endValue;

      const onCallDutyPolicyTimeLogsStartsAt: ListResult<OnCallDutyPolicyTimeLog> =
        await ModelAPI.getList<OnCallDutyPolicyTimeLog>({
          modelType: OnCallDutyPolicyTimeLog,
          query: {
            projectId: props.projectId,
            startsAt: new LessThan<Date>(endDate),
          },
          select: {
            user: {
              _id: true,
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
            startsAt: SortOrder.Ascending,
          },
        });

      const onCallDutyPolicyTimeLogsEndsAt: ListResult<OnCallDutyPolicyTimeLog> =
        await ModelAPI.getList<OnCallDutyPolicyTimeLog>({
          modelType: OnCallDutyPolicyTimeLog,
          query: {
            projectId: props.projectId,
            endsAt: new GreaterThanOrNull<Date>(startDate),
          },
          select: {
            user: {
              _id: true,
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
            startsAt: SortOrder.Ascending,
          },
        });

      // Extract time logs from the API response
      const timeLogs: OnCallDutyPolicyTimeLog[] = [
        ...onCallDutyPolicyTimeLogsStartsAt.data,
        ...onCallDutyPolicyTimeLogsEndsAt.data,
      ];

      // Group time logs by user ID
      const userTimeLogs: Map<string, OnCallDutyPolicyTimeLog[]> = new Map();
      timeLogs.forEach((timeLog: OnCallDutyPolicyTimeLog) => {
        const userId: string = timeLog.user!.id!.toString();
        if (!userTimeLogs.has(userId)) {
          userTimeLogs.set(userId, []);
        }
        userTimeLogs.get(userId)!.push(timeLog);
      });

      // Process each user's time logs to calculate total time on call (accounting for overlaps)
      const timeLogMap: Map<string, number> = new Map<string, number>();
      const userMap: Map<string, User> = new Map<string, User>();

      userTimeLogs.forEach(
        (logs: OnCallDutyPolicyTimeLog[], userId: string) => {
          // Store user object for later use
          if (logs.length > 0) {
            userMap.set(userId, logs[0]!.user!);
          }

          // Sort logs by start time to properly handle overlaps
          logs.sort(
            (a: OnCallDutyPolicyTimeLog, b: OnCallDutyPolicyTimeLog) => {
              return a.startsAt!.getTime() - b.startsAt!.getTime();
            },
          );

          // Merge overlapping time periods
          const mergedPeriods: Array<{ start: Date; end: Date }> = [];

          logs.forEach((log: OnCallDutyPolicyTimeLog) => {
            let startDate: Date = log.startsAt!;
            let endDate: Date = log.endsAt || OneUptimeDate.getCurrentDate();

            // if end date is mroe than the end date selected in the range, then
            // set the end date to the end date selected in the range
            if (
              OneUptimeDate.isAfter(endDate, pickedStartAndEndDate.endValue)
            ) {
              endDate = pickedStartAndEndDate.endValue;
            }

            // if start date is less than the start date selected in the range, then
            // set the start date to the start date selected in the range

            if (
              OneUptimeDate.isBefore(
                startDate,
                pickedStartAndEndDate.startValue,
              )
            ) {
              startDate = pickedStartAndEndDate.startValue;
            }

            // Check if we should create a new period or extend an existing one
            if (
              mergedPeriods.length === 0 ||
              startDate.getTime() >
                mergedPeriods[mergedPeriods.length - 1]!.end.getTime()
            ) {
              // No overlap - add as a new period
              mergedPeriods.push({ start: startDate, end: endDate });
            } else {
              // Overlapping with the last period - extend the end time if necessary
              const lastPeriod:
                | {
                    start: Date;
                    end: Date;
                  }
                | undefined = mergedPeriods[mergedPeriods.length - 1];
              if (endDate.getTime() > lastPeriod!.end.getTime()) {
                lastPeriod!.end = endDate;
              }
            }
          });

          // Calculate total minutes from merged periods (no double counting)
          let totalMinutes: number = 0;
          mergedPeriods.forEach((period: { start: Date; end: Date }) => {
            totalMinutes += OneUptimeDate.getDifferenceInMinutes(
              period.start,
              period.end,
            );
          });

          timeLogMap.set(userId, totalMinutes);
        },
      );

      // Convert the results to the table data format
      const tableDataItems: TableDataItem[] = [];
      timeLogMap.forEach((totalTimeInMinutesOnCall: number, userId: string) => {
        const user: User | undefined = userMap.get(userId);
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

  return (
    <div>
      <Card
        title={"On Call Time Log for Users"}
        description={"This table shows the time logs for users on call duty."}
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
              },
            },
            {
              title: "Time user was on call",
              type: FieldType.Minutes,
              key: "totalTimeInMinutesOnCall",
              getElement: (item: TableDataItem) => {
                return (
                  <span>
                    {OneUptimeDate.getHoursAndMinutesFromMinutes(
                      item.totalTimeInMinutesOnCall,
                    )}
                  </span>
                );
              },
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default OnCallPolicyLogTable;
