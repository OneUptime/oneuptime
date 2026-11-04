import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OpenStackProjectQuota,
  getOpenStackProjectQuotas,
} from "Common/Types/OpenStack/OpenStackQuota";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { OpenStackQuotaSetup } from "../../../Components/OpenStack/OpenStackQuotaCard";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
  getOpenStackFactColumn,
} from "../../../Components/OpenStack/OpenStackResourceList";
import { getOpenStackPartRoutes } from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import {
  OpenIssueRecord,
  readSeriesLabel,
} from "../../../Components/ResourceTopology/ResourceTopologyIssues";
import {
  OpenIssuesResult,
  loadOpenIssues,
} from "../../../Components/ResourceTopology/ResourceTopologyIssuesLoader";
import {
  OpenStackAssessment,
  assessOpenStackResource,
} from "../Utils/OpenStackHealth";
import {
  OpenStackProjectSummaries,
  OpenStackProjectSummary,
  fetchOpenStackDomainOptions,
  fetchOpenStackProjectSummaries,
} from "../Utils/OpenStackProjectReads";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
  getOpenStackFactText,
} from "../Utils/OpenStackResourceUtils";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * Keystone's projects, which is OpenStack's word for its tenants: whose each thing is,
 * what each one runs, what in it needs someone and what is open on it. They belong to the
 * cloud rather than to a region, so this list has no Region.
 *
 * Real clouds hold projects like service, invisible_to_admin and alt_demo that run
 * nothing, so a project with nothing in it is an ordinary row and not a problem.
 *
 * Each page of rows asks for its own numbers, in one read (project-summaries), because a
 * cloud can hold tens of thousands of projects.
 */

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Status];

// The project an open incident or alert names for itself.
export function getOpenStackIssueProjectId(
  record: OpenIssueRecord,
): string | null {
  return (
    readSeriesLabel(record.seriesLabels, "tenant_id") ||
    readSeriesLabel(record.seriesLabels, "project_id")
  );
}

export function countOpenStackProjectAttention(data: {
  rows: Array<OpenStackResource>;
  now: Date;
}): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const row of data.rows) {
    const id: string | undefined = row.openStackProjectId;
    if (!id) {
      continue;
    }
    const assessment: OpenStackAssessment = assessOpenStackResource({
      row,
      now: data.now,
    });
    if (assessment.severity) {
      counts[id] = (counts[id] || 0) + 1;
    }
  }

  return counts;
}

function numberCell(value: number | undefined): ReactElement {
  return value ? (
    <span className="text-gray-900">{value}</span>
  ) : (
    <span className="text-gray-400">0</span>
  );
}

