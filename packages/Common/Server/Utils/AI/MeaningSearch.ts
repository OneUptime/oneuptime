import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import MeaningMatch, {
  MeaningConcept,
  MeaningScore,
  MeaningSearchTerms,
  MeaningTerms,
} from "../../../Utils/AI/MeaningMatch";
import PromptText from "../../../Utils/AI/PromptText";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * SEARCH PAST RECORDS BY MEANING (#7673).
 *
 * OneUptime AI's search_incidents matched one case-insensitive substring of
 * the whole question across a record's text: "connection pool exhausted"
 * found nothing unless someone had written exactly that, and "too many
 * connections" never found the incident whose root cause said it. This
 * searches the way the automatic memory recalls (AIMemory, MeaningMatch):
 *
 *   1. Candidates. The question is read into what it says happened - the
 *      outage concepts it names, and its other words (MeaningMatch
 *      .getSearchTerms) - and the database is asked for the records whose
 *      text names one of those concepts in any of its phrasings, or has a
 *      word that starts like one of its words, or holds the question as
 *      typed (an id, an error code), the newest first, at most
 *      MAX_SEARCH_CANDIDATES. One Postgres regular expression does it
 *      (getCondition), built from the concepts' own patterns, so the
 *      database and MeaningMatch agree on what a concept's phrasings are.
 *   2. Ranking. The candidates are ranked by how alike they read
 *      (MeaningMatch.rank: TF-IDF cosine over concepts and stemmed words),
 *      and only those that match (MeaningMatch.isMatch) - or hold the
 *      question as typed - are kept, each with the terms it shares with
 *      the question, so whoever reads the answer can judge the match.
 *
 * Every read is the caller's own: a tool reads with its ctx.props, so the
 * permission layer leaves out what the caller may not read - a private
 * record, one set apart by an owner or a label - before a candidate is
 * ever ranked or counted.
 */

// The most candidates a search reads before it ranks them.
export const MAX_SEARCH_CANDIDATES: number = 100;

/*
 * The most of each of a record's texts a ranking reads - its title less,
 * as it says the least - so a long description never pushes its root
 * cause out of what MeaningMatch reads (MAX_TEXT_LENGTH).
 */
const MAX_TITLE_CHARS: number = 300;
const MAX_FIELD_CHARS: number = 900;

/*
 * The most of a match's root cause, remediation notes or postmortem a
 * search returns: enough to reuse a resolution, while the record's own
 * read (query_incidents, query_alerts with its id) returns all of it.
 */
export const MAX_RESULT_FIELD_CHARS: number = 1000;

// JavaScript's word boundary, as a concept's pattern writes it.
const JAVASCRIPT_WORD_BOUNDARY: string = "\\b";

// Postgres's word boundary (ARE).
const POSTGRES_WORD_BOUNDARY: string = "\\y";

// A word start that reads in Latin letters, which a word boundary can lead.
const LATIN_WORD_START: RegExp = /^[a-z0-9]+$/;

// What a word start may hold as it is: letters and digits, of any script.
const NOT_LETTER_OR_DIGIT: RegExp = /[^\p{L}\p{N}]/gu;

export interface MeaningSearchCandidate<T> {
  record: T;
  // What the record says, as documentText wrote it: what is ranked.
  text: string;
  /*
   * Every text of the record, whole: where the question as typed is looked
   * for, as the database looked for it. `text` when not given.
   */
  wholeText?: string | undefined;
}

export interface MeaningSearchMatch<T> {
  record: T;
  score: MeaningScore;
  // The record holds the question as typed.
  isLiteralMatch: boolean;
}

export default class MeaningSearch {
  /*
   * The Postgres regular expression - matched without case (~*) - that
   * finds the records a search's terms name: each concept's own pattern,
   * with JavaScript's word boundary (\b) written as Postgres's (\y), or a
   * word that starts with one of the word starts. Null when the terms name
   * nothing.
   */
  public static getDatabasePattern(terms: MeaningSearchTerms): string | null {
    const parts: Array<string> = [];

    for (const concept of terms.concepts) {
      parts.push(`(?:${MeaningSearch.toPostgresPattern(concept)})`);
    }

    for (const start of terms.wordStarts) {
      const escaped: string = start.replace(NOT_LETTER_OR_DIGIT, "\\$&");

      if (!escaped) {
        continue;
      }

      parts.push(
        LATIN_WORD_START.test(start)
          ? `${POSTGRES_WORD_BOUNDARY}${escaped}`
          : escaped,
      );
    }

    return parts.length > 0 ? parts.join("|") : null;
  }

  /*
   * The records whose `columns` say what `text` says (getDatabasePattern),
   * or hold `text` as typed: one condition, to set on any one of the
   * columns, which names them all (QueryHelper.multiSearchOrPattern).
   */
  public static getCondition(data: {
    columns: Array<string>;
    text: string;
  }): FindWhereProperty<any> {
    return QueryHelper.multiSearchOrPattern(data.columns, {
      text: data.text,
      pattern: MeaningSearch.getDatabasePattern(
        MeaningMatch.getSearchTerms(data.text),
      ),
    });
  }

  /*
   * What a record says, for a ranking: its title, then its other texts in
   * the order given - the most telling first - each held to its share, with
   * embedded files left out.
   */
  public static documentText(data: {
    title: string | null | undefined;
    texts: Array<string | null | undefined>;
  }): string {
    return [
      MeaningSearch.cut(data.title, MAX_TITLE_CHARS),
      ...data.texts.map((text: string | null | undefined): string => {
        return MeaningSearch.cut(text, MAX_FIELD_CHARS);
      }),
    ]
      .filter(Boolean)
      .join("\n");
  }

  /*
   * The candidates that say what `text` says, the closest first, the
   * newest first among equals (the candidates come the newest first, and
   * the sort is stable): those that read alike (MeaningMatch.isMatch), and
   * those that hold `text` as typed. At most `limit`.
   */
  public static rank<T>(data: {
    text: string;
    candidates: Array<MeaningSearchCandidate<T>>;
    limit: number;
  }): Array<MeaningSearchMatch<T>> {
    if (data.candidates.length === 0) {
      return [];
    }

    const typed: string = data.text.toLowerCase().trim();
    const query: MeaningTerms = MeaningMatch.read(data.text);
    const scores: Array<MeaningScore> =
      query.weights.size > 0
        ? MeaningMatch.rank({
            query,
            documents: data.candidates.map(
              (candidate: MeaningSearchCandidate<T>): MeaningTerms => {
                return MeaningMatch.read(candidate.text);
              },
            ),
          })
        : data.candidates.map((): MeaningScore => {
            return {
              similarity: 0,
              sharedTerms: [],
              sharedConceptCount: 0,
              sharedWordCount: 0,
            };
          });

    return data.candidates
      .map(
        (
          candidate: MeaningSearchCandidate<T>,
          index: number,
        ): MeaningSearchMatch<T> => {
          return {
            record: candidate.record,
            score: scores[index]!,
            isLiteralMatch: Boolean(
              typed &&
                (candidate.wholeText ?? candidate.text)
                  .toLowerCase()
                  .includes(typed),
            ),
          };
        },
      )
      .filter((match: MeaningSearchMatch<T>): boolean => {
        return match.isLiteralMatch || MeaningMatch.isMatch(match.score);
      })
      .sort((a: MeaningSearchMatch<T>, b: MeaningSearchMatch<T>): number => {
        return b.score.similarity - a.score.similarity;
      })
      .slice(0, Math.max(0, data.limit));
  }

  /*
   * What a match has in common with the question, for the one who reads it:
   * the terms both say, strongest first, or that it holds the question as
   * typed.
   */
  public static describeMatch(data: {
    match: MeaningSearchMatch<unknown>;
    text: string;
  }): string {
    if (data.match.score.sharedTerms.length > 0) {
      return data.match.score.sharedTerms.join(", ");
    }

    return `the text "${PromptText.field(data.text.trim(), { maxLength: 120 })}"`;
  }

  /*
   * A match's root cause, remediation notes or postmortem, as a search
   * returns it: embedded files left out, held to MAX_RESULT_FIELD_CHARS.
   * Undefined when empty, so the serializer drops it.
   */
  public static resultField(value: string | null | undefined): string | undefined {
    const text: string = PromptText.field(value, {
      maxLength: MAX_RESULT_FIELD_CHARS,
    }).trim();

    return text || undefined;
  }

  /*
   * A concept's pattern as Postgres reads it: the same alternatives, with
   * JavaScript's word boundary written as Postgres's. The concepts' patterns
   * use nothing else the two read differently (MeaningSearch tests pin it).
   */
  public static toPostgresPattern(concept: MeaningConcept): string {
    return concept.pattern.source
      .split(JAVASCRIPT_WORD_BOUNDARY)
      .join(POSTGRES_WORD_BOUNDARY);
  }

  private static cut(text: string | null | undefined, length: number): string {
    if (!text) {
      return "";
    }

    return PromptText.omitEmbeddedData(String(text)).text.slice(0, length);
  }
}
