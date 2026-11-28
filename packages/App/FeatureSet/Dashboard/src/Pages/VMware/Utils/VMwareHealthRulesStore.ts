import VMwareHealthSetting from "Common/Models/DatabaseModels/VMwareHealthSetting";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
  VMwareHealthRules,
  getVMwareHealthRules,
} from "Common/Types/VMware/VMwareHealthRules";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * The project's VMware health rules (#11157), as VMware > Settings > Health
 * Rules sets them: read once per project and page load, the defaults while
 * they are read, when the project has set none, or when they cannot be
 * read - a page never stops saying what needs attention for want of them.
 * Health Rules forgets them when it saves, so the next page reads them anew.
 */
const projectRules: Map<string, Promise<VMwareHealthRules>> = new Map();
const knownRules: Map<string, VMwareHealthRules> = new Map();

export function forgetProjectVMwareHealthRules(projectId: string): void {
  projectRules.delete(projectId);
  knownRules.delete(projectId);
}

const RULE_SELECT: Record<VMwareHealthRuleKey, true> = Object.fromEntries(
  VMWARE_HEALTH_RULE_KEYS.map((key: VMwareHealthRuleKey) => {
    return [key, true];
  }),
) as Record<VMwareHealthRuleKey, true>;

export function fetchProjectVMwareHealthRules(
  projectId: ObjectID,
): Promise<VMwareHealthRules> {
  const key: string = projectId.toString();
  const known: Promise<VMwareHealthRules> | undefined = projectRules.get(key);
  if (known) {
    return known;
  }

  const read: Promise<VMwareHealthRules> =
    ModelAPI.getList<VMwareHealthSetting>({
      modelType: VMwareHealthSetting,
      query: { projectId },
      select: RULE_SELECT,
      limit: 1,
      skip: 0,
      sort: {},
    })
      .then((result: ListResult<VMwareHealthSetting>): VMwareHealthRules => {
        const rules: VMwareHealthRules = getVMwareHealthRules(
          (result.data[0] as unknown as Partial<
            Record<VMwareHealthRuleKey, unknown>
          >) || null,
        );
        knownRules.set(key, rules);
        return rules;
      })
      .catch((): VMwareHealthRules => {
        projectRules.delete(key);
        return { ...DEFAULT_VMWARE_HEALTH_RULES };
      });

  projectRules.set(key, read);
  return read;
}

/*
 * The rules of the project a page is in, for a read that needs them before
 * it asks (which VMs may need attention): the defaults outside a project.
 */
export function readCurrentProjectVMwareHealthRules(): Promise<VMwareHealthRules> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  return projectId
    ? fetchProjectVMwareHealthRules(projectId)
    : Promise.resolve({ ...DEFAULT_VMWARE_HEALTH_RULES });
}

/*
 * A list's context with the project's rules in it: the ones its page handed
 * in, else the project's own.
 */
export function useVMwareListContextWithRules<
  T extends { rules?: VMwareHealthRules | undefined },
>(context: T): T {
  const rules: VMwareHealthRules = useVMwareHealthRules();
  return context.rules ? context : { ...context, rules };
}

// The rules of the project a page is in, the defaults until they are read.
export function useVMwareHealthRules(): VMwareHealthRules {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const key: string = projectId?.toString() || "";
  const [rules, setRules] = useState<VMwareHealthRules>(() => {
    return knownRules.get(key) || { ...DEFAULT_VMWARE_HEALTH_RULES };
  });

  useEffect(() => {
    let ignore: boolean = false;
    if (projectId) {
      fetchProjectVMwareHealthRules(projectId)
        .then((read: VMwareHealthRules): void => {
          if (!ignore) {
            setRules(read);
          }
        })
        .catch((): void => {
          // fetchProjectVMwareHealthRules answers the defaults on failure.
        });
    }
    return () => {
      ignore = true;
    };
  }, [key]);

  return rules;
}
