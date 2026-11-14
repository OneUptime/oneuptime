import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Navigation from "Common/UI/Utils/Navigation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement, useEffect, useState } from "react";
import {
  fetchOpenStackDomainOptions,
  fetchOpenStackProjectIdsOfDomain,
} from "../../Pages/OpenStack/Utils/OpenStackProjectReads";

/*
 * Narrowing any list to one project or domain, keyed by their IDs so a rename breaks
 * nothing. A row knows only its project, so a domain is narrowed to its projects' IDs.
 *
 * A link can open a list narrowed: `?project=<id>` from a project's page, and
 * `?domain=<id>` from the Domains page. A cloud with one domain, which is most of them,
 * has nothing to choose, so it offers no choice.
 */

export const OPENSTACK_LIST_PROJECT_PARAM: string = "project";
export const OPENSTACK_LIST_DOMAIN_PARAM: string = "domain";

// The kinds that belong to a project, and so have a project to filter by.
export const OPENSTACK_PROJECT_OWNED_KINDS: ReadonlySet<string> =
  new Set<string>([
    OpenStackResourceKind.Instance,
    OpenStackResourceKind.Volume,
    OpenStackResourceKind.Snapshot,
    OpenStackResourceKind.Backup,
    OpenStackResourceKind.Image,
    OpenStackResourceKind.Network,
    OpenStackResourceKind.Subnet,
    OpenStackResourceKind.Router,
    OpenStackResourceKind.FloatingIp,
  ]);

// Nothing matches this, which is what a domain with no projects should show.
const NO_PROJECT: string = "00000000-no-project-in-this-domain";

export interface OpenStackDomainFilter {
  query: Query<OpenStackResource>;
  // What a link asked to open on, for the list's Project filter.
  initialProjectId: string | null;
  /*
   * For the content above a list's rows, and not among its card's buttons: a table keeps
   * the buttons it first built, and the choices here arrive after that.
   */
  control: ReactElement | null;
  // Whether a domain is chosen, for a list that choice has left with no rows.
  isNarrowed: boolean;
  clear: () => void;
}

export default function useOpenStackDomainFilter(data: {
  openStackCloudId: ObjectID;
  kind: OpenStackResourceKind;
  // A list's own choice of projects, which a domain narrows rather than writes over.
  chosenProjectIds?: Array<string> | undefined;
}): OpenStackDomainFilter {
  const translator: Translator = useTranslator();
  const isOwned: boolean =
    OPENSTACK_PROJECT_OWNED_KINDS.has(data.kind) ||
    data.kind === OpenStackResourceKind.Project;

  const [options, setOptions] = useState<Array<DropdownOption>>([]);
  const [domainId, setDomainId] = useState<string | null>((): string | null => {
    return isOwned
      ? Navigation.getQueryStringByName(OPENSTACK_LIST_DOMAIN_PARAM)
      : null;
  });
  const [projectIds, setProjectIds] = useState<Array<string> | null>(null);

  useEffect(() => {
    if (!isOwned) {
      return;
    }
    fetchOpenStackDomainOptions(data.openStackCloudId)
      .then(setOptions)
      .catch(() => {
        // Without its choices the list still lists everything, and says nothing false.
      });
  }, [data.openStackCloudId, isOwned]);

  useEffect(() => {
    if (!domainId) {
      setProjectIds(null);
      return;
    }
    fetchOpenStackProjectIdsOfDomain({
      openStackCloudId: data.openStackCloudId,
      domainId: domainId,
    })
      .then(setProjectIds)
      .catch(() => {
        setDomainId(null);
      });
  }, [data.openStackCloudId, domainId]);

  const query: Query<OpenStackResource> = {};

  if (domainId && projectIds) {
    const chosen: Set<string> = new Set<string>(data.chosenProjectIds || []);
    const inDomain: Array<string> =
      chosen.size > 0
        ? projectIds.filter((projectId: string): boolean => {
            return chosen.has(projectId);
          })
        : projectIds;
    const ids: Array<string> = inDomain.length > 0 ? inDomain : [NO_PROJECT];
    if (data.kind === OpenStackResourceKind.Project) {
      query.externalId = new Includes(ids);
    } else {
      query.openStackProjectId = new Includes(ids);
    }
  }

  const control: ReactElement | null =
    isOwned && (options.length > 1 || domainId) ? (
      <div
        data-testid="openstack-domain-filter"
        className="-mt-1 mb-3 flex items-center gap-2"
      >
        <span className="text-xs font-medium text-gray-500">
          {translator.translateText("Domain")}
        </span>
        <div className="w-48 text-left">
          <Dropdown
            ariaLabel="Domain"
            placeholder="Any domain"
            options={options}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === domainId;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setDomainId(typeof value === "string" ? value : null);
            }}
          />
        </div>
      </div>
    ) : null;

  return {
    query,
    initialProjectId: OPENSTACK_PROJECT_OWNED_KINDS.has(data.kind)
      ? Navigation.getQueryStringByName(OPENSTACK_LIST_PROJECT_PARAM)
      : null,
    control,
    isNarrowed: Boolean(domainId),
    clear: () => {
      setDomainId(null);
    },
  };
}
