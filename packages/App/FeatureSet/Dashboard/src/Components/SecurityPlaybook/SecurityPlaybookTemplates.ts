import IconProp from "Common/Types/Icon/IconProp";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookStep } from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS,
  SecurityPlaybookTemplateDefinition,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";

/*
 * Playbooks to start from, as the Playbooks page offers them. The
 * templates themselves live in Common (SecurityPlaybookTemplates), where
 * the server's one-click setup reads them too; their titles and
 * descriptions are extracted for translation from there.
 */
export interface SecurityPlaybookTemplate {
  key: string;
  name: string;
  description: string;
  icon: IconProp;
  trigger: SecurityPlaybookTrigger;
  minimumPriority?: SecurityCasePriority | undefined;
  detectionSource?: SecurityDetectionSource | undefined;
  getSteps: () => Array<SecurityPlaybookStep>;
  // The template as Common has it, which the playbook is built from (SecurityTemplateRecords).
  definition: SecurityPlaybookTemplateDefinition;
}

export const SECURITY_PLAYBOOK_TEMPLATES: ReadonlyArray<SecurityPlaybookTemplate> =
  SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS.map(
    (
      definition: SecurityPlaybookTemplateDefinition,
    ): SecurityPlaybookTemplate => {
      return {
        key: definition.key,
        name: definition.title,
        description: definition.description,
        icon: definition.icon,
        trigger: definition.trigger,
        minimumPriority: definition.minimumPriority,
        detectionSource: definition.detectionSource,
        getSteps: definition.getSteps,
        definition,
      };
    },
  );
