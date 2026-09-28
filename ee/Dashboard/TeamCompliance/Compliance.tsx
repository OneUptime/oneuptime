import { ComplianceAccess, getComplianceAccess } from "./ComplianceAccess";
import ComplianceHero from "./ComplianceHero";
import ComplianceRulesCard from "./ComplianceRulesCard";
import ComplianceRuleWarnings from "./ComplianceRuleWarnings";
import { MemberStatusFilter } from "./ComplianceView";
import TeamComplianceStatusTable from "./TeamComplianceStatusTable";
import useTeamComplianceStatus, {
  TeamComplianceStatusState,
} from "./useTeamComplianceStatus";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import type { TeamComplianceRuleJSON } from "Common/Types/Team/TeamComplianceStatus";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Teams > View > Compliance (OneUptime Enterprise): what everyone on this
 * team must have set up to be reachable - "a phone call for critical
 * incidents", "a verified push device" - and who on the team actually has.
 *
 * Top to bottom: the verdict, any rule the project itself makes impossible
 * to meet, the rules (editable in place by those allowed to), and the members
 * worst first with the way to fix each of them. All four draw from ONE read
 * of GET /team/compliance-status/:teamId (useTeamComplianceStatus), repeated
 * after every rule change, so they always agree.
 *
 * Core's Pages/Teams/View/Compliance is the page the route renders; it renders
 * this component through the Dashboard plugin (the "TeamCompliance" key), or
 * the team compliance upsell card when the project is not eligible or the
 * build has no Enterprise plugin. The eligibility check lives in that shell.
 *
 * The members section lives in this directory too and is imported from here:
 * it is not a Dashboard plugin key, and core has no shell for it.
 */
const TeamViewCompliance: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const teamId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const compliance: TeamComplianceStatusState = useTeamComplianceStatus(teamId);

  const access: ComplianceAccess = getComplianceAccess();

  const [memberFilter, setMemberFilter] = useState<MemberStatusFilter>(
    MemberStatusFilter.All,
  );
  const [failingRuleId, setFailingRuleId] = useState<string | null>(null);

  const projectId: ObjectID | null = props.currentProject?._id
    ? new ObjectID(props.currentProject._id.toString())
    : ProjectUtil.getCurrentProjectId();

  /*
   * A rule filter outlives the rule it names only as a dead end: once that
   * rule is deleted, paused or passed by everyone, drop the filter rather
   * than show an empty list under a chip for a rule that no longer fails
   * anybody.
   */
  useEffect(() => {
    if (!failingRuleId || !compliance.status) {
      return;
    }

    const rule: TeamComplianceRuleJSON | undefined =
      compliance.status.complianceSettings.find(
        (candidate: TeamComplianceRuleJSON): boolean => {
          return candidate.settingId === failingRuleId;
        },
      );

    if (!rule || !rule.enabled || rule.nonCompliantCount === 0) {
      setFailingRuleId(null);
    }
  }, [compliance.status]);

  const scrollToMembers: () => void = (): void => {
    const section: HTMLElement | null =
      document.getElementById("compliance-members");

    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const reload: () => Promise<boolean> = (): Promise<boolean> => {
    return compliance.reload();
  };

  /*
   * The members section's status filter, from wherever it is chosen - the
   * hero's counts or the section's own segments. "Compliant" and a rule
   * filter can never both hold: everyone failing a rule needs attention, so
   * the pair filters down to nobody under a count that promised somebody.
   * Choosing Compliant drops the rule filter (the reverse of the guard in
   * onShowFailing below).
   */
  const chooseMemberFilter: (filter: MemberStatusFilter) => void = (
    filter: MemberStatusFilter,
  ): void => {
    setMemberFilter(filter);

    if (filter === MemberStatusFilter.Compliant) {
      setFailingRuleId(null);
    }
  };

  if (!compliance.status) {
    /*
     * The error is checked before "no status yet": a FIRST read that fails
     * leaves the status null for good, and a skeleton there would pulse
     * forever instead of saying what went wrong.
     */
    if (compliance.error && !compliance.isLoading) {
      return (
        <div data-testid="compliance-load-error">
          <Card
            title="Team compliance"
            description="Whether everyone on this team has the notification setup its rules require."
          >
            <ErrorMessage
              message={compliance.error}
              onRefreshClick={() => {
                reload().catch(() => {
                  // reload reports its own failure through the error state.
                });
              }}
            />
          </Card>
        </div>
      );
    }

    return <ComplianceSkeleton />;
  }

  const hasRules: boolean = compliance.status.complianceSettings.length > 0;

  return (
    <div data-testid="team-compliance-page">
      <ComplianceHero
        status={compliance.status}
        isRefreshing={compliance.isLoading}
        refreshError={compliance.error}
        onRefresh={() => {
          reload().catch(() => {
            // reload reports its own failure through the error state.
          });
        }}
        memberFilter={memberFilter}
        onShowMembers={(filter: MemberStatusFilter) => {
          chooseMemberFilter(filter);
          scrollToMembers();
        }}
      />

      <ComplianceRuleWarnings rules={compliance.status.complianceSettings} />

      <ComplianceRulesCard
        rules={compliance.status.complianceSettings}
        access={access}
        teamId={teamId}
        projectId={projectId}
        failingRuleId={failingRuleId}
        onShowFailing={(settingId: string | null) => {
          setFailingRuleId(settingId);

          if (settingId) {
            // Everyone failing a rule needs attention; "Compliant" would hide them all.
            if (memberFilter === MemberStatusFilter.Compliant) {
              setMemberFilter(MemberStatusFilter.All);
            }

            scrollToMembers();
          }
        }}
        onChanged={reload}
      />

      {hasRules ? (
        <TeamComplianceStatusTable
          status={compliance.status}
          statusFilter={memberFilter}
          onStatusFilterChange={chooseMemberFilter}
          failingRuleId={failingRuleId}
          onClearFailingRule={() => {
            setFailingRuleId(null);
          }}
          canViewMemberSetup={access.canViewMemberSetup}
          currentUserId={access.currentUserId}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

/*
 * The page's shape while the first answer loads - the hero, a rules card and
 * a members card - rather than a spinner, so a slow read reads as "loading"
 * and not as "this page is broken".
 */
export const ComplianceSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <div
      role="status"
      aria-label="Loading team compliance"
      data-testid="compliance-skeleton"
    >
      <span className="sr-only">Loading team compliance</span>
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-4">
          <div className="max-sm:hidden h-12 w-12 flex-shrink-0 animate-pulse rounded-xl bg-gray-100 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="h-5 w-24 animate-pulse rounded-full bg-gray-100" />
            <div className="mt-3 h-6 w-2/3 animate-pulse rounded bg-gray-100" />
            <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        </div>
        <div className="mt-5 h-2 w-full animate-pulse rounded-full bg-gray-100" />
      </div>
      {[0, 1].map((card: number): ReactElement => {
        return (
          <div
            key={`card-skeleton-${card}`}
            className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:p-6"
          >
            <div className="h-5 w-40 animate-pulse rounded bg-gray-100" />
            <div className="mt-2 h-4 w-3/5 animate-pulse rounded bg-gray-100" />
            <div className="mt-6 space-y-5">
              {[0, 1, 2].map((row: number): ReactElement => {
                return (
                  <div
                    key={`row-skeleton-${card}-${row}`}
                    className="flex items-center gap-3"
                  >
                    <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-lg bg-gray-100" />
                    <div className="min-w-0 flex-1">
                      <div className="h-3.5 w-1/3 animate-pulse rounded bg-gray-100" />
                      <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default TeamViewCompliance;
