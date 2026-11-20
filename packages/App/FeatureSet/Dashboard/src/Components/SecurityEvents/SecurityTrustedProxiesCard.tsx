import {
  TRUSTED_PROXIES_DESCRIPTION,
  TRUSTED_PROXIES_FIELD_DESCRIPTION,
  TRUSTED_PROXIES_TEST_IDS,
  TRUSTED_PROXIES_TITLE,
  getTrustedProxiesProblemText,
} from "./SecurityTrustedProxiesCopy";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { readTrustedProxyList } from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import React, { FunctionComponent, ReactElement } from "react";

// Its place in More settings: the key the folded header names it by.
export const TRUSTED_PROXIES_CARD_KEY: string =
  getPageAnchorNameForTitle(TRUSTED_PROXIES_TITLE) || "trusted-proxies";

// How many addresses and ranges a saved list holds.
export function countTrustedProxies(value: unknown): number {
  return typeof value === "string" ? readTrustedProxyList(value).blocks.length : 0;
}

export interface ComponentProps {
  // The list as it was read, so the fold that holds the card can say it is set.
  onLoaded?: ((count: number) => void) | undefined;
}

/*
 * SECURITY EVENTS' TRUSTED PROXIES (#10416): the proxies the project's
 * apps sit behind - a CDN's edge, a load balancer's public addresses - so
 * the client address one of them forwards in X-Forwarded-For is read as
 * verified. Private, loopback and link-local addresses are trusted without
 * being listed. One address or range a line, checked as it is typed and
 * again by the server (ProjectService.applySecurityTrustedProxyRules).
 *
 * It takes a Project Owner or Admin, as the project's other Security Events
 * settings do; anyone else sees it locked, with the permission it needs.
 */
const SecurityTrustedProxiesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  const gate: ProjectColumnsEditGate = getProjectColumnsEditGate({
    fields: ["securityTrustedProxies"],
    buttonTitle: "Edit",
  });

  return (
    <div data-testid={TRUSTED_PROXIES_TEST_IDS.card}>
      <CardModelDetail<Project>
        name="Security Trusted Proxies"
        cardProps={{
          title: TRUSTED_PROXIES_TITLE,
          description: TRUSTED_PROXIES_DESCRIPTION,
          buttons: gate.lockedButtons,
          id: TRUSTED_PROXIES_CARD_KEY,
        }}
        isEditable={gate.isEditable}
        editButtonText="Edit"
        editModalTitle={TRUSTED_PROXIES_TITLE}
        formFields={[
          {
            field: { securityTrustedProxies: true },
            title: TRUSTED_PROXIES_TITLE,
            description: TRUSTED_PROXIES_FIELD_DESCRIPTION,
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            customValidation: (values: FormValues<Project>): string | null => {
              return getTrustedProxiesProblemText(
                (values as Record<string, unknown>)[
                  "securityTrustedProxies"
                ] as string | undefined,
                translator,
              );
            },
          },
        ]}
        modelDetailProps={{
          modelType: Project,
          id: "model-detail-project-security-trusted-proxies",
          modelId: projectId,
          onItemLoaded: (item: Project): void => {
            props.onLoaded?.(countTrustedProxies(item.securityTrustedProxies));
          },
          fields: [
            {
              field: { securityTrustedProxies: true },
              title: TRUSTED_PROXIES_TITLE,
              fieldType: FieldType.LongText,
            },
          ],
        }}
      />
    </div>
  );
};

export default SecurityTrustedProxiesCard;
