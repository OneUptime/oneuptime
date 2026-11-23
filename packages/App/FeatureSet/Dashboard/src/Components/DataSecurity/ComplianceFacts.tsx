import {
  FACT_ALL_CHECKS_PASS,
  FACT_BACKED_UP,
  FACT_BACKUPS_KEPT,
  FACT_CALLS,
  FACT_CHECKS_FAIL,
  FACT_COPIED_TO,
  FACT_DECLARED_IN,
  FACT_DELETION_PROTECTION,
  FACT_ENCRYPTED,
  FACT_EXTERNAL_GRANTS,
  FACT_FIXED_MONTH,
  FACT_FIXED_QUARTER,
  FACT_FIXED_WEEK,
  FACT_HISTORY,
  FACT_HOLDS,
  FACT_HOLDS_COPY,
  FACT_IDENTITIES,
  FACT_IN_TRANSIT,
  FACT_IS_COPY,
  FACT_KEEPS_FOR,
  FACT_KEPT_IN,
  FACT_KEPT_IN_COUNTRY,
  FACT_MEDIAN_FIX,
  FACT_MET_BY_INVENTORY,
  FACT_NO_EXPIRY,
  FACT_NOT_BACKED_UP,
  FACT_NOT_ENCRYPTED,
  FACT_NOT_IN_TRANSIT,
  FACT_OPEN_ISSUES,
  FACT_OWN_KEY,
  FACT_PEOPLE_IN,
  FACT_PITR,
  FACT_PUBLIC_BY_DESIGN,
  FACT_PUBLIC_GRANTS,
  FACT_RECORD_SAYS,
  FACT_RECORDS,
  FACT_REGION_UNKNOWN,
  FACT_RISK_ON,
  FACT_SENDS_TO,
  FACT_SENT_TO,
  FACT_SERVICES_SEEN,
  FACT_SOFT_DELETE,
  FACT_SOME_UP_TO,
  FACT_STORE,
  FACT_STORES,
  FACT_TLS,
  FACT_TURNED_OFF_ON,
  FACT_UNTIL,
  FACT_USED_BY,
  FACT_VERSIONING,
  FACT_WHOLE_FRAMEWORK,
  FACT_WRITE_GRANTS,
  HIDE_FACTS,
  SHOW_FACTS,
  THE_EEA,
  STORES_IN_SCOPE,
} from "./ComplianceDraftsCopy";
import {
  ExposurePill,
  SensitivityPill,
  SeverityPill,
} from "./DataSecurityPills";
import {
  COMPLIANCE_FACT_KIND_TITLES,
  ComplianceFact,
  ComplianceFactKind,
  ComplianceRecency,
} from "Common/Types/DataSecurity/ComplianceFacts";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

/*
 * THE FACTS A DRAFT OF THE PAPERWORK RESTS ON, AS A PERSON READS THEM
 * (#10375).
 *
 * Drawn from the facts themselves - what Data Security's code read, kept
 * with the draft - never from OneUptime AI's words: every name a cloud, a
 * person or a service wrote is drawn as text, set apart (IsolatedText),
 * and every word of OneUptime's is the reader's. One click away from each
 * draft (ComplianceFactsToggle).
 */

export const COMPLIANCE_FACTS_TEST_ID: string =
  "data-security-compliance-facts";

const ROW_CLASS_NAME: string =
  "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-700";
const CODE_CLASS_NAME: string =
  "rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800 [overflow-wrap:anywhere]";

// A country by its ISO code, in the reader's language: "Germany", "Deutschland".
export function getCountryName(
  country: string | null | undefined,
  translator: Translator,
): string {
  if (!country) {
    return translator.translateText(THE_EEA) || THE_EEA;
  }

  try {
    return (
      new Intl.DisplayNames([translator.language || "en"], {
        type: "region",
      }).of(country.toUpperCase()) || country
    );
  } catch {
    return country;
  }
}

function countryList(
  countries: ReadonlyArray<string>,
  translator: Translator,
): string {
  return formatList(
    countries.map((country: string): string => {
      return getCountryName(country, translator);
    }),
    translator,
  );
}

// A customer's text, set apart in the reader's sentence.
function Quoted(props: { text: string }): ReactElement {
  return (
    <span className="text-gray-600 [overflow-wrap:anywhere]">
      “<IsolatedText text={props.text} />”
    </span>
  );
}

const Separator: FunctionComponent = (): ReactElement => {
  return (
    <span aria-hidden="true" className="text-gray-400">
      ·
    </span>
  );
};

