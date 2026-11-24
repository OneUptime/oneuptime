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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
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
import {
  getMinutesOnCallInRange,
  OnCallStint,
} from "Common/Types/OnCallDutyPolicy/OnCallTimeInRange";

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

      /*
       * The stints that overlap the range, and no others: started before it
       * ends, and ended after it starts or still going on. Page by page, so
       * a range with more stints than one page holds counts them all.
       */
      const timeLogs: Array<OnCallDutyPolicyTimeLog> = [];

      for (let skip: number = 0; ; skip += LIMIT_MAX) {
        const page: ListResult<OnCallDutyPolicyTimeLog> =
          await ModelAPI.getList<OnCallDutyPolicyTimeLog>({
            modelType: OnCallDutyPolicyTimeLog,
            query: {
              projectId: props.projectId,
              startsAt: new LessThan<Date>(endDate),
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
            skip: skip,
            limit: LIMIT_MAX,
            // The id breaks ties, so no stint falls between two pages.
            sort: {
              startsAt: SortOrder.Ascending,
              _id: SortOrder.Ascending,
            },
          });

        timeLogs.push(...page.data);

        if (page.data.length < LIMIT_MAX) {
          break;
        }
      }

      // Group time logs by user ID
      const userTimeLogs: Map<string, OnCallDutyPolicyTimeLog[]> = new Map();
      const userMap: Map<string, User> = new Map<string, User>();

      timeLogs.forEach((timeLog: OnCallDutyPolicyTimeLog) => {
        const userId: string | undefined = timeLog.user?.id?.toString();

        if (!userId || !timeLog.startsAt) {
          return;
        }

        if (!userTimeLogs.has(userId)) {
          userTimeLogs.set(userId, []);
          userMap.set(userId, timeLog.user!);
        }
        userTimeLogs.get(userId)!.push(timeLog);
      });

      /*
       * Each user's time on call in the range: each stint cut to it, a stint
       * still going on up to now, overlapping stints counted once
       * (getMinutesOnCallInRange).
       */
      const timeLogMap: Map<string, number> = new Map<string, number>();
      const now: Date = OneUptimeDate.getCurrentDate();

      userTimeLogs.forEach(
        (logs: OnCallDutyPolicyTimeLog[], userId: string) => {
          timeLogMap.set(
            userId,
            getMinutesOnCallInRange({
              stints: logs.map((log: OnCallDutyPolicyTimeLog): OnCallStint => {
                return { startsAt: log.startsAt!, endsAt: log.endsAt };
              }),
              range: { startsAt: startDate, endsAt: endDate },
              now: now,
            }),
          );
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
    return <PageSkeleton />;
  }

  return (
    <div>
      <Card
        title={"On-Call Time Log for Users"}
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
          singularLabel="On-Call Policy Time Log"
          pluralLabel="On-Call Policy Time Logs"
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
