import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Profile from "Common/Models/AnalyticsModels/Profile";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";

export interface ProfileTimelineProps {
  startTime: Date;
  endTime: Date;
  serviceIds?: Array<ObjectID> | undefined;
  profileType?: string | undefined;
  onTimeRangeSelect?: ((start: Date, end: Date) => void) | undefined;
}

interface TimelineBucket {
  startTime: Date;
  endTime: Date;
  count: number;
}

const BUCKET_COUNT: number = 50;

const ProfileTimeline: FunctionComponent<ProfileTimelineProps> = (
  props: ProfileTimelineProps,
): ReactElement => {
  const [profiles, setProfiles] = useState<Array<Profile>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadProfiles: () => Promise<void> = async (): Promise<void> => {
    try {
      setIsLoading(true);
      setError("");

      const query: Record<string, unknown> = {
        projectId: ProjectUtil.getCurrentProjectId()!,
        startTime: new InBetween(props.startTime, props.endTime),
      };

      if (
        props.serviceIds &&
        props.serviceIds.length > 0 &&
        props.serviceIds[0]
      ) {
        query["serviceId"] = props.serviceIds[0];
      }

      if (props.profileType) {
        query["profileType"] = props.profileType;
      }

      const result: ListResult<Profile> = await AnalyticsModelAPI.getList({
        modelType: Profile,
        query: query,
        select: {
          startTime: true,
          profileId: true,
        },
        limit: 5000,
        skip: 0,
        sort: {
          startTime: SortOrder.Ascending,
        },
      });

      setProfiles(result.data || []);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, [props.startTime, props.endTime, props.serviceIds, props.profileType]);

  const buckets: Array<TimelineBucket> = useMemo(() => {
    const start: number = props.startTime.getTime();
    const end: number = props.endTime.getTime();
    const bucketWidth: number = (end - start) / BUCKET_COUNT;

    const result: Array<TimelineBucket> = [];

    for (let i: number = 0; i < BUCKET_COUNT; i++) {
      result.push({
        startTime: new Date(start + i * bucketWidth),
        endTime: new Date(start + (i + 1) * bucketWidth),
        count: 0,
      });
    }

    for (const profile of profiles) {
      const profileTime: number = new Date(
        profile.startTime || new Date(),
      ).getTime();
      const bucketIndex: number = Math.min(
        Math.floor(((profileTime - start) / (end - start)) * BUCKET_COUNT),
        BUCKET_COUNT - 1,
      );

      if (bucketIndex >= 0 && bucketIndex < result.length) {
        result[bucketIndex]!.count += 1;
      }
    }

    return result;
  }, [profiles, props.startTime, props.endTime]);

  const maxCount: number = useMemo(() => {
    let max: number = 0;
    for (const bucket of buckets) {
      if (bucket.count > max) {
        max = bucket.count;
      }
    }
    return max;
  }, [buckets]);

  const handleBucketClick: (bucket: TimelineBucket) => void = useCallback(
    (bucket: TimelineBucket): void => {
      if (props.onTimeRangeSelect) {
        props.onTimeRangeSelect(bucket.startTime, bucket.endTime);
      }
    },
    [props.onTimeRangeSelect],
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ErrorMessage
        message={error}
        onRefreshClick={() => {
          void loadProfiles();
        }}
      />
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">
        No profiles found in this time range.
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">
          Activity ({profiles.length} profiles captured)
        </span>
        <span className="text-xs text-gray-400">
          {OneUptimeDate.getDateAsLocalFormattedString(props.startTime, true)} —{" "}
          {OneUptimeDate.getDateAsLocalFormattedString(props.endTime, true)}
        </span>
      </div>
      <div className="flex items-end space-x-0.5 h-16 border border-gray-200 rounded bg-white p-1">
        {buckets.map((bucket: TimelineBucket, index: number) => {
          const heightPercent: number =
            maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;

          return (
            <div
              key={index}
              className={`flex-1 rounded-t cursor-pointer transition-colors ${
                bucket.count > 0
                  ? "bg-blue-400 hover:bg-blue-500"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
              style={{
                height: `${Math.max(heightPercent, bucket.count > 0 ? 8 : 2)}%`,
              }}
              title={`${bucket.count} profiles\n${OneUptimeDate.getDateAsLocalFormattedString(bucket.startTime, true)}`}
              onClick={() => {
                handleBucketClick(bucket);
              }}
            />
          );
        })}
      </div>
    </div>
  );
};

export default ProfileTimeline;
