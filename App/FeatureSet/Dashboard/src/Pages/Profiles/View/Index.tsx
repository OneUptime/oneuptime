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
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Link from "Common/UI/Components/Link/Link";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageMap from "../../../Utils/PageMap";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";

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
              primaryEntityId: true,
              primaryEntityType: true,
              startTime: true,
              endTime: true,
              durationNano: true,
              sampleCount: true,
              traceId: true,
              spanId: true,
              unit: true,
            },
            sort: {
              startTime: SortOrder.Descending,
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

  /*
   * The pill may hold a category (e.g. "cpu") rather than a raw type —
   * derive the unit from the first raw type it expands to, since the
   * category string itself has no unit mapping.
   */
  const queryTypesForUnit: Array<string> | undefined =
    ProfileUtil.getQueryProfileTypes(resolvedType);
  const typeDerivedUnit: string =
    queryTypesForUnit && queryTypesForUnit.length > 0
      ? ProfileUtil.getProfileTypeUnit(queryTypesForUnit[0]!)
      : "nanoseconds";

  /*
   * The profile's stored unit describes its primary type — when the
   * user picks a different type with the pill, that stored unit no
   * longer applies and the selection's unit wins.
   */
  const resolvedUnit: string =
    selectedProfileType && selectedProfileType !== profile?.profileType
      ? typeDerivedUnit
      : profile?.unit || typeDerivedUnit;

  const profileStartTime: Date | undefined = profile?.startTime
    ? new Date(profile.startTime as unknown as string)
    : undefined;

  /*
   * Scope the baseline diff to the resource this profile came from and
   * anchor it at the capture time — comparing the whole project over
   * an arbitrary recent window says nothing about this profile.
   */
  const diffServiceIds: Array<ObjectID> | undefined = profile?.primaryEntityId
    ? [new ObjectID(profile.primaryEntityId.toString())]
    : undefined;

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
            serviceIds={diffServiceIds}
            anchorTime={profileStartTime}
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
      {profile && (
        <ProfileSummaryCard profile={profile} profileId={profileId} />
      )}

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

/**
 * Friendly label for the resource type a profile is attached to.
 * primaryEntityId alone is ambiguous — the same column holds service,
 * host, docker and k8s ids, disambiguated by primaryEntityType.
 */
function getEntityTypeLabel(entityType: ServiceType | undefined): string {
  switch (entityType) {
    case ServiceType.OpenTelemetry:
      return "Service";
    case ServiceType.Host:
      return "Host";
    case ServiceType.DockerHost:
      return "Docker host";
    case ServiceType.KubernetesCluster:
      return "Kubernetes cluster";
    case ServiceType.Monitor:
      return "Monitor";
    default:
      return "Resource";
  }
}

interface ProfileSummaryCardProps {
  profile: Profile;
  profileId: string;
}

/*
 * Summary strip shown above the tabs: source resource, type, captured
 * at, duration, samples, a pprof export, and (when present) a link to
 * the linked trace.
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

  /*
   * Plain anchor download (same idiom as attachment downloads): auth
   * rides on the session cookie, and the tenant comes from the query
   * param because an <a> tag cannot send custom headers.
   */
  const pprofDownloadUrl: string = URL.fromURL(APP_API_URL)
    .addRoute(`/telemetry/profiles/${props.profileId}/pprof`)
    .addQueryParam(
      "tenantid",
      ProjectUtil.getCurrentProjectId()?.toString() || "",
    )
    .toString();

  return (
    <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {p.primaryEntityId && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">
              {getEntityTypeLabel(p.primaryEntityType)}
            </div>
            <div
              className="text-sm font-medium text-gray-900 mt-0.5 font-mono truncate max-w-[16rem]"
              title={p.primaryEntityId.toString()}
            >
              {p.primaryEntityId.toString()}
            </div>
          </div>
        )}

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

        <div className="ml-auto flex items-center gap-2">
          <a
            href={pprofDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 ring-1 ring-gray-300 transition-colors"
          >
            <Icon icon={IconProp.Download} className="h-3.5 w-3.5" />
            Download pprof
          </a>

          {traceId && (
            <Link
              to={RouteUtil.populateRouteParams(RouteMap[PageMap.TRACE_VIEW]!, {
                modelId: traceId,
              })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 ring-1 ring-indigo-200 transition-colors"
            >
              <Icon icon={IconProp.Link} className="h-3.5 w-3.5" />
              Open linked trace
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileViewPage;
