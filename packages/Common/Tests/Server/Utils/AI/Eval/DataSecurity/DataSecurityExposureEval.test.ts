import {
  BREACH_LAW_RULES,
  BreachDataElement,
  BreachLawFamily,
  BreachLawId,
  BreachLawRule,
  BreachPlace,
  getBreachLawRule,
  isUsStateRule,
} from "../../../../../../Types/DataSecurity/BreachLaws";
import {
  BreachObligationFact,
  ComplianceFact,
  ComplianceFactKind,
  UsStateLawsFact,
} from "../../../../../../Types/DataSecurity/ComplianceFacts";
import { DataSecurityAiFeature } from "../../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  BreachObligation,
  BreachObligationStatus,
  ExposureAssessmentView,
  ExposureDraftPart,
  ExposureSecret,
  isAssessedOnItsOwn,
  isBreachLawForFacts,
  isBreachLawInForce,
  UncoveredLawKind,
} from "../../../../../../Types/DataSecurity/ExposureAssessment";
import { ExposureAssessmentEvalCase } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import DATA_SECURITY_EVAL_CASES from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCases";
import {
  exposureAssessmentCall,
  scoreExposureAssessment,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityExposureEval";
import { EXPOSURE_ASSESSMENT_CASES } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityExposureEvalCases";
import {
  EXPOSURE_EVAL_EXPOSURES,
  ExposureEvalExposure,
  getExposureEvalExposure,
  getExposureEvalFacts,
  getExposureEvalView,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityExposureEvalSet";
import { PaperworkEvalCall } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityPaperworkEval";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { describe, expect, test } from "@jest/globals";
import {
  getExposureFactIds,
  getGoodExposureAnswer,
} from "./ExposureEvalAnswers";

/*
 * THE EXPOSURE EVAL SET (#10377): EACH MADE-UP EXPOSURE LISTS THE
 * OBLIGATIONS IT SHOULD, AND ONEUPTIME AI'S WRITE-UP IS SCORED AS THE
 * PRODUCT HOLDS IT.
 *
 * Plain code decides which breach laws may apply; this is its eval set: an
 * exposure of EU customers' emails lists GDPR's 72 hours first, Texas
 * patients' records the attorney general's 30 days, a Brazilian bucket the
 * ANPD's three business days, Aadhaar numbers CERT-In's six hours, a bucket
 * of website images nothing - and every other row of the table is not
 * triggered, or not in force yet.
 */

function sorted(ids: ReadonlyArray<BreachLawId>): Array<BreachLawId> {
  return [...ids].sort();
}

function idsWhere(
  view: ExposureAssessmentView,
  predicate: (obligation: BreachObligation) => boolean,
): Array<BreachLawId> {
  return sorted(
    view.obligations
      .filter(predicate)
      .map((obligation: BreachObligation): BreachLawId => {
        return obligation.ruleId;
      }),
  );
}

describe("every exposure of the eval set lists the obligations it should", () => {
  test.each(
    EXPOSURE_EVAL_EXPOSURES.map(
      (exposure: ExposureEvalExposure): [string, ExposureEvalExposure] => {
        return [exposure.id, exposure];
      },
    ),
  )("%s", (_id: string, exposure: ExposureEvalExposure) => {
    const view: ExposureAssessmentView = getExposureEvalView(exposure);
    const expectation: ExposureEvalExposure["expect"] = exposure.expect;

    expect(
      isAssessedOnItsOwn({
        severity: exposure.issues[0]!.severity,
        checkId: exposure.issues[0]!.checkId,
        sensitivity: exposure.store.sensitivity || DataSensitivity.Public,
      }),
    ).toBe(expectation.isAssessedOnItsOwn);

    expect(
      idsWhere(view, (obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          obligation.isPlaceKnown
        );
      }),
    ).toEqual(sorted(expectation.mayApplyKnown));
    expect(
      idsWhere(view, (obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          !obligation.isPlaceKnown
        );
      }),
    ).toEqual(sorted(expectation.mayApplyIfPlace));
    expect(
      idsWhere(view, (obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotYetInForce;
      }),
    ).toEqual(sorted(expectation.notYetInForce));

    /*
     * Every other row of this exposure is not triggered: none is left out.
     * The exposure's rows are every row but one a newer text replaced before
     * it was found (#11425) and the notices to the data's owner, while
     * nobody says the data is held for another (#11427).
     */
    const listed: Set<BreachLawId> = new Set([
      ...expectation.mayApplyKnown,
      ...expectation.mayApplyIfPlace,
      ...expectation.notYetInForce,
    ]);
    const foundAt: Date = view.window
      ? new Date(view.window.foundAt)
      : new Date(view.now);

    expect(
      idsWhere(view, (obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotTriggered;
      }),
    ).toEqual(
      sorted(
        BREACH_LAW_RULES.filter((rule: BreachLawRule): boolean => {
          return isBreachLawForFacts(rule, {
            foundAt,
            holdsForAnother: view.holdsForAnother,
          });
        })
          .map((rule: BreachLawRule): BreachLawId => {
            return rule.id;
          })
          .filter((id: BreachLawId): boolean => {
            return !listed.has(id);
          }),
      ),
    );
    // A notice to the data's owner is among its laws only where a person said the data is held for another.
    expect(view.holdsForAnother).toBe(exposure.holdsForAnother);
    expect(
      view.obligations.some((obligation: BreachObligation): boolean => {
        return getBreachLawRule(obligation.ruleId).forDataHolders === true;
      }),
    ).toBe(exposure.holdsForAnother === true);

    // The notice due first, and its moment: none for one owed immediately.
    expect(view.mostUrgent?.ruleId || null).toBe(expectation.mostUrgent);
    expect(view.mostUrgent?.dueAt).toBe(expectation.mostUrgentDueAt);

    expect(view.reads.isTreatedAsRead).toBe(expectation.readsTreatedAsRead);
    expect(view.isPlaceUnknown).toBe(expectation.isPlaceUnknown);

    if (expectation.windowDays !== undefined) {
      expect(view.window!.days).toBe(expectation.windowDays);
    }
  });

  test("the set covers what the issue asks: EU emails, website images, every place and both ways reads go", () => {
    const ids: Array<string> = EXPOSURE_EVAL_EXPOSURES.map(
      (exposure: ExposureEvalExposure): string => {
        return exposure.id;
      },
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        "eu-customer-emails-public",
        "website-images-public",
        "us-patient-records-texas",
        "brazil-cpf-emails",
        "india-aadhaar-public",
        "india-aadhaar-after-dpdp",
        "california-cards-credentials",
        "uk-nino-snapshot",
        "secrets-only-bucket",
        "newsletter-emails-place-unknown",
        "japan-my-number",
        "exposed-by-a-logged-change",
        // #11424 to #11427: data held for another, and the territories by their country codes.
        "us-patient-records-texas-for-a-clinic",
        "eu-and-uk-emails-for-a-client",
        "territories-ssn-by-country-code",
      ]),
    );
    expect(new Set(ids).size).toBe(ids.length);

    // Every row of the table may apply in at least one exposure.
    const everApplies: Set<BreachLawId> = new Set(
      EXPOSURE_EVAL_EXPOSURES.flatMap(
        (exposure: ExposureEvalExposure): Array<BreachLawId> => {
          return [
            ...exposure.expect.mayApplyKnown,
            ...exposure.expect.mayApplyIfPlace,
          ];
        },
      ),
    );

    /*
     * Every row may apply to some exposure of the set - but the US states'
     * notices to the data's owner (#11427), of which the set holds Texas's:
     * each of the others is held to its statute, and to the answer it waits
     * on, in UsStateBreachLaws.test.ts.
     */
    for (const rule of BREACH_LAW_RULES) {
      expect({ rule: rule.id, applies: everApplies.has(rule.id) }).toEqual({
        rule: rule.id,
        applies:
          !(rule.forDataHolders && isUsStateRule(rule)) ||
          rule.id === BreachLawId.TexasDataOwner,
      });
    }

    // Both answers to whose data it is, and none.
    expect(
      new Set(
        EXPOSURE_EVAL_EXPOSURES.map(
          (exposure: ExposureEvalExposure): boolean | undefined => {
            return exposure.holdsForAnother;
          },
        ),
      ),
    ).toEqual(new Set([true, undefined]));

    // Both ways reads go: logged, not logged and not known.
    expect(
      new Set(
        EXPOSURE_EVAL_EXPOSURES.map(
          (exposure: ExposureEvalExposure): string => {
            return getExposureEvalView(exposure).reads.logged;
          },
        ),
      ),
    ).toEqual(new Set(["Logged", "NotLogged", "Unknown"]));
  });

  test("every US state's law covers a Social Security number and a bank account number held with a name, so all of them wait on which states (#10952)", () => {
    for (const rule of BREACH_LAW_RULES.filter(isUsStateRule)) {
      expect({
        rule: rule.id,
        coversSsn: rule.dataElements.includes(
          BreachDataElement.SocialSecurityNumber,
        ),
        coversAccount: rule.dataElements.includes(
          BreachDataElement.FinancialAccount,
        ),
      }).toEqual({ rule: rule.id, coversSsn: true, coversAccount: true });
    }
  });

  test("nobody said which states: OneUptime AI is told how many states' notices wait on it, and is given none of them (#10952)", () => {
    const exposure: ExposureEvalExposure = getExposureEvalExposure(
      "us-ssn-state-not-said",
    );
    const facts: Array<ComplianceFact> = getExposureEvalFacts(exposure).facts;
    const foundAt: Date = new Date(
      getExposureEvalView(exposure).window!.foundAt,
    );
    /*
     * The states' rows of this exposure in force the day it was found: not
     * Vermont's from 2027 (#11425), nor the notices to the data's owner,
     * which wait on a person's answer (#11427).
     */
    const stateRows: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return (
          isUsStateRule(rule) &&
          isBreachLawForFacts(rule, { foundAt }) &&
          isBreachLawInForce(rule, foundAt)
        );
      },
    );
    const summary: UsStateLawsFact = facts.find(
      (fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.UsStateLaws;
      },
    ) as UsStateLawsFact;

    expect(summary).toMatchObject({
      key: "obligation:us-states",
      notices: stateRows.length,
      states: new Set(
        stateRows.map((rule: BreachLawRule): string => {
          return rule.places![0]!;
        }),
      ).size,
    });
    // No state's notice is a fact of its own, so no draft can name one.
    expect(
      facts.filter((fact: ComplianceFact): boolean => {
        return (
          fact.kind === ComplianceFactKind.BreachObligation &&
          stateRows.some((rule: BreachLawRule): boolean => {
            return rule.id === (fact as BreachObligationFact).ruleId;
          })
        );
      }),
    ).toEqual([]);
  });

  test("a person named Indiana and Hawaii: their notices are facts, and no other state's (#10952)", () => {
    const facts: Array<ComplianceFact> = getExposureEvalFacts(
      getExposureEvalExposure("indiana-and-hawaii-ssn"),
    ).facts;
    const families: Array<string> = facts
      .filter((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.BreachObligation;
      })
      .map((fact: ComplianceFact): string => {
        return (fact as BreachObligationFact).family;
      });

    expect(families).toEqual(
      expect.arrayContaining([BreachLawFamily.Indiana, BreachLawFamily.Hawaii]),
    );
    expect(
      families
        .filter((family: string): boolean => {
          return BREACH_LAW_RULES.some((rule: BreachLawRule): boolean => {
            return isUsStateRule(rule) && rule.family === family;
          });
        })
        .sort(),
    ).toEqual([
      BreachLawFamily.Hawaii,
      BreachLawFamily.Hawaii,
      BreachLawFamily.Hawaii,
      BreachLawFamily.Indiana,
      BreachLawFamily.Indiana,
      BreachLawFamily.Indiana,
    ]);
    // Every state named is known: nothing waits on where the people live.
    expect(
      facts.some((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.UsStateLaws;
      }),
    ).toBe(false);
  });

  test("a person said the records are held for the clinics: Texas's notice to the owner is due first, immediately, and OneUptime AI is told of it (#11427)", () => {
    const exposure: ExposureEvalExposure = getExposureEvalExposure(
      "us-patient-records-texas-for-a-clinic",
    );
    const view: ExposureAssessmentView = getExposureEvalView(exposure);
    const facts: Array<ComplianceFact> = getExposureEvalFacts(exposure).facts;
    const owner: BreachObligationFact | undefined = facts.find(
      (fact: ComplianceFact): boolean => {
        return fact.key === `obligation:${BreachLawId.TexasDataOwner}`;
      },
    ) as BreachObligationFact | undefined;

    expect(view.mostUrgent).toMatchObject({
      ruleId: BreachLawId.TexasDataOwner,
      status: BreachObligationStatus.MayApply,
      isPlaceKnown: true,
      foundAt: "2026-11-16T15:30:00.000Z",
    });
    expect(view.mostUrgent!.dueAt).toBeUndefined();
    // Listed first of the notices that may apply: the attorney general's 30 days after it.
    expect(view.obligations[0]!.ruleId).toBe(BreachLawId.TexasDataOwner);
    expect(view.obligations[1]!.ruleId).toBe(BreachLawId.TexasAttorneyGeneral);
    expect(owner).toMatchObject({
      kind: ComplianceFactKind.BreachObligation,
      family: BreachLawFamily.Texas,
      status: BreachObligationStatus.MayApply,
      deadline: "immediately",
      countsFrom: "2026-11-16T15:30:00.000Z",
    });
    expect(owner!.dueAt).toBeUndefined();
    expect(
      facts.some((fact: ComplianceFact): boolean => {
        return fact.key === `obligation:${BreachLawId.HipaaBusinessAssociate}`;
      }),
    ).toBe(true);

    // The prompt names it as the notice due first.
    const data: { dueFirst: string } = JSON.parse(
      exposureAssessmentCall({
        id: "texas-for-a-clinic",
        title: "Texas, held for the clinics",
        feature: DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
        exposure,
        expect: { parts: {}, never: [] },
      }).messages[1]!.content as string,
    );

    expect(data.dueFirst).toBe(owner!.id);
  });

  test("the answer is what says whose data it is: unanswered, the table says what it leaves out; answered, it does not (#11427)", () => {
    const unanswered: ExposureAssessmentView = getExposureEvalView(
      getExposureEvalExposure("us-patient-records-texas"),
    );
    const answered: ExposureAssessmentView = getExposureEvalView(
      getExposureEvalExposure("us-patient-records-texas-for-a-clinic"),
    );
    const own: ExposureAssessmentView = getExposureEvalView({
      ...getExposureEvalExposure("us-patient-records-texas"),
      holdsForAnother: false,
    });
    const kinds: (view: ExposureAssessmentView) => Array<UncoveredLawKind> = (
      view: ExposureAssessmentView,
    ): Array<UncoveredLawKind> => {
      return view.uncovered.map(
        (line: ExposureAssessmentView["uncovered"][number]): UncoveredLawKind => {
          return line.kind;
        },
      );
    };

    expect(kinds(unanswered)).toContain(UncoveredLawKind.DataHeldForAnother);
    expect(kinds(answered)).not.toContain(UncoveredLawKind.DataHeldForAnother);
    expect(kinds(own)).not.toContain(UncoveredLawKind.DataHeldForAnother);
    // The organization's own data: the same notices as nobody answering, and none to an owner.
    expect(
      own.obligations.map((obligation: BreachObligation): string => {
        return `${obligation.ruleId}:${obligation.status}`;
      }),
    ).toEqual(
      unanswered.obligations.map((obligation: BreachObligation): string => {
        return `${obligation.ruleId}:${obligation.status}`;
      }),
    );
    expect(own.mostUrgent?.ruleId).toBe(BreachLawId.TexasAttorneyGeneral);
  });

  test("Puerto Rico, Guam and the US Virgin Islands by the data's country codes: their notices are facts of their own, and the states' are counted without them (#11424, #11426)", () => {
    const exposure: ExposureEvalExposure = getExposureEvalExposure(
      "territories-ssn-by-country-code",
    );
    const view: ExposureAssessmentView = getExposureEvalView(exposure);
    const facts: Array<ComplianceFact> = getExposureEvalFacts(exposure).facts;
    const territories: Array<BreachLawId> = [
      BreachLawId.PuertoRicoResidents,
      BreachLawId.PuertoRicoConsumerAffairs,
      BreachLawId.GuamResidents,
      BreachLawId.UsVirginIslandsResidents,
    ];
    // In the table's order of places.
    const territoryPlaces: Array<BreachPlace> = [
      BreachPlace.Guam,
      BreachPlace.PuertoRico,
      BreachPlace.UsVirginIslands,
    ];

    expect(view.whose.placesNamed).toBeUndefined();
    expect(view.whose.places).toEqual(territoryPlaces);
    // Not countries the table leaves out: each has its law in the table.
    expect(
      view.uncovered.some(
        (line: ExposureAssessmentView["uncovered"][number]): boolean => {
          return line.kind === UncoveredLawKind.OtherCountries;
        },
      ),
    ).toBe(false);

    for (const id of territories) {
      expect({
        id,
        isFact: facts.some((fact: ComplianceFact): boolean => {
          return fact.key === `obligation:${id}`;
        }),
      }).toEqual({ id, isFact: true });
    }

    // Guam's law asks only where the breach causes, or will likely cause, identity theft or fraud.
    expect(
      (
        facts.find((fact: ComplianceFact): boolean => {
          return fact.key === `obligation:${BreachLawId.GuamResidents}`;
        }) as BreachObligationFact
      ).checks.length,
    ).toBeGreaterThan(0);

    // The states' notices nobody named are counted in one fact, without the territories'.
    const others: Array<BreachLawRule> = BREACH_LAW_RULES.filter(
      (rule: BreachLawRule): boolean => {
        return (
          isUsStateRule(rule) &&
          view.obligations.some((obligation: BreachObligation): boolean => {
            return (
              obligation.ruleId === rule.id &&
              obligation.status === BreachObligationStatus.MayApply &&
              !obligation.isPlaceKnown
            );
          })
        );
      },
    );

    expect(others.length).toBeGreaterThan(100);
    expect(
      others.some((rule: BreachLawRule): boolean => {
        return (
          territories.includes(rule.id) ||
          territoryPlaces.includes(rule.places![0]!)
        );
      }),
    ).toBe(false);
    expect(
      facts.find((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.UsStateLaws;
      }),
    ).toMatchObject({
      notices: others.length,
      states: new Set(
        others.map((rule: BreachLawRule): BreachPlace => {
          return rule.places![0]!;
        }),
      ).size,
    });
  });

  test("a Japanese bucket says the table does not cover Japan", () => {
    expect(
      getExposureEvalView(getExposureEvalExposure("japan-my-number")).uncovered,
    ).toEqual(
      expect.arrayContaining([
        { kind: UncoveredLawKind.OtherCountries, countries: ["JP"] },
      ]),
    );
    expect(() => {
      return getExposureEvalExposure("no-such-exposure");
    }).toThrow();
  });

  test("the bucket of cloud keys lists them to rotate, by type and where, never a value", () => {
    const view: ExposureAssessmentView = getExposureEvalView(
      getExposureEvalExposure("secrets-only-bucket"),
    );

    expect(
      view.secretsToRotate.map((secret: ExposureSecret): string => {
        return secret.location;
      }),
    ).toEqual(["deploy/env.sh", "keys/*.pem"]);
    expect(view.mostUrgent).toBeNull();
  });
});

