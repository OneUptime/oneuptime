import {
  LISTED_GOOGLE_FRONT_ENDS_WARNING,
  LISTED_PASS_ON_WARNING,
  TRUSTED_PROXIES_DESCRIPTION,
  TRUSTED_PROXIES_FIELD_DESCRIPTION,
  TRUSTED_PROXIES_TEST_IDS,
  TRUSTED_PROXIES_TITLE,
  getTrustedProxiesProblemText,
} from "./SecurityTrustedProxiesCopy";
import { fetchAutomaticTrustedProxies } from "./TrustedProxies/AutomaticTrustedProxiesApi";
import {
  ProjectColumnsEditGate,
  getProjectColumnsEditGate,
} from "../../Pages/Settings/ProjectColumnEditGate";
import Project from "Common/Models/DatabaseModels/Project";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  AutomaticPassOnLoadBalancer,
  AutomaticTrustedProxies,
  ListedPassOnOverlap,
  findListedPassOnOverlaps,
} from "Common/Types/SecurityEvent/AutomaticTrustedProxies";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { readTrustedProxyList } from "Common/Utils/SecurityEvent/ClientAddressTrust";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

// Its place in More settings: the key the folded header names it by.
export const TRUSTED_PROXIES_CARD_KEY: string =
  getPageAnchorNameForTitle(TRUSTED_PROXIES_TITLE) || "trusted-proxies";

// How many addresses and ranges a saved list holds.
export function countTrustedProxies(value: unknown): number {
  return typeof value === "string"
    ? readTrustedProxyList(value).blocks.length
    : 0;
}

export interface ComponentProps {
  // The list as it was read, so the fold that holds the card can say it is set.
  onLoaded?: ((count: number) => void) | undefined;
}

/*
 * The listed ranges that hold where a load balancer of the project's that
 * passes on what a client wrote connects from (#11388, #11389), as a saved
 * list and the server's answer say them.
 */
export function getListedPassOnOverlaps(data: {
  value: unknown;
  passOnLoadBalancers: ReadonlyArray<AutomaticPassOnLoadBalancer>;
}): Array<ListedPassOnOverlap> {
  return typeof data.value === "string"
    ? findListedPassOnOverlaps({
        listed: readTrustedProxyList(data.value).blocks,
        passOnLoadBalancers: data.passOnLoadBalancers,
      })
    : [];
}

/*
 * Under the list: each listed range OneUptime does not trust all of, and
 * why - Google's front ends with a TCP or SSL proxy load balancer, or where
 * any other load balancer that passes on what a client wrote connects from.
 */
function ListedPassOnWarnings(props: {
  overlaps: Array<ListedPassOnOverlap>;
  translator: Translator;
}): ReactElement {
  return (
    <ul
      className="space-y-1.5"
      data-testid={TRUSTED_PROXIES_TEST_IDS.listedPassOnWarning}
    >
      {props.overlaps.map(
        (overlap: ListedPassOnOverlap, index: number): ReactElement => {
          return (
            <li
              key={`${overlap.range}-${overlap.loadBalancer}-${index}`}
              className="flex items-start gap-1.5 text-sm text-amber-800"
            >
              <Icon
                icon={IconProp.Alert}
                className="mt-0.5 h-4 w-4 flex-none text-amber-600"
              />
              <span className="min-w-0">
                {props.translator.translateTemplate(
                  overlap.isGoogleFrontEnds
                    ? LISTED_GOOGLE_FRONT_ENDS_WARNING
                    : LISTED_PASS_ON_WARNING,
                  {
                    range: overlap.range,
                    loadBalancer: overlap.loadBalancer,
                  },
                )}
              </span>
            </li>
          );
        },
      )}
    </ul>
  );
}

/*
 * SECURITY EVENTS' TRUSTED PROXIES (#10416): the proxies the project's
 * apps sit behind - a CDN's edge, a load balancer's public addresses, an
 * HTTP proxy inside its network while private addresses are not trusted
 * unlisted (#11389) - so the client address one of them forwards in
 * X-Forwarded-For is read as verified. One address or range a line, checked
 * as it is typed and again by the server
 * (ProjectService.applySecurityTrustedProxyRules).
 *
 * Under the list, a warning for each range that holds where a load
 * balancer of the project's that passes on what a client wrote connects
 * from (#11388, #11389): OneUptime does not trust those addresses, listed
 * or not - Google's front ends, which the old docs said to list, while a
 * TCP or SSL proxy load balancer connects from them.
 *
 * A Project Owner, a Project Admin or a Security Admin edits it (#11049), as
 * they flip the two switches beside it; anyone else sees it locked, with
 * the roles that may (the column's own update list, ProjectColumnEditGate).
 * Every change is in the project's audit log.
 */
const SecurityTrustedProxiesCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  /*
   * The load balancers that pass on what a client wrote (#11389), read once
   * for the warning under the list; none while they are read or when they
   * cannot be, since the list itself needs no reading.
   */
  const [passOnLoadBalancers, setPassOnLoadBalancers] = useState<
    Array<AutomaticPassOnLoadBalancer>
  >([]);

  useEffect(() => {
    let isCurrent: boolean = true;

    fetchAutomaticTrustedProxies()
      .then((read: AutomaticTrustedProxies) => {
        if (isCurrent) {
          setPassOnLoadBalancers(read.passOnLoadBalancers);
        }
      })
      .catch(() => {
        // No warning to give: the Trusted Automatically card says why it could not read them.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

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
            {
              field: { securityTrustedProxies: true },
              fieldType: FieldType.Element,
              showIf: (item: Project): boolean => {
                return (
                  getListedPassOnOverlaps({
                    value: item.securityTrustedProxies,
                    passOnLoadBalancers,
                  }).length > 0
                );
              },
              getElement: (item: Project): ReactElement => {
                return (
                  <ListedPassOnWarnings
                    overlaps={getListedPassOnOverlaps({
                      value: item.securityTrustedProxies,
                      passOnLoadBalancers,
                    })}
                    translator={translator}
                  />
                );
              },
            },
          ],
        }}
      />
    </div>
  );
};

export default SecurityTrustedProxiesCard;
