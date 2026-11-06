import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackObjectStoreInventory,
  SwiftReconServerRecord,
  toSwiftContainer,
  toSwiftReconReplication,
  toSwiftRingName,
} from "../OpenStackInventory";
import { OpenStackToken } from "../OpenStackKeystone";
import {
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
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
const RECON_REPLICATION_RINGS: ReadonlyArray<string> = [
  "account",
  "container",
  "object",
];
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

/*
 * One storage server's /recon, recorded on the same DevStack: it answers on the server's own port, without a
 * token, and a stopped server just doesn't. None of it goes through run.read, because it says nothing about
 * Swift's API: a storage server that's down isn't a proxy that's down.
 */
async function readReconServer(
  context: OpenStackCollectorContext<OpenStackObjectStoreInventory>,
  address: string,
): Promise<SwiftReconServerRecord> {
  const { run } = context;
  const record: SwiftReconServerRecord = {
    address,
    isAnswering: false,
    replication: [],
    ringChecksums: {},
    unmountedDrives: null,
  };
  const ask: (
    path: string,
    bareListKey?: string,
  ) => Promise<JSONObject | null> = async (
    path: string,
    bareListKey?: string,
  ): Promise<JSONObject | null> => {
    try {
      const answer: OpenStackJsonAnswer = await run.client.get({
        read: "recon",
        url: `http://${address}/recon/${path}`,
        withoutToken: true,
        bareListKey,
      });
      record.isAnswering = true;
      return answer.body;
    } catch {
      return null;
    }
  };

  const rings: JSONObject | null = await ask("ringmd5");

  if (!rings) {
    return record;
  }

  for (const file of Object.keys(rings)) {
    const checksum: JSONValue | undefined = rings[file];
    if (typeof checksum === "string") {
      record.ringChecksums[toSwiftRingName(file)] = checksum;
    }
  }

  const nowInSeconds: number = run.client.now() / 1000;

  for (const ring of RECON_REPLICATION_RINGS) {
    const body: JSONObject | null = await ask(`replication/${ring}`);
    if (body) {
      record.replication.push(
        toSwiftReconReplication({ ring, body, nowInSeconds }),
      );
    }
  }

  const unmounted: JSONObject | null = await ask("unmounted", "drives");
  const drives: JSONValue | undefined = unmounted?.["drives"];
  record.unmountedDrives = Array.isArray(drives) ? drives.length : null;

  return record;
}

export default async function collectObjectStore(
  context: OpenStackCollectorContext<OpenStackObjectStoreInventory>,
): Promise<void> {
  const { run, inventory, session } = context;

  inventory.reconServers = [];
  for (const address of context.options.swiftReconAddresses || []) {
    inventory.reconServers.push(await readReconServer(context, address));
  }
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
