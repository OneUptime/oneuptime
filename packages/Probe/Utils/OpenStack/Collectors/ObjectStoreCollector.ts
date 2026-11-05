import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackObjectStoreInventory,
  toSwiftContainer,
} from "../OpenStackInventory";
import { OpenStackToken } from "../OpenStackKeystone";
import { OpenStackListAnswer } from "../OpenStackServiceClient";
import {
  OpenStackCollectorContext,
  OpenStackProjectRef,
} from "./OpenStackCollectorContext";

/*
 * Swift, which a cloud may not run. What a real cloud taught, recorded on stable/2026.1:
 *
 *   The catalog's address is this credential's own project's account, and that's what the exporter lists. So
 *   this says what the exporter says, plus whose it is, which the exporter leaves out.
 *
 *   Another project's account answers 403 unless the credential has ResellerAdmin, and then it answers like any.
 *   So a credential with that role reads each project's in turn, one read per account. Nothing else is asked of
 *   them, because a refusal would be all it got. A cloud with more projects than this reads says so.
 *
 *   Its lists come from the account and container servers, so a stopped object server reads no differently.
 *
 *   Its answer is a bare list, not an object, and it pages by the last name it gave.
 */
const RESELLER_ADMIN_ROLE: string = "reselleradmin";
const MOST_OTHER_ACCOUNTS_READ: number = 200;

// Every project's account is its own under the same address: .../v1/AUTH_<project>.
export function toSwiftAccountUrl(data: {
  ownAccountUrl: string;
  ownProjectId: string;
  projectId: string;
}): string | null {
  return data.ownAccountUrl.endsWith(data.ownProjectId)
    ? `${data.ownAccountUrl.slice(0, -data.ownProjectId.length)}${data.projectId}`
    : null;
}

export default async function collectObjectStore(
  context: OpenStackCollectorContext<OpenStackObjectStoreInventory>,
): Promise<void> {
  const { run, inventory, session } = context;
  const token: OpenStackToken = session.getToken();
  const ownProjectId: string | null = token.projectId;

  const own: OpenStackListAnswer | undefined = await run.read({
    name: "own account",
    isInventory: true,
    run: () => {
      return run.client.list({
        read: "own account",
        path: "",
        key: "containers",
        paging: "bareList",
        idField: "name",
        query: { format: "json" },
      });
    },
  });

  if (!own) {
    return;
  }

  inventory.containers = own.items.map((item: JSONObject) => {
    return toSwiftContainer(item, ownProjectId);
  });

  if (
    !ownProjectId ||
    !token.roleNames.some((role: string): boolean => {
      return role.toLowerCase() === RESELLER_ADMIN_ROLE;
    })
  ) {
    return;
  }

  const projects: Array<OpenStackProjectRef> | null =
    await context.getProjects();
  const others: Array<OpenStackProjectRef> = (projects || []).filter(
    (project: OpenStackProjectRef): boolean => {
      return project.id !== ownProjectId;
    },
  );

  if (others.length > MOST_OTHER_ACCOUNTS_READ) {
    run.warnings.push(
      `Swift: read the containers of the first ${MOST_OTHER_ACCOUNTS_READ} of ${others.length} other projects. The rest aren't listed.`,
    );
  }

  for (const project of others.slice(0, MOST_OTHER_ACCOUNTS_READ)) {
    const url: string | null = toSwiftAccountUrl({
      ownAccountUrl: run.client.baseUrl,
      ownProjectId,
      projectId: project.id,
    });

    if (!url) {
      return;
    }

    const answer: OpenStackListAnswer | undefined = await run.read({
      name: "another project's account",
      isInventory: false,
      isQuietWhenRefused: true,
      run: () => {
        return run.client.list({
          read: "another project's account",
          path: "",
          url,
          key: "containers",
          paging: "bareList",
          idField: "name",
          query: { format: "json" },
        });
      },
    });

    if (!answer) {
      continue;
    }

    inventory.containers.push(
      ...answer.items.map((item: JSONObject) => {
        return toSwiftContainer(item, project.id);
      }),
    );
  }
}
