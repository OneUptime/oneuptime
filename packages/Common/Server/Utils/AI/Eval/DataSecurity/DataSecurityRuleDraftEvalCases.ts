import DataCategory from "../../../../../Types/DataSecurity/DataCategory";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataSecurityRuleKind } from "../../../../../Types/DataSecurity/DataSecurityRuleDraft";
import { RuleFromSentenceEvalCase } from "./DataSecurityEvalCase";

/*
 * RULES FROM A SENTENCE (#10378): what a person says to Ask AI or to an
 * agent on the MCP server, and the rule it should become. Made-up projects:
 * the labels and teams are the names the draft is told.
 */

const LABELS: Array<string> = ["PCI", "Production", "Customer data"];
const TEAMS: Array<string> = ["Payments", "Platform", "Data"];

export const RULE_FROM_SENTENCE_EVAL_CASES: ReadonlyArray<RuleFromSentenceEvalCase> =
  [
    {
      id: "rule-eu-personal-data-stays-in-the-eu",
      title: "EU personal data must stay in the EU",
      feature: DataSecurityAiFeature.DraftRuleFromSentence,
      sentence: "EU personal data must stay in the EU",
      labels: LABELS,
      teams: TEAMS,
      expect: {
        kind: DataSecurityRuleKind.Residency,
        // AWS Ireland and Frankfurt, Google's Netherlands, Azure's West Europe.
        allowsRegions: [
          "eu-west-1",
          "eu-central-1",
          "europe-west4",
          "westeurope",
        ],
        // Virginia, Singapore and London are outside the EU.
        refusesRegions: ["us-east-1", "ap-southeast-1", "uksouth"],
      },
    },
    {
      id: "rule-german-card-data-in-frankfurt",
      title: "Card data about German customers only in Frankfurt",
      feature: DataSecurityAiFeature.DraftRuleFromSentence,
      sentence:
        "Card data about our German customers may only be kept in Frankfurt.",
      labels: LABELS,
      teams: TEAMS,
      expect: {
        kind: DataSecurityRuleKind.Residency,
        dataCategories: [DataCategory.Financial],
        subjectCountries: ["DE"],
        // Frankfurt, as AWS, Google and Azure name it.
        allowsRegions: ["eu-central-1", "europe-west3", "germanywestcentral"],
        refusesRegions: ["eu-west-1", "us-east-1"],
      },
    },
    {
      id: "rule-payments-owns-payments-stores",
      title: "The payments team owns every payments- store",
      feature: DataSecurityAiFeature.DraftRuleFromSentence,
      sentence:
        "The payments team owns every data store whose name starts with payments-",
      labels: LABELS,
      teams: TEAMS,
      expect: {
        kind: DataSecurityRuleKind.Owner,
        owners: ["Payments"],
        matchesStoreNames: ["payments-ledger", "payments-db-replica"],
        missesStoreNames: ["orders-db", "legacy-payments-archive"],
      },
    },
    {
      id: "rule-label-card-stores-pci",
      title: "Label every store with card in its name PCI",
      feature: DataSecurityAiFeature.DraftRuleFromSentence,
      sentence: "Label every store with card in its name as PCI",
      labels: LABELS,
      teams: TEAMS,
      expect: {
        kind: DataSecurityRuleKind.Label,
        labelsToAdd: ["PCI"],
        matchesStoreNames: ["card-exports", "acme-cards"],
        missesStoreNames: ["orders-db"],
      },
    },
    {
      id: "rule-none-in-a-wish",
      title: "A wish that is no rule drafts none",
      feature: DataSecurityAiFeature.DraftRuleFromSentence,
      sentence: "Make the data security dashboard load faster",
      labels: LABELS,
      teams: TEAMS,
      expect: { kind: null },
    },
  ];