describe("OneUptime AI's write-up of an exposure, asked and scored as the product does", () => {
  test("every write-up case is in the corpus, under both features", () => {
    for (const testCase of EXPOSURE_ASSESSMENT_CASES) {
      expect(DATA_SECURITY_EVAL_CASES).toContain(testCase);
    }

    expect(
      new Set(
        EXPOSURE_ASSESSMENT_CASES.map(
          (testCase: ExposureAssessmentEvalCase): string => {
            return testCase.feature;
          },
        ),
      ),
    ).toEqual(
      new Set([
        DataSecurityAiFeature.DraftExposureAssessment,
        DataSecurityAiFeature.DraftExposureAssessmentOnRequest,
      ]),
    );
  });

  test("its input is the product's: the instructions, then the facts, with the notice due first", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;
    const call: PaperworkEvalCall = exposureAssessmentCall(testCase);
    const facts: Array<ComplianceFact> = getExposureEvalFacts(
      testCase.exposure,
    ).facts;
    const gdpr: ComplianceFact = facts.find((fact: ComplianceFact): boolean => {
      return fact.key === `obligation:${BreachLawId.GdprAuthority}`;
    })!;

    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]!.role).toBe("system");
    expect(call.messages[0]!.content).toContain("not legal advice");
    expect(call.messages[0]!.content).toContain("never say nobody read it");
    expect(call.temperature).toBe(0);

    const data: {
      write: Array<{ part: string }>;
      dueFirst: string;
      facts: Array<{ id: string }>;
    } = JSON.parse(call.messages[1]!.content as string);

    expect(data.dueFirst).toBe(gdpr.id);
    expect(
      data.write.map((entry: { part: string }): string => {
        return entry.part;
      }),
    ).toEqual([
      ExposureDraftPart.Explanation,
      ExposureDraftPart.RegulatorNotice,
      ExposureDraftPart.PeopleNotice,
      ExposureDraftPart.InternalSummary,
    ]);
    expect(data.facts).toHaveLength(facts.length);
    /*
     * The window, the reads and every row of the table are facts - but the
     * US states' nobody named, which never crowd the rest out (#10952), and
     * the notices to the data's owner, which wait on someone saying the
     * data is held for another (#11427).
     */
    expect(
      facts.filter((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.BreachObligation;
      }),
    ).toHaveLength(
      BREACH_LAW_RULES.filter((rule: BreachLawRule): boolean => {
        return !isUsStateRule(rule) && !rule.forDataHolders;
      }).length,
    );
    expect(
      facts.some((fact: ComplianceFact): boolean => {
        return fact.kind === ComplianceFactKind.ExposureWindow;
      }),
    ).toBe(true);
  });

  test.each(
    EXPOSURE_ASSESSMENT_CASES.map(
      (
        testCase: ExposureAssessmentEvalCase,
      ): [string, ExposureAssessmentEvalCase] => {
        return [testCase.id, testCase];
      },
    ),
  )(
    "%s: a right answer passes",
    (_id: string, testCase: ExposureAssessmentEvalCase) => {
      expect(
        scoreExposureAssessment(testCase, getGoodExposureAnswer(testCase)),
      ).toEqual({ passed: true, notes: [] });
    },
  );

  test("an answer that is not one, or says nothing, fails", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;

    expect(scoreExposureAssessment(testCase, "Sure! Here it is.").passed).toBe(
      false,
    );
    expect(scoreExposureAssessment(testCase, "{}").notes).toEqual(
      expect.arrayContaining(["explanation was not written"]),
    );
  });

  test("a write-up that says nobody read data whose reads were not logged fails", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;
    const good: Record<string, { markdown: string; facts: Array<string> }> =
      JSON.parse(getGoodExposureAnswer(testCase));

    good[ExposureDraftPart.PeopleNotice] = {
      markdown:
        "Your email address was in the store, but nobody read it while it was open.",
      facts: good[ExposureDraftPart.PeopleNotice]!.facts,
    };

    expect(
      scoreExposureAssessment(testCase, JSON.stringify(good)).notes,
    ).toEqual(expect.arrayContaining(['says "nobody read"']));
  });

  test("a notice with a number the facts do not hold is dropped, and so fails", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;
    const good: Record<string, { markdown: string; facts: Array<string> }> =
      JSON.parse(getGoodExposureAnswer(testCase));

    good[ExposureDraftPart.RegulatorNotice] = {
      markdown:
        "About 50,000 email addresses were exposed in 2026, which we report to you now.",
      facts: good[ExposureDraftPart.RegulatorNotice]!.facts,
    };

    expect(
      scoreExposureAssessment(testCase, JSON.stringify(good)).notes,
    ).toEqual(
      expect.arrayContaining(["regulatorNotice was dropped: UnfoundedNumber"]),
    );
  });

  test("a notice citing a law that does not apply is dropped, and so fails", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;
    const good: Record<string, { markdown: string; facts: Array<string> }> =
      JSON.parse(getGoodExposureAnswer(testCase));

    good[ExposureDraftPart.RegulatorNotice] = {
      markdown:
        "Under HIPAA we report that 48,000 email addresses were exposed in 2026.",
      facts: getExposureFactIds(testCase, [
        "store:holds",
        `obligation:${BreachLawId.HipaaPeople}`,
      ]),
    };

    expect(
      scoreExposureAssessment(testCase, JSON.stringify(good)).notes,
    ).toEqual(
      expect.arrayContaining(["regulatorNotice was dropped: UnfoundedLaw"]),
    );
  });

  test("a part that leaves out what the case names fails, saying which", () => {
    const testCase: ExposureAssessmentEvalCase = EXPOSURE_ASSESSMENT_CASES[0]!;
    const good: Record<string, { markdown: string; facts: Array<string> }> =
      JSON.parse(getGoodExposureAnswer(testCase));

    good[ExposureDraftPart.Explanation] = {
      markdown:
        "The store was open to anyone. Treat the data as read, and tell the authority soon.",
      facts: good[ExposureDraftPart.Explanation]!.facts,
    };

    expect(
      scoreExposureAssessment(testCase, JSON.stringify(good)).notes,
    ).toEqual(
      expect.arrayContaining([
        "explanation does not say 72",
        "explanation does not say GDPR",
      ]),
    );
  });
});