const OpenStackCloudProjects: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [summaries, setSummaries] = useState<
    Record<string, OpenStackProjectSummary>
  >({});
  const [attention, setAttention] = useState<Record<string, number>>({});
  const [openByProject, setOpenByProject] = useState<Record<string, number>>(
    {},
  );
  const [domainNames, setDomainNames] = useState<Record<string, string>>({});
  // Whether any row seen so far holds a quota reading.
  const [quotaState, setQuotaState] = useState<"unknown" | "on" | "off">(
    "unknown",
  );
  const [projectCount, setProjectCount] = useState<number>(0);

  useEffect(() => {
    fetchOpenStackDomainOptions(modelId)
      .then((options: Array<DropdownOption>) => {
        const names: Record<string, string> = {};
        for (const option of options) {
          names[String(option.value)] = option.label;
        }
        setDomainNames(names);
      })
      .catch(() => {
        // The domain's ID stands in for its name, and is just as true.
      });

    // The whole cloud's count, so what quotas would cost is this cloud's own figure.
    fetchOpenStackInventorySummary(modelId)
      .then((summary: OpenStackInventorySummary | null) => {
        setProjectCount(summary?.projectCount || 0);
      })
      .catch(() => {
        // Without it the sentence states the cost per project, which is just as true.
      });

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      loadOpenIssues({
        projectId: projectId,
        resourceRelation: "openStackClouds",
        resourceId: modelId,
      })
        .then((issues: OpenIssuesResult) => {
          const counts: Record<string, number> = {};
          for (const record of issues.records) {
            const id: string | null = getOpenStackIssueProjectId(record);
            if (id) {
              counts[id] = (counts[id] || 0) + 1;
            }
          }
          setOpenByProject(counts);
        })
        .catch(() => {
          // A role that may not read them sees no number, and the project page says so.
        });
    }
  }, [modelId.toString()]);

  const onRowsFetched: (rows: Array<OpenStackResource>) => void = useCallback(
    (rows: Array<OpenStackResource>): void => {
      const now: Date = new Date();
      const hasQuota: boolean = rows.some((row: OpenStackResource): boolean => {
        const quotas: Array<OpenStackProjectQuota> = getOpenStackProjectQuotas(
          row.facts as JSONObject | undefined,
          now,
        );
        return quotas.length > 0;
      });
      if (rows.length > 0) {
        setQuotaState((known: "unknown" | "on" | "off") => {
          return hasQuota || known === "on" ? "on" : "off";
        });
      }

      const ids: Array<string> = rows
        .map((row: OpenStackResource): string => {
          return row.externalId || "";
        })
        .filter(Boolean);

      fetchOpenStackProjectSummaries({
        openStackCloudId: modelId,
        projectIds: ids,
      })
        .then((answer: OpenStackProjectSummaries) => {
          const byProject: Record<string, OpenStackProjectSummary> = {};
          for (const summary of answer.summaries) {
            byProject[summary.projectId] = summary;
          }
          setSummaries(byProject);
          setAttention(
            countOpenStackProjectAttention({
              rows: answer.attentionRows,
              now: now,
            }),
          );
        })
        .catch(() => {
          // The list still names every project, and each project's page tries again.
        });
    },
    [modelId.toString()],
  );

  const columns: Array<OpenStackColumn | Column<OpenStackResource>> =
    useMemo(() => {
      const countColumn: (data: {
        id: string;
        title: string;
        read: (summary: OpenStackProjectSummary) => number;
        hideOnMobile?: boolean;
      }) => Column<OpenStackResource> = (data: {
        id: string;
        title: string;
        read: (summary: OpenStackProjectSummary) => number;
        hideOnMobile?: boolean;
      }): Column<OpenStackResource> => {
        const countOf: (row: OpenStackResource) => number = (
          row: OpenStackResource,
        ): number => {
          const summary: OpenStackProjectSummary | undefined =
            summaries[row.externalId || ""];
          return summary ? data.read(summary) : 0;
        };

        return {
          id: data.id,
          field: { facts: true },
          title: data.title,
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: data.hideOnMobile,
          getElement: (row: OpenStackResource): ReactElement => {
            return numberCell(countOf(row));
          },
          getExportValue: (row: OpenStackResource): string => {
            return `${countOf(row)}`;
          },
        };
      };

      return [
        OpenStackColumn.Status,
        getOpenStackFactColumn({
          id: "domain",
          title: "Domain",
          hideOnMobile: true,
          getText: (row: OpenStackResource): string => {
            const domainId: string = getOpenStackFactText(row, "domainId");
            return domainNames[domainId] || domainId;
          },
        }),
        countColumn({
          id: "instances",
          title: "Instances",
          read: (summary: OpenStackProjectSummary): number => {
            return summary.instanceCount;
          },
        }),
        countColumn({
          id: "volumes",
          title: "Volumes",
          hideOnMobile: true,
          read: (summary: OpenStackProjectSummary): number => {
            return summary.volumeCount;
          },
        }),
        countColumn({
          id: "networks",
          title: "Networks",
          hideOnMobile: true,
          read: (summary: OpenStackProjectSummary): number => {
            return summary.networkCount;
          },
        }),
        countColumn({
          id: "floatingIps",
          title: "Floating IPs",
          hideOnMobile: true,
          read: (summary: OpenStackProjectSummary): number => {
            return summary.floatingIpCount;
          },
        }),
        {
          id: "needsAttention",
          field: { facts: true },
          title: "Needs Attention",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: OpenStackResource): ReactElement => {
            const count: number = attention[row.externalId || ""] || 0;
            return count > 0 ? (
              <span
                data-testid={`openstack-project-attention-${row.externalId}`}
                className="font-medium text-amber-700"
              >
                {count}
              </span>
            ) : (
              <span className="text-gray-400">0</span>
            );
          },
          getExportValue: (row: OpenStackResource): string => {
            return `${attention[row.externalId || ""] || 0}`;
          },
        },
        {
          id: "open",
          field: { facts: true },
          title: "Open Incidents and Alerts",
          type: FieldType.Element,
          disableSort: true,
          hideOnMobile: true,
          getElement: (row: OpenStackResource): ReactElement => {
            const count: number = openByProject[row.externalId || ""] || 0;
            return count > 0 ? (
              <span className="font-medium text-red-700">{count}</span>
            ) : (
              <span className="text-gray-400">0</span>
            );
          },
          getExportValue: (row: OpenStackResource): string => {
            return `${openByProject[row.externalId || ""] || 0}`;
          },
        },
      ];
    }, [summaries, attention, openByProject, domainNames]);

  return (
    <>
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Project}
        tableId="openstack-projects-table"
        title="Projects"
        description="Every OpenStack project in this cloud: what it runs, what in it needs attention, and what is open on it."
        singularName="project"
        pluralName="projects"
        emptyTitle="No projects reported yet"
        emptyDescription="These come from Keystone, which takes the Full view or Infrastructure only credential. A Project view credential sees only its own."
        columns={columns}
        filters={FILTERS}
        searchPlaceholder="Search by name or ID"
        getViewRoute={(row: OpenStackResource) => {
          return getOpenStackPartRoutes(modelId).getPartRoute(
            OpenStackResourceKind.Project,
            row.externalId || "",
          );
        }}
        onRowsFetched={onRowsFetched}
      />
      {quotaState === "off" ? (
        <div className="mt-5">
          <Card
            title="Quotas"
            description={translator.translateText(
              "Which projects are about to be refused their next instance or volume.",
            )}
          >
            <OpenStackQuotaSetup projectCount={projectCount || undefined} />
          </Card>
        </div>
      ) : null}
    </>
  );
};

export default OpenStackCloudProjects;
