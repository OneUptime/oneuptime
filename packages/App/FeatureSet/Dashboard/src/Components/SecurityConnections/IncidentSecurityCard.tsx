import SecurityCaseApi from "../SecurityCase/SecurityCaseApi";
import { formatNameList } from "../AiAccess/AiAccessModes";
import SecurityCaseSummaryRow from "./SecurityCaseSummaryRow";
import {
  INCIDENT_SECURITY_DECLARED_BY,
  INCIDENT_SECURITY_DESCRIPTION,
  INCIDENT_SECURITY_NAMES,
  INCIDENT_SECURITY_NAMING,
  INCIDENT_SECURITY_TITLE,
  RESOURCE_SECURITY_MORE_CASES,
  SECURITY_CONNECTIONS_TEST_IDS,
} from "./SecurityConnectionsCopy";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import ObjectID from "Common/Types/ObjectID";
import {
  IncidentSecurityJson,
  ResourceSecurityCaseJson,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import Card, { CardHeaderLayout } from "Common/UI/Components/Card/Card";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import { Translator, composedValue } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Security on an incident's page: the security case that declared the
 * incident - the attack the outage may be the impact of, where it stands
 * now - and the open cases naming a host, a container host or a cluster
 * the incident affects, whichever came first.
 *
 * Drawn only for whoever may read security cases, and only when there is
 * one: most incidents have nothing to do with Security Events, and their
 * page says nothing about it. A read that fails draws nothing.
 */
export interface ComponentProps {
  incidentId: ObjectID;
  headerLayout?: CardHeaderLayout | undefined;
  // Change it to read again (the page's own refresh).
  refreshToken?: number | string | undefined;
}

const IncidentSecurityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const readGate: PermissionGateResult = PermissionGate.check(
    new SecurityCase(),
    ModelAction.Read,
  );
  const [security, setSecurity] = useState<IncidentSecurityJson | null>(null);

  useEffect(() => {
    if (!readGate.isAllowed) {
      return () => {};
    }

    let isCurrent: boolean = true;

    SecurityCaseApi.getIncidentSecurity(props.incidentId)
      .then((result: IncidentSecurityJson) => {
        if (isCurrent) {
          setSecurity(result);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setSecurity(null);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.incidentId.toString(), props.refreshToken, readGate.isAllowed]);

  if (
    !readGate.isAllowed ||
    !security ||
    (security.declaredBy.length === 0 &&
      security.namingItsResources.length === 0)
  ) {
    return <></>;
  }

  const moreNaming: number =
    security.namingItsResourcesCount - security.namingItsResources.length;

  return (
    <div data-testid={SECURITY_CONNECTIONS_TEST_IDS.incidentSecurity}>
      <Card
        title={INCIDENT_SECURITY_TITLE}
        description={INCIDENT_SECURITY_DESCRIPTION}
        headerLayout={props.headerLayout}
      >
        <div className="space-y-4">
          {security.declaredBy.length > 0 ? (
            <section
              data-testid={
                SECURITY_CONNECTIONS_TEST_IDS.incidentSecurityDeclared
              }
            >
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(INCIDENT_SECURITY_DECLARED_BY)}
              </h3>
              <ul className="divide-y divide-gray-100">
                {security.declaredBy.map(
                  (securityCase: ResourceSecurityCaseJson): ReactElement => {
                    return (
                      <SecurityCaseSummaryRow
                        key={securityCase.id}
                        securityCase={securityCase}
                      />
                    );
                  },
                )}
              </ul>
            </section>
          ) : (
            <></>
          )}
          {security.namingItsResources.length > 0 ? (
            <section
              data-testid={SECURITY_CONNECTIONS_TEST_IDS.incidentSecurityNaming}
            >
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                {translator.translateText(INCIDENT_SECURITY_NAMING)}
              </h3>
              <ul className="divide-y divide-gray-100">
                {security.namingItsResources.map(
                  (
                    securityCase: IncidentSecurityJson["namingItsResources"][number],
                  ): ReactElement => {
                    return (
                      <SecurityCaseSummaryRow
                        key={securityCase.id}
                        securityCase={securityCase}
                        under={
                          securityCase.resources.length > 0 ? (
                            <p className="mt-1 text-xs text-gray-500 [overflow-wrap:anywhere]">
                              {translator.translateTemplate(
                                INCIDENT_SECURITY_NAMES,
                                {
                                  resources: composedValue(
                                    (sentence: Translator): string => {
                                      return formatNameList(
                                        securityCase.resources.map(
                                          (resource: {
                                            kind: SecurityConnectionKind;
                                            name: string;
                                          }): string => {
                                            return resource.name;
                                          },
                                        ),
                                        "and",
                                        sentence,
                                      );
                                    },
                                  ),
                                },
                              )}
                            </p>
                          ) : undefined
                        }
                      />
                    );
                  },
                )}
              </ul>
              {moreNaming > 0 ? (
                <p className="mt-2 text-sm text-gray-500">
                  {translator.translatePlural(
                    RESOURCE_SECURITY_MORE_CASES,
                    moreNaming,
                  )}
                </p>
              ) : (
                <></>
              )}
            </section>
          ) : (
            <></>
          )}
        </div>
      </Card>
    </div>
  );
};

export default IncidentSecurityCard;
