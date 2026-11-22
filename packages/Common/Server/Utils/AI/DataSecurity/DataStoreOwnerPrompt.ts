import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerEvidence,
  MAX_DATA_STORE_OWNER_REASON_LENGTH,
  MAX_PROPOSED_DATA_STORE_OWNERS,
} from "../../../../Types/DataSecurity/DataStoreOwnerProposal";
import {
  AiStoreRecord,
  buildStoreOwnersPrompt,
  DataSecurityAiPrompt,
} from "./DataSecurityAiInput";
import {
  StrictAnswer,
  StrictList,
  StrictObject,
  StrictText,
  StrictValue,
} from "./StrictAnswer";

/*
 * WHAT ONEUPTIME AI IS ASKED ABOUT WHO OWNS A STORE (#10374).
 *
 * It is told the store as a feature about the store sends it, the
 * candidates the evidence names - a team by its name, a person only as
 * "P1" - and each piece of evidence, as DataSecurityAiInput builds them:
 * never a value of the store's data, a sample, or a person's name or email
 * address. It picks owners from the candidates, says which evidence they
 * rest on, why in one sentence and how sure, and where the evidence
 * disagrees - and its answer is held to the evidence before anyone sees it
 * (Utils/DataSecurity/DataStoreOwnerAnswer).
 *
 * This file holds what it is asked, in OneUptime's own words, and the
 * answer's shape; every fact is the builder's. The eval asks the same
 * (Eval/DataSecurity), so a score measures what ships.
 */

export const DATA_STORE_OWNER_INSTRUCTIONS: string = [
  "You are OneUptime AI, working out who owns a data store, so that its data security issues reach the people who can fix them. An owner is told about the store and its issues, so the wrong owner is told what the store holds: propose only owners the evidence supports.",
  "The user message holds the store, the candidates the evidence names, and the evidence. Pick owners only from the candidates, by their ref: T1, T2 for teams, P1, P2 for people. Never name anyone else.",
  "Weigh the evidence: a cloud tag that names an owner, and the code owners of the file that declares the store, say who owns it on purpose - the strongest evidence. The owners of the services that use the store, or whose telemetry it is, are strong, above all when one service alone uses it. Who changed the store, and who added it to OneUptime, are the weakest: they may be a platform team or an automation.",
  "Prefer a team to a person where both point the same way: people move teams. A candidate whose canOpenStore is false cannot open the store today; prefer one who can, and say so where the evidence names only one who cannot.",
  "Where the evidence disagrees - a tag names one team, and the only service that uses the store is another team's - say so in disagreement, in one sentence naming both, and propose the owners the stronger evidence names; where neither is stronger, propose none.",
  `Answer with one JSON object and nothing else: {"owners": ["T1"], "restsOn": ["E1"], "confidence": "high", "reason": "...", "disagreement": ""}. owners: the refs of the owners, at most ${MAX_PROPOSED_DATA_STORE_OWNERS}, or [] when you cannot stand behind any. restsOn: the ids of the evidence the owners rest on. confidence: high where strong evidence agrees, medium where one piece of strong evidence or only a service's owners point there, low where the evidence is weak or disagrees. reason: one sentence, under ${MAX_DATA_STORE_OWNER_REASON_LENGTH} characters, of why, naming candidates only as {T1} or {P1}. disagreement: one sentence where the evidence disagrees, naming candidates the same way; "" where it does not.`,
].join("\n\n");

/*
 * How the owners are asked: a short answer, and as little sampling as a
 * model takes, so the same evidence is answered the same way.
 */
export const DATA_STORE_OWNER_MAX_TOKENS: number = 400;
export const DATA_STORE_OWNER_TEMPERATURE: number = 0;

// The answer's shape, read strictly (StrictAnswer).
export const DATA_STORE_OWNER_ANSWER_SHAPE: StrictObject<{
  owners: StrictList<StrictText>;
  restsOn: StrictList<StrictText>;
  confidence: StrictText;
  reason: StrictText;
  disagreement: StrictText;
}> = StrictAnswer.object({
  owners: ownersShape(),
  restsOn: ownersShape(),
  confidence: StrictAnswer.text({ maxLength: 20, isOneLine: true }),
  reason: StrictAnswer.text({
    maxLength: MAX_DATA_STORE_OWNER_REASON_LENGTH * 2,
    isOneLine: true,
  }),
  disagreement: StrictAnswer.text({
    maxLength: MAX_DATA_STORE_OWNER_REASON_LENGTH * 2,
    isOneLine: true,
  }),
});

// A list of refs or ids: a longer one is no ref, and is left out.
function ownersShape(): StrictList<StrictText> {
  return StrictAnswer.list(
    StrictAnswer.text({
      maxLength: 10,
      isOneLine: true,
      whenTooLong: "refuse",
    }),
    { maxItems: 20 },
  );
}

export type DataStoreOwnerStrictAnswer = StrictValue<
  typeof DATA_STORE_OWNER_ANSWER_SHAPE
>;

// The prompt for one store, built by the one input builder.
export function buildDataStoreOwnerPrompt(data: {
  store: AiStoreRecord;
  candidates: ReadonlyArray<DataStoreOwnerCandidate>;
  evidence: ReadonlyArray<DataStoreOwnerEvidence>;
  servicesUsingIt: number;
  dataTypeNamer?: DataTypeNamer | undefined;
}): DataSecurityAiPrompt {
  return buildStoreOwnersPrompt({
    instructions: DATA_STORE_OWNER_INSTRUCTIONS,
    store: data.store,
    candidates: data.candidates,
    evidence: data.evidence,
    servicesUsingIt: data.servicesUsingIt,
    dataTypeNamer: data.dataTypeNamer,
  });
}
