import {
  OpenStackIdentityInventory,
  toKeystoneDomain,
  toKeystoneProject,
} from "../OpenStackInventory";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import { OpenStackCollectorContext } from "./OpenStackCollectorContext";

/*
 * Keystone: one for the whole cloud, whichever region asks, so it is read once a
 * collection and every region's series say the same. It is asked at the address a
 * person gave, not the catalog's, because that is the one the credential is bound to.
 *
 * Users and groups only count, and listing them can be slow on an LDAP-backed domain.
 * Nothing keeps a row of either, so a failure there costs only that count. The access
 * rules and the policy files leave them out on purpose: the credentials the docs recommend
 * read nobody's accounts, so being refused them is what should happen, and says nothing.
 */
export default async function collectIdentity(
  context: OpenStackCollectorContext<OpenStackIdentityInventory>,
): Promise<void> {
  const { run, inventory } = context;

  const warnIfTruncated: (what: string, answer: OpenStackListAnswer) => void = (
    what: string,
    answer: OpenStackListAnswer,
  ): void => {
    if (answer.isTruncated) {
      run.warnings.push(
        `Keystone cut its list of ${what} short at its list_limit, so some are missing here.`,
      );
    }
  };

  const domains: OpenStackListAnswer | undefined = await run.read({
    name: "domains",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "domains",
        path: "/domains",
        key: "domains",
        paging: "none",
      });
    },
  });

  if (domains) {
    inventory.domains = domains.items.map(toKeystoneDomain);
    warnIfTruncated("domains", domains);
  }

  const projects: OpenStackListAnswer | undefined = await run.read({
    name: "projects",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "projects",
        path: "/projects",
        key: "projects",
        paging: "none",
      });
    },
  });

  if (projects) {
    inventory.projects = projects.items.map(toKeystoneProject);
    warnIfTruncated("projects", projects);
  }

  const regions: OpenStackListAnswer | undefined = await run.read({
    name: "regions",
    isInventory: false,
    run: () => {
      return run.client.list({
        read: "regions",
        path: "/regions",
        key: "regions",
        paging: "none",
      });
    },
  });

  if (regions) {
    inventory.regionCount = regions.items.length;
  }

  const users: OpenStackListAnswer | undefined = await run.read({
    name: "users",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "users",
        path: "/users",
        key: "users",
        paging: "none",
      });
    },
  });

  if (users) {
    inventory.userCount = users.items.length;
  }

  const groups: OpenStackListAnswer | undefined = await run.read({
    name: "groups",
    isInventory: false,
    isQuietWhenRefused: true,
    run: () => {
      return run.client.list({
        read: "groups",
        path: "/groups",
        key: "groups",
        paging: "none",
      });
    },
  });

  if (groups) {
    inventory.groupCount = groups.items.length;
  }
}
