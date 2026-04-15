import PageComponentProps from "../../PageComponentProps";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ProfileFlamegraph from "../../../Components/Profiles/ProfileFlamegraph";
import ProfileFunctionList from "../../../Components/Profiles/ProfileFunctionList";
import ProfileTypeSelector from "../../../Components/Profiles/ProfileTypeSelector";
import DiffFlamegraphWithPresets from "../../../Components/Profiles/DiffFlamegraphWithPresets";
import ProfileUtil from "../../../Utils/ProfileUtil";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Profile from "Common/Models/AnalyticsModels/Profile";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";

const ProfileViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const profileId: string = Navigation.getLastParamAsString(0);
  const [selectedProfileType, setSelectedProfileType] = useState<
    string | undefined
  >(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);

  /*
   * Load the profile's metadata so we can show the right unit, the
   * captured-at timestamp, and — if present — the linked trace.
   */
  useEffect(() => {
    let cancelled: boolean = false;
    void (async (): Promise<void> => {
      try {
        const result: { data: Array<Profile> } =
          await AnalyticsModelAPI.getList({
            modelType: Profile,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              profileId,
            },
            select: {
              profileId: true,
              profileType: true,
              serviceId: true,
              startTime: true,
              endTime: true,
              durationNano: true,
              sampleCount: true,
              traceId: true,
              spanId: true,
              unit: true,
            },
            limit: 1,
            skip: 0,
          });
        if (!cancelled && result.data.length > 0) {
          setProfile(result.data[0]!);
          if (!selectedProfileType && result.data[0]!.profileType) {
            setSelectedProfileType(result.data[0]!.profileType);
          }
        }
      } catch {
        // Metadata is best-effort; the flame graph itself still loads.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const resolvedType: string | undefined =
    selectedProfileType || profile?.profileType || undefined;
  const resolvedUnit: string =
    profile?.unit ||
    (resolvedType
      ? ProfileUtil.getProfileTypeUnit(resolvedType)
      : "nanoseconds");

  const tabs: Array<Tab> = [
    {
      name: "Flame graph",
      children: (
        <div className="mt-4">
          <ExplainerCard
            title="Flame graph"
            description={
              resolvedType
                ? ProfileUtil.getProfileTypeDescription(resolvedType)
                : "Each rectangle is a function. Width = how much of the recording it accounts for. Stacked vertically = the call stack — the function on top called the one beneath it."
            }
          />
          <ProfileFlamegraph
            profileId={profileId}
            profileType={selectedProfileType}
            unit={resolvedUnit}
          />
        </div>
      ),
    },
    {
      name: "Top functions",
      children: (
        <div className="mt-4">
          <ProfileFunctionList
            profileId={profileId}
            profileType={selectedProfileType}
            unit={resolvedUnit}
          />
        </div>
      ),
    },
    {
      name: "Diff vs. baseline",
      children: (
        <div className="mt-4">
          <DiffFlamegraphWithPresets
            profileType={selectedProfileType}
            windowMinutes={60}
          />
        </div>
      ),
    },
  ];

  const handleTabChange: (tab: Tab) => void = (_tab: Tab): void => {
    // children drive rendering
  };

  return (
    <div>
      {profile && <ProfileSummaryCard profile={profile} />}

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <ProfileTypeSelector
          selectedProfileType={selectedProfileType}
          onChange={setSelectedProfileType}
        />
      </div>

      <Tabs tabs={tabs} onTabChange={handleTabChange} />
    </div>
  );
};

interface ExplainerCardProps {
  title: string;
  description: string;
}

const ExplainerCard: FunctionComponent<ExplainerCardProps> = (
  props: ExplainerCardProps,
): ReactElement => {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50/50 p-3">
      <div className="flex items-start gap-2">
        <Icon
          icon={IconProp.InformationCircle}
          className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0"
        />
        <div className="text-xs text-gray-600 leading-relaxed">
          <span className="font-medium text-gray-800">{props.title}. </span>
          {props.description}
        </div>
      </div>
    </div>
  );
};

interface ProfileSummaryCardProps {
  profile: Profile;
}

/*
 * Summary strip shown above the tabs: service, type, captured at,
 * duration, samples, and (when present) a link to the linked trace.
 */
const ProfileSummaryCard: FunctionComponent<ProfileSummaryCardProps> = (
  props: ProfileSummaryCardProps,
): ReactElement => {
  const p: Profile = props.profile;
  const type: string = p.profileType || "";
  const displayName: string = ProfileUtil.getProfileTypeDisplayName(type);
  const badge: string = ProfileUtil.getProfileTypeBadgeColor(type);
  const durationLabel: string = p.durationNano
    ? ProfileUtil.formatProfileValue(Number(p.durationNano), "nanoseconds")
    : "—";

  const traceId: string | undefined = p.traceId?.toString();

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            Type
          </div>
          <span
            className={`inline-flex items-center mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium ${badge}`}
          >
            {displayName}
          </span>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            Duration
          </div>
          <div className="text-sm font-medium text-gray-900 mt-0.5">
            {durationLabel}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            Samples
          </div>
          <div className="text-sm font-medium text-gray-900 mt-0.5">
            {(p.sampleCount ? Number(p.sampleCount) : 0).toLocaleString()}
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400">
            Captured
          </div>
          <div className="text-sm font-medium text-gray-900 mt-0.5">
            {p.startTime
              ? OneUptimeDate.getDateAsLocalFormattedString(
                  new Date(p.startTime as unknown as string),
                )
              : "—"}
          </div>
        </div>

        {traceId && (
          <div className="ml-auto">
            <Link
              to={RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
                modelId: traceId,
              })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 ring-1 ring-indigo-200 transition-colors"
            >
              <Icon icon={IconProp.Link} className="h-3.5 w-3.5" />
              Open linked trace
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProfileViewPage;