// One fact, in the reader's language.
export const ComplianceFactLine: FunctionComponent<{
  fact: ComplianceFact;
}> = (props: { fact: ComplianceFact }): ReactElement => {
  const translator: Translator = useTranslator();
  const fact: ComplianceFact = props.fact;
  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  switch (fact.kind) {
    case ComplianceFactKind.StoreHolds:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.sensitivity ? (
            <SensitivityPill sensitivity={fact.sensitivity} />
          ) : (
            <></>
          )}
          {fact.dataTypes.length > 0 ? (
            <span>
              {translator.translateTemplate(FACT_HOLDS, {
                dataTypes: composedValue((sentence: Translator): string => {
                  return formatList(
                    fact.dataTypes.map((name: string): string => {
                      return sentence.translateText(name) || name;
                    }),
                    sentence,
                  );
                }),
              })}
            </span>
          ) : (
            <></>
          )}
          {fact.records !== undefined ? (
            <span>
              {translator.translatePlural(FACT_RECORDS, fact.records)}
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.StoreIdentity:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_STORE, {
              name: fact.name,
              kind: fact.storeKind,
            })}
          </span>
          {fact.description ? <Quoted text={fact.description} /> : <></>}
        </span>
      );
    case ComplianceFactKind.StoreTags:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.tags.map((tag: [string, string]): ReactElement => {
            return (
              <code key={tag[0]} className={CODE_CLASS_NAME}>
                {tag[0]}={tag[1]}
              </code>
            );
          })}
        </span>
      );
    case ComplianceFactKind.Location:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {fact.region
              ? fact.country || fact.isInEea
                ? translator.translateTemplate(FACT_KEPT_IN_COUNTRY, {
                    region: fact.region,
                    country: getCountryName(fact.country, translator),
                  })
                : translator.translateTemplate(FACT_KEPT_IN, {
                    region: fact.region,
                  })
              : text(FACT_REGION_UNKNOWN)}
          </span>
          {fact.replicationRegions.length > 0 ? (
            <>
              <Separator />
              <span>
                {translator.translateTemplate(FACT_COPIED_TO, {
                  regions: formatList(fact.replicationRegions, translator),
                })}
              </span>
            </>
          ) : (
            <></>
          )}
          {fact.subjectCountries.length > 0 ? (
            <>
              <Separator />
              <span>
                {translator.translateTemplate(FACT_PEOPLE_IN, {
                  countries: composedValue((sentence: Translator): string => {
                    return countryList(fact.subjectCountries, sentence);
                  }),
                })}
              </span>
            </>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.ServiceUse:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_USED_BY, {
              service: fact.service,
            })}
          </span>
          {fact.description ? <Quoted text={fact.description} /> : <></>}
        </span>
      );
    case ComplianceFactKind.ExternalHost:
      return (
        <span className={ROW_CLASS_NAME}>
          {translator.translateTemplate(FACT_CALLS, {
            service: fact.via,
            host: fact.host,
          })}
        </span>
      );
    case ComplianceFactKind.AiProvider:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.via
            ? translator.translateTemplate(FACT_SENDS_TO, {
                service: fact.via,
                provider: fact.provider,
              })
            : translator.translateTemplate(FACT_SENT_TO, {
                provider: fact.provider,
              })}
        </span>
      );
    case ComplianceFactKind.Copy:
      return (
        <span className={ROW_CLASS_NAME}>
          {translator.translateTemplate(
            fact.isCopyOfThisStore ? FACT_HOLDS_COPY : FACT_IS_COPY,
            { store: fact.otherStore },
          )}
          {fact.otherRegion ? (
            <>
              <Separator />
              <span>
                {translator.translateTemplate(
                  fact.otherCountry ? FACT_KEPT_IN_COUNTRY : FACT_KEPT_IN,
                  {
                    region: fact.otherRegion,
                    country: getCountryName(fact.otherCountry, translator),
                  },
                )}
              </span>
            </>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.Backups: {
      const parts: Array<string> = [
        fact.backupsEnabled === true
          ? text(FACT_BACKED_UP)
          : fact.backupsEnabled === false
            ? text(FACT_NOT_BACKED_UP)
            : "",
        fact.backupRetentionDays !== undefined
          ? translator.translatePlural(
              FACT_BACKUPS_KEPT,
              fact.backupRetentionDays,
            )
          : "",
        fact.pointInTimeRecovery === true ? text(FACT_PITR) : "",
        fact.versioning === true ? text(FACT_VERSIONING) : "",
        fact.softDelete === true ? text(FACT_SOFT_DELETE) : "",
        fact.deletionProtection === true ? text(FACT_DELETION_PROTECTION) : "",
      ].filter(Boolean);

      return (
        <span className={ROW_CLASS_NAME}>
          {parts.map((part: string, index: number): ReactElement => {
            return (
              <Fragment key={part}>
                {index > 0 ? <Separator /> : <></>}
                <span>{part}</span>
              </Fragment>
            );
          })}
        </span>
      );
    }
    case ComplianceFactKind.TelemetryRetention:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>{translator.translatePlural(FACT_KEEPS_FOR, fact.days)}</span>
          {fact.maxDays && fact.maxDays > fact.days ? (
            <>
              <Separator />
              <span>
                {translator.translatePlural(FACT_SOME_UP_TO, fact.maxDays)}
              </span>
            </>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.DeclaredCode:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_DECLARED_IN, {
              repository: fact.repository,
            })}
          </span>
          {fact.paths.map((path: string): ReactElement => {
            return (
              <code key={path} className={CODE_CLASS_NAME}>
                {path}
              </code>
            );
          })}
        </span>
      );
    case ComplianceFactKind.Exposure:
      return (
        <span className={ROW_CLASS_NAME}>
          <ExposurePill exposure={fact.exposure} />
          {fact.isPublicByDesign ? (
            <span>{text(FACT_PUBLIC_BY_DESIGN)}</span>
          ) : (
            <></>
          )}
          {fact.publicReason ? <Quoted text={fact.publicReason} /> : <></>}
        </span>
      );
    case ComplianceFactKind.Encryption: {
      const parts: Array<string> = [
        fact.encryptedAtRest === true
          ? text(FACT_ENCRYPTED)
          : fact.encryptedAtRest === false
            ? text(FACT_NOT_ENCRYPTED)
            : "",
        fact.customerManagedKey === true ? text(FACT_OWN_KEY) : "",
        fact.encryptionInTransitEnforced === true
          ? text(FACT_IN_TRANSIT)
          : fact.encryptionInTransitEnforced === false
            ? text(FACT_NOT_IN_TRANSIT)
            : "",
        fact.minimumTlsVersion
          ? translator.translateTemplate(FACT_TLS, {
              version: fact.minimumTlsVersion,
            })
          : "",
      ].filter(Boolean);

      return (
        <span className={ROW_CLASS_NAME}>
          {parts.map((part: string, index: number): ReactElement => {
            return (
              <Fragment key={part}>
                {index > 0 ? <Separator /> : <></>}
                <span>{part}</span>
              </Fragment>
            );
          })}
        </span>
      );
    }
    case ComplianceFactKind.Reach:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translatePlural(FACT_IDENTITIES, fact.identities)}
          </span>
          <Separator />
          <span>
            {translator.translatePlural(FACT_PUBLIC_GRANTS, fact.publicGrants)}
          </span>
          <Separator />
          <span>
            {translator.translatePlural(
              FACT_EXTERNAL_GRANTS,
              fact.externalGrants,
            )}
          </span>
          <Separator />
          <span>
            {translator.translatePlural(FACT_WRITE_GRANTS, fact.writeGrants)}
          </span>
          <Separator />
          <span>
            {translator.translatePlural(FACT_SERVICES_SEEN, fact.servicesSeen)}
          </span>
        </span>
      );
    case ComplianceFactKind.OpenIssue:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.severity ? <SeverityPill severity={fact.severity} /> : <></>}
          <span className="[overflow-wrap:anywhere]">
            <IsolatedText text={fact.title} />
          </span>
        </span>
      );
    case ComplianceFactKind.FixedIssue:
      return (
        <span className={ROW_CLASS_NAME}>
          <span className="text-gray-500">
            {text(
              fact.fixed === ComplianceRecency.Week
                ? FACT_FIXED_WEEK
                : fact.fixed === ComplianceRecency.Month
                  ? FACT_FIXED_MONTH
                  : FACT_FIXED_QUARTER,
            )}
          </span>
          <span className="[overflow-wrap:anywhere]">
            <IsolatedText text={fact.title} />
          </span>
        </span>
      );
    case ComplianceFactKind.RecordEntry:
      return (
        <span className={ROW_CLASS_NAME}>
          <span className="text-gray-500">
            {translator.translateTemplate(FACT_RECORD_SAYS, {
              field: fact.field,
            })}
          </span>
          <Quoted text={fact.value} />
        </span>
      );
    case ComplianceFactKind.RequirementScope:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translatePlural(STORES_IN_SCOPE, fact.stores)}
          </span>
          {fact.storeNames.length > 0 ? (
            <span className="text-gray-600 [overflow-wrap:anywhere]">
              <IsolatedText text={fact.storeNames.join(", ")} />
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.CheckState:
      return (
        <span className={ROW_CLASS_NAME}>
          {fact.checks === 0 ? (
            <span>{text(FACT_MET_BY_INVENTORY)}</span>
          ) : fact.failingChecks.length === 0 ? (
            <span>
              {translator.translatePlural(FACT_ALL_CHECKS_PASS, fact.checks)}
            </span>
          ) : (
            <>
              <span>
                {translator.translateTemplate(FACT_CHECKS_FAIL, {
                  failing: translator.formatNumber(fact.failingChecks.length),
                  checks: translator.formatNumber(fact.checks),
                  stores: composedValue((sentence: Translator): string => {
                    return sentence.translatePlural(
                      FACT_STORES,
                      fact.failingStores,
                    );
                  }),
                })}
              </span>
              <Separator />
              <span>
                {translator.translatePlural(FACT_OPEN_ISSUES, fact.openIssues)}
              </span>
              <span className="text-gray-600">
                {formatList(
                  fact.failingChecks.map((title: string): string => {
                    return translator.translateText(title) || title;
                  }),
                  translator,
                )}
              </span>
            </>
          )}
        </span>
      );
    case ComplianceFactKind.IssueHistory:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_HISTORY, {
              opened: translator.formatNumber(fact.opened),
              fixed: translator.formatNumber(fact.fixed),
              open: translator.formatNumber(fact.stillOpen),
            })}
          </span>
          {fact.medianHoursToFix !== undefined ? (
            <>
              <Separator />
              <span>
                {translator.translatePlural(
                  FACT_MEDIAN_FIX,
                  fact.medianHoursToFix,
                )}
              </span>
            </>
          ) : (
            <></>
          )}
        </span>
      );
    case ComplianceFactKind.AcceptedRisk:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_RISK_ON, { store: fact.store })}
          </span>
          {fact.reason ? <Quoted text={fact.reason} /> : <></>}
          <Separator />
          <span>
            {fact.until
              ? translator.translateTemplate(FACT_UNTIL, { date: fact.until })
              : text(FACT_NO_EXPIRY)}
          </span>
        </span>
      );
    case ComplianceFactKind.TurnedOff:
      return (
        <span className={ROW_CLASS_NAME}>
          <span>
            {translator.translateTemplate(FACT_TURNED_OFF_ON, {
              resource: fact.resource,
            })}
          </span>
          {fact.isWholeFramework ? (
            <span className="text-gray-500">{text(FACT_WHOLE_FRAMEWORK)}</span>
          ) : (
            <></>
          )}
          {fact.reason ? <Quoted text={fact.reason} /> : <></>}
        </span>
      );
    default:
      return <></>;
  }
};

