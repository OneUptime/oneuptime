import PageComponentProps from "../../PageComponentProps";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Link from "Common/UI/Components/Link/Link";
import Column from "Common/UI/Components/ModelTable/Column";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import OpenStackResourceList, {
  OpenStackColumn,
  OpenStackFilter,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackScopedRulesCard, {
  OpenStackRuleScope,
} from "../../../Components/OpenStack/OpenStackScopedRulesCard";
import { OPENSTACK_LIST_DOMAIN_PARAM } from "../../../Components/OpenStack/UseOpenStackDomainFilter";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  OpenStackDomainSummary,
  fetchOpenStackDomainSummaries,
} from "../Utils/OpenStackProjectReads";

/*
 * Keystone's domains: who holds which projects. A domain owns nothing else itself, so
 * this list says how many projects each holds and opens the Projects list on them.
 */

const FILTERS: Array<OpenStackFilter> = [OpenStackFilter.Status];

const OpenStackCloudDomains: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const [summaries, setSummaries] = useState<
    Record<string, OpenStackDomainSummary>
  >({});
  // What a rule can be added for: the domains the list is showing.
  const [domains, setDomains] = useState<Array<OpenStackRuleScope>>([]);

  useEffect(() => {
    fetchOpenStackDomainSummaries(modelId)
      .then((found: Array<OpenStackDomainSummary>) => {
        const byDomain: Record<string, OpenStackDomainSummary> = {};
        for (const summary of found) {
          byDomain[summary.domainId] = summary;
        }
        setSummaries(byDomain);
      })
      .catch(() => {
        // A count that could not be read is drawn as none, and the link still works.
      });
  }, [modelId.toString()]);

  const columns: Array<OpenStackColumn | Column<OpenStackResource>> =
    useMemo(() => {
      const projectsRoute: (domainId: string) => Route = (
        domainId: string,
      ): Route => {
        return RouteUtil.addQuery(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS] as Route,
            { modelId: modelId },
          ),
          { [OPENSTACK_LIST_DOMAIN_PARAM]: domainId },
        );
      };

      return [
        OpenStackColumn.Status,
        {
          field: { externalId: true },
          title: "ID",
          type: FieldType.Text,
          hideOnMobile: true,
        },
        {
          id: "projects",
          field: { facts: true },
          title: "Projects",
          type: FieldType.Element,
          disableSort: true,
          getElement: (row: OpenStackResource): ReactElement => {
            const count: number =
              summaries[row.externalId || ""]?.projectCount || 0;
            return (
              <Link
                to={projectsRoute(row.externalId || "")}
                className="text-indigo-600 hover:text-indigo-800"
              >
                <>{count}</>
              </Link>
            );
          },
          getExportValue: (row: OpenStackResource): string => {
            return `${summaries[row.externalId || ""]?.projectCount || 0}`;
          },
        },
      ];
    }, [summaries, modelId.toString()]);

  return (
    <>
      <OpenStackResourceList
        openStackCloudId={modelId}
        kind={OpenStackResourceKind.Domain}
        tableId="openstack-domains-table"
        title="Domains"
        description="Keystone's domains, and the projects each one holds. A rule on a domain reaches every project in it."
        singularName="domain"
        pluralName="domains"
        emptyTitle="No domains reported yet"
        emptyDescription="These come from Keystone, which takes the Full view or Infrastructure only credential. A Project view credential sees none."
        columns={columns}
        filters={FILTERS}
        searchPlaceholder="Search by name or ID"
        onRowsFetched={(rows: Array<OpenStackResource>) => {
          setDomains(
            rows.map((row: OpenStackResource): OpenStackRuleScope => {
              return {
                kind: "domain",
                id: row.externalId || "",
                name: row.name || row.externalId || "",
              };
            }),
          );
        }}
      />
      <div className="mt-5 space-y-5" data-testid="openstack-domain-rules">
        <OpenStackScopedRulesCard mode="owner" choices={domains} />
        <OpenStackScopedRulesCard mode="label" choices={domains} />
      </div>
    </>
  );
};

export default OpenStackCloudDomains;
