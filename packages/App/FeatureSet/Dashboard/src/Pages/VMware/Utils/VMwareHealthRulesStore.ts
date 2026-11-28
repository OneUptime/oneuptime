import VMwareHealthRuleOverride from "Common/Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareHealthSetting from "Common/Models/DatabaseModels/VMwareHealthSetting";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import {
  VMwareHealthRuleBook,
  VMwareHealthRuleOverrideEntry,
  VMwareHealthRuleScope,
  getVMwareHealthRuleBook,
} from "Common/Types/VMware/VMwareHealthRuleOverrides";
import {
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
  VMwareHealthRules,
  getVMwareHealthRules,
} from "Common/Types/VMware/VMwareHealthRules";
import EveryPage from "Common/UI/Utils/EveryPage";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * The project's VMware health rules (#11157) and their overrides for its
 * vCenters, clusters, hosts and VMs (#11469), as VMware > Settings > Health
 * Rules sets them: the project's rule book, read once per project and page
 * load. Every page that judges a part hands the book on, and each judgement
 * resolves the part's own rules from it (VMwareHealthRuleOverrides). The
 * defaults while it is read, when the project has set none, or when it
 * cannot be read - a page never stops saying what needs attention for want
 * of them; overrides that cannot be read are none. Health Rules forgets the
 * book when it saves, so the next page reads it anew.
 */
const projectBooks: Map<string, Promise<VMwareHealthRuleBook>> = new Map();
const knownBooks: Map<string, VMwareHealthRuleBook> = new Map();

export function forgetProjectVMwareHealthRules(projectId: string): void {
  projectBooks.delete(projectId);
  knownBooks.delete(projectId);
}

const RULE_SELECT: Record<VMwareHealthRuleKey, true> = Object.fromEntries(
  VMWARE_HEALTH_RULE_KEYS.map((key: VMwareHealthRuleKey) => {
    return [key, true];
  }),
) as Record<VMwareHealthRuleKey, true>;

async function readProjectRules(
  projectId: ObjectID,
): Promise<VMwareHealthRules> {
  const result: ListResult<VMwareHealthSetting> =
    await ModelAPI.getList<VMwareHealthSetting>({
      modelType: VMwareHealthSetting,
      query: { projectId },
      select: RULE_SELECT,
      limit: 1,
      skip: 0,
      sort: {},
    });

  return getVMwareHealthRules(
    (result.data[0] as unknown as Partial<
      Record<VMwareHealthRuleKey, unknown>
    >) || null,
  );
}

// An override as the judgements read it.
export function toVMwareHealthRuleOverrideEntry(
  override: VMwareHealthRuleOverride,
): VMwareHealthRuleOverrideEntry | null {
  const vmwareVCenterId: string | undefined =
    override.vmwareVCenterId?.toString();
  if (
    !vmwareVCenterId ||
    !Object.values(VMwareHealthRuleScope).includes(
      override.scope as VMwareHealthRuleScope,
    )
  ) {
    return null;
  }
  return {
    id: override.id?.toString(),
    vmwareVCenterId: vmwareVCenterId,
    scope: override.scope as VMwareHealthRuleScope,
    resourceExternalId: override.resourceExternalId || null,
    resourceName: override.resourceName || null,
    datacenterName: override.datacenterName || null,
    clusterName: override.clusterName || null,
    hostName: override.hostName || null,
    rules:
      override.rules && typeof override.rules === "object"
        ? override.rules
        : {},
  };
}

// Every override of the project, however many: one a page left out would judge a part wrongly.
export async function readProjectVMwareHealthRuleOverrides(
  projectId: ObjectID,
): Promise<Array<VMwareHealthRuleOverrideEntry>> {
  const overrides: Array<VMwareHealthRuleOverride> =
    await EveryPage.read<VMwareHealthRuleOverride>({
      modelType: VMwareHealthRuleOverride,
      query: { projectId },
      select: {
        _id: true,
        vmwareVCenterId: true,
        scope: true,
        resourceExternalId: true,
        resourceName: true,
        datacenterName: true,
        clusterName: true,
        hostName: true,
        rules: true,
      },
      sort: { createdAt: SortOrder.Ascending },
    });

  return overrides
    .map((override: VMwareHealthRuleOverride) => {
      return toVMwareHealthRuleOverrideEntry(override);
    })
    .filter(
      (
        entry: VMwareHealthRuleOverrideEntry | null,
      ): entry is VMwareHealthRuleOverrideEntry => {
        return entry !== null;
      },
    );
}

export function fetchProjectVMwareHealthRuleBook(
  projectId: ObjectID,
): Promise<VMwareHealthRuleBook> {
  const key: string = projectId.toString();
  const known: Promise<VMwareHealthRuleBook> | undefined =
    projectBooks.get(key);
  if (known) {
    return known;
  }

  const read: Promise<VMwareHealthRuleBook> = Promise.all([
    readProjectRules(projectId).catch((): VMwareHealthRules | null => {
      return null;
    }),
    readProjectVMwareHealthRuleOverrides(projectId).catch(
      (): Array<VMwareHealthRuleOverrideEntry> | null => {
        return null;
      },
    ),
  ]).then(
    ([rules, overrides]: [
      VMwareHealthRules | null,
      Array<VMwareHealthRuleOverrideEntry> | null,
    ]): VMwareHealthRuleBook => {
      const book: VMwareHealthRuleBook = getVMwareHealthRuleBook(
        rules,
        overrides,
      );
      if (rules && overrides) {
        knownBooks.set(key, book);
      } else {
        // Read again next time: what failed may answer then.
        projectBooks.delete(key);
      }
      return book;
    },
  );

  projectBooks.set(key, read);
  return read;
}

/*
 * The book of the project a page is in, for a read that needs it before it
 * asks (which VMs may need attention): the defaults outside a project.
 */
export function readCurrentProjectVMwareHealthRuleBook(): Promise<VMwareHealthRuleBook> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  return projectId
    ? fetchProjectVMwareHealthRuleBook(projectId)
    : Promise.resolve(getVMwareHealthRuleBook());
}

/*
 * A list's context with the project's book in it: the rules its page handed
 * in, else the project's own.
 */
export function useVMwareListContextWithRules<
  T extends { rules?: VMwareHealthRules | VMwareHealthRuleBook | undefined },
>(context: T): T {
  const book: VMwareHealthRuleBook = useVMwareHealthRuleBook();
  return context.rules ? context : { ...context, rules: book };
}

/*
 * The book of the project a page is in, the defaults until it is read. A
 * page that changes it hands a new refreshToken once it has forgotten it
 * (forgetProjectVMwareHealthRules), to read it again.
 */
export function useVMwareHealthRuleBook(
  refreshToken?: string | undefined,
): VMwareHealthRuleBook {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const key: string = projectId?.toString() || "";
  const [book, setBook] = useState<VMwareHealthRuleBook>(() => {
    return knownBooks.get(key) || getVMwareHealthRuleBook();
  });

  useEffect(() => {
    let ignore: boolean = false;
    if (projectId) {
      fetchProjectVMwareHealthRuleBook(projectId)
        .then((read: VMwareHealthRuleBook): void => {
          if (!ignore) {
            setBook(read);
          }
        })
        .catch((): void => {
          // fetchProjectVMwareHealthRuleBook answers the defaults on failure.
        });
    }
    return () => {
      ignore = true;
    };
  }, [key, refreshToken]);

  return book;
}