// A list of facts, each with what kind of fact it is.
export const ComplianceFactList: FunctionComponent<{
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId?: string | undefined;
}> = (props: {
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ul
      className="mt-2 space-y-2 border-s-2 border-indigo-100 ps-3"
      data-testid={props.dataTestId || COMPLIANCE_FACTS_TEST_ID}
    >
      {props.facts.map((fact: ComplianceFact): ReactElement => {
        return (
          <li key={fact.key} className="space-y-0.5">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {translator.translateText(COMPLIANCE_FACT_KIND_TITLES[fact.kind])}
            </div>
            <ComplianceFactLine fact={fact} />
          </li>
        );
      })}
    </ul>
  );
};

/*
 * "Show the 3 facts it rests on", one click from a draft: the list opens
 * under it, and the same press closes it.
 */
export const ComplianceFactsToggle: FunctionComponent<{
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId?: string | undefined;
}> = (props: {
  facts: ReadonlyArray<ComplianceFact>;
  dataTestId?: string | undefined;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (props.facts.length === 0) {
    return <></>;
  }

  return (
    <div>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded text-sm font-medium text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen(!isOpen);
        }}
        data-testid={`${props.dataTestId || COMPLIANCE_FACTS_TEST_ID}-toggle`}
      >
        <Icon
          icon={isOpen ? IconProp.ChevronUp : IconProp.ChevronDown}
          className="h-4 w-4"
        />
        <span>
          {isOpen
            ? translator.translateText(HIDE_FACTS)
            : translator.translatePlural(SHOW_FACTS, props.facts.length)}
        </span>
      </button>
      {isOpen ? (
        <ComplianceFactList facts={props.facts} dataTestId={props.dataTestId} />
      ) : (
        <></>
      )}
    </div>
  );
};

// The facts of a list that keys name, in the list's order.
export function getFactsByKeys(
  facts: ReadonlyArray<ComplianceFact>,
  keys: ReadonlyArray<string>,
): Array<ComplianceFact> {
  return facts.filter((fact: ComplianceFact): boolean => {
    return keys.includes(fact.key);
  });
}
