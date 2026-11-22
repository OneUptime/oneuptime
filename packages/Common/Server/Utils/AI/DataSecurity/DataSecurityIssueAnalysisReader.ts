import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES,
  DATA_SECURITY_ANALYSIS_PART_TITLES,
  DATA_SECURITY_ANALYSIS_PARTS,
  DataSecurityAnalysisFact,
  DataSecurityAnalysisFactKind,
  DataSecurityAnalysisFactSource,
  DataSecurityAnalysisLine,
  DataSecurityIssueAnalysisRecord,
  DataSecurityIssueAnalysisView,
  getAnalysisFactSource,
  getAnalysisView,
} from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import AIService from "../../../Services/AIService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecurityFlowService from "../../../Services/DataSecurityFlowService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreAccessService from "../../../Services/DataStoreAccessService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreOwnerTeamService from "../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Services/DataStoreOwnerUserService";
import DataStoreService from "../../../Services/DataStoreService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSecurityIssueAnalysis, {
  StoredDataSecurityIssueAnalysis,
} from "./DataSecurityIssueAnalysis";

/*
 * ONEUPTIME AI'S ANALYSIS OF AN ISSUE, AS ONE READER MAY READ IT (#10369).
 *
 * The analysis an issue keeps (DataSecurityIssue.aiAnalysis) is never read
 * through a CRUD route: it rests on facts from records each with readers
 * of its own - a store's access, its flows, its owners, a repository in
 * Code, a security case - and whoever may read the issue may not read all
 * of them. So every reader gets it from here:
 *
 *   - the issue itself, read with their own permissions first: one they
 *     may not read is not found;
 *   - each fact's records, read with their own permissions, one read per
 *     kind of record: a fact whose records they may not read is left out;
 *   - every line resting on such a fact is left out too, and said instead
 *     by what they may not read ("who can reach the store") - so a person
 *     who cannot read a store's access does not see it in the card, nor in
 *     what Explain with AI answers, nor in the owners' email.
 *
 * With the project's AI off nothing is shown: the analysis is OneUptime
 * AI's, and the page is whole without it.
 */

/*
 * A read the reader may not make: no permission, or a plan that does not
 * allow it. Anything else that fails is logged and read as not readable -
 * the safe answer.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

// The ids of the rows of `ids` the reader may read, or none when they may read none.
async function readableIdsOf(data: {
  what: string;
  ids: ReadonlyArray<string>;
  read: (ids: Array<ObjectID>) => Promise<Array<BaseModel>>;
}): Promise<Set<string>> {
  const ids: Array<ObjectID> = data.ids
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    })
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });

  if (ids.length === 0) {
    return new Set();
  }

  try {
    const rows: Array<BaseModel> = await data.read(ids);

    return new Set(
      rows.map((row: BaseModel): string => {
        return (row.id || row._id)?.toString() || "";
      }),
    );
  } catch (error) {
    if (!isRefusal(error)) {
      logger.error(
        `DataSecurity AI: could not read ${data.what} for a reader of an issue's analysis: ${error}`,
      );
    }

    return new Set();
  }
}

// Whether the reader may read a kind of record of the store at all.
async function canReadAny(data: {
  what: string;
  read: () => Promise<unknown>;
}): Promise<boolean> {
  try {
    await data.read();
    return true;
  } catch (error) {
    if (!isRefusal(error)) {
      logger.error(
        `DataSecurity AI: could not read ${data.what} for a reader of an issue's analysis: ${error}`,
      );
    }

    return false;
  }
}

// The facts of one source.
function factsOf(
  facts: ReadonlyArray<DataSecurityAnalysisFact>,
  source: DataSecurityAnalysisFactSource,
): Array<DataSecurityAnalysisFact> {
  return facts.filter((fact: DataSecurityAnalysisFact): boolean => {
    return getAnalysisFactSource(fact) === source;
  });
}

function allIdsOf(
  facts: ReadonlyArray<DataSecurityAnalysisFact>,
): Array<string> {
  const ids: Array<string> = [];

  for (const fact of facts) {
    for (const id of fact.recordIds) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids;
}

export default class DataSecurityIssueAnalysisReader {
  /*
   * The analysis of an issue as the reader may read it, or null: the issue
   * keeps none, or the project's AI is off. An issue the reader may not
   * read is not found.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueAnalysisView | null> {
    const issue: DataSecurityIssue = await this.readIssue(data);

    if (!(await AIService.isProjectAIEnabled(data.projectId))) {
      return null;
    }

    const stored: StoredDataSecurityIssueAnalysis | null =
      await DataSecurityIssueAnalysis.readStored({
        projectId: data.projectId,
        issueId: data.issueId,
      });

    return stored
      ? await this.viewFor({
          projectId: data.projectId,
          dataStoreId: issue.dataStoreId,
          stored,
          props: data.props,
        })
      : null;
  }

  // The issue, read with the reader's own permissions: one they may not read is not found.
  public static async readIssue(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssue> {
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: { _id: true, dataStoreId: true },
        props: data.props,
      });

    if (!issue?.id) {
      throw new NotFoundException("Issue not found.");
    }

    return issue;
  }

  // A kept analysis as the reader may read it.
  @CaptureSpan()
  public static async viewFor(data: {
    projectId: ObjectID;
    dataStoreId?: ObjectID | undefined;
    stored: StoredDataSecurityIssueAnalysis;
    props: DatabaseCommonInteractionProps;
  }): Promise<DataSecurityIssueAnalysisView> {
    return getAnalysisView({
      record: data.stored.record,
      readableFactIds: await this.getReadableFactIds({
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        record: data.stored.record,
        props: data.props,
      }),
      analyzedAt: data.stored.analyzedAt,
    });
  }

  /*
   * The facts of an analysis the reader may read: every record each rests
   * on read with their own permissions, one read per kind of record. The
   * issue's own fact is theirs: they read the issue to get here.
   */
  @CaptureSpan()
  public static async getReadableFactIds(data: {
    projectId: ObjectID;
    dataStoreId?: ObjectID | undefined;
    record: DataSecurityIssueAnalysisRecord;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    const { projectId, props } = data;
    const facts: ReadonlyArray<DataSecurityAnalysisFact> = data.record.facts;
    const readable: Set<string> = new Set();

    const keepWhereAllReadable: (
      ofSource: ReadonlyArray<DataSecurityAnalysisFact>,
      readableIds: Set<string>,
      canReadTheStoresOwn: boolean,
    ) => void = (
      ofSource: ReadonlyArray<DataSecurityAnalysisFact>,
      readableIds: Set<string>,
      canReadTheStoresOwn: boolean,
    ): void => {
      for (const fact of ofSource) {
        const isReadable: boolean =
          fact.recordIds.length > 0
            ? fact.recordIds.every((id: string): boolean => {
                return readableIds.has(id);
              })
            : canReadTheStoresOwn;

        if (isReadable) {
          readable.add(fact.id);
        }
      }
    };

    for (const fact of factsOf(facts, DataSecurityAnalysisFactSource.Issue)) {
      readable.add(fact.id);
    }

    const storeFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Store,
    );
    const accessFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Access,
    );
    const findingFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Finding,
    );
    const flowFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Flow,
    );
    const caseFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.SecurityCase,
    );
    const proposalFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Proposal,
    );
    const codeFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Code,
    );
    const ownerFacts: Array<DataSecurityAnalysisFact> = factsOf(
      facts,
      DataSecurityAnalysisFactSource.Owner,
    );
    const dataStoreId: ObjectID | undefined = data.dataStoreId;

    // A copy names another store: the reader must be able to read the flow and that store.
    const copyStoreIds: Array<string> = flowFacts
      .map((fact: DataSecurityAnalysisFact): string => {
        return fact.kind === DataSecurityAnalysisFactKind.Copy
          ? fact.otherStoreId
          : "";
      })
      .filter(Boolean);

    const [
      stores,
      access,
      canReadAccess,
      findings,
      flows,
      cases,
      proposals,
      repositories,
      ownerUsers,
      ownerTeams,
      canReadOwners,
    ]: [
      Set<string>,
      Set<string>,
      boolean,
      Set<string>,
      Set<string>,
      Set<string>,
      Set<string>,
      Set<string>,
      Set<string>,
      Set<string>,
      boolean,
    ] = await Promise.all([
      readableIdsOf({
        what: "the store",
        ids: [...allIdsOf(storeFacts), ...copyStoreIds],
        read: (ids: Array<ObjectID>) => {
          return DataStoreService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: {
              _id: true,
              name: true,
              kind: true,
              environment: true,
              sensitivity: true,
              dataTypeIds: true,
              exposure: true,
              isPublicByDesign: true,
              cloudTags: true,
              posture: true,
              estimatedRecords: true,
              objectCount: true,
            },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "who can reach the store",
        ids: allIdsOf(accessFacts),
        read: (ids: Array<ObjectID>) => {
          return DataStoreAccessService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: {
              _id: true,
              principal: true,
              principalName: true,
              principalType: true,
              accessLevel: true,
              grantedVia: true,
              isPublic: true,
              isExternal: true,
              isSeenInTraces: true,
              lastUsedAt: true,
            },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      dataStoreId &&
      accessFacts.some((fact: DataSecurityAnalysisFact): boolean => {
        return fact.recordIds.length === 0;
      })
        ? canReadAny({
            what: "who can reach the store",
            read: () => {
              return DataStoreAccessService.findBy({
                query: { projectId, dataStoreId },
                select: { _id: true, principal: true, lastUsedAt: true },
                skip: 0,
                limit: 1,
                props,
              });
            },
          })
        : Promise.resolve(false),
      readableIdsOf({
        what: "where its data was found",
        ids: allIdsOf(findingFacts),
        read: (ids: Array<ObjectID>) => {
          return DataStoreFindingService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: {
              _id: true,
              dataTypeId: true,
              location: true,
              locationKind: true,
            },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "copies of its data",
        ids: flowFacts
          .map((fact: DataSecurityAnalysisFact): string => {
            return fact.recordIds[0] || "";
          })
          .filter(Boolean),
        read: (ids: Array<ObjectID>) => {
          return DataSecurityFlowService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true, kind: true, overlapPercent: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "its security cases",
        ids: allIdsOf(caseFacts),
        read: (ids: Array<ObjectID>) => {
          return SecurityCaseService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "OneUptime AI's proposals",
        ids: allIdsOf(proposalFacts),
        read: (ids: Array<ObjectID>) => {
          return DataSecurityAiProposalService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true, kind: true, status: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "the code that declares the store",
        ids: allIdsOf(codeFacts),
        read: (ids: Array<ObjectID>) => {
          return CodeRepositoryService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true, name: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "the store's owners",
        ids: allIdsOf(ownerFacts),
        read: (ids: Array<ObjectID>) => {
          return DataStoreOwnerUserService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true, userId: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      readableIdsOf({
        what: "the store's owners",
        ids: allIdsOf(ownerFacts),
        read: (ids: Array<ObjectID>) => {
          return DataStoreOwnerTeamService.findBy({
            query: { projectId, _id: new Includes(ids) },
            select: { _id: true, teamId: true },
            skip: 0,
            limit: ids.length,
            props,
          });
        },
      }),
      dataStoreId &&
      ownerFacts.some((fact: DataSecurityAnalysisFact): boolean => {
        return fact.recordIds.length === 0;
      })
        ? Promise.all([
            canReadAny({
              what: "the store's owners",
              read: () => {
                return DataStoreOwnerUserService.findBy({
                  query: { projectId, dataStoreId },
                  select: { _id: true },
                  skip: 0,
                  limit: 1,
                  props,
                });
              },
            }),
            canReadAny({
              what: "the store's owners",
              read: () => {
                return DataStoreOwnerTeamService.findBy({
                  query: { projectId, dataStoreId },
                  select: { _id: true },
                  skip: 0,
                  limit: 1,
                  props,
                });
              },
            }),
          ]).then((answers: Array<boolean>): boolean => {
            return answers.every(Boolean);
          })
        : Promise.resolve(false),
    ]);

    keepWhereAllReadable(storeFacts, stores, false);
    keepWhereAllReadable(accessFacts, access, canReadAccess);
    keepWhereAllReadable(findingFacts, findings, false);
    keepWhereAllReadable(caseFacts, cases, false);
    keepWhereAllReadable(proposalFacts, proposals, false);
    keepWhereAllReadable(codeFacts, repositories, false);
    keepWhereAllReadable(
      ownerFacts,
      new Set([...ownerUsers, ...ownerTeams]),
      canReadOwners,
    );

    for (const fact of flowFacts) {
      const [flowId, otherStoreId] = fact.recordIds;

      if (
        flowId &&
        flows.has(flowId) &&
        (!otherStoreId || stores.has(otherStoreId))
      ) {
        readable.add(fact.id);
      }
    }

    return readable;
  }

  /*
   * The analysis as Markdown, for the API and the MCP (Explain with AI):
   * its verdict and each line the reader may read, every one of OneUptime
   * AI's words placed as text, and each line they may not read said by
   * what it rests on. In English: the lines are in the analysis's language.
   */
  public static toMarkdown(view: DataSecurityIssueAnalysisView): string {
    const parts: Array<MarkdownText> = [
      mdText`**OneUptime AI's verdict: ${DATA_SECURITY_AI_VERDICT_TITLES[view.verdict]}.**`,
    ];

    for (const part of DATA_SECURITY_ANALYSIS_PARTS) {
      const line: DataSecurityAnalysisLine | undefined = view.lines[part];
      const hidden: Array<DataSecurityAnalysisFactSource> | undefined =
        view.hiddenLines[part];
      const title: string = DATA_SECURITY_ANALYSIS_PART_TITLES[part];

      if (line) {
        parts.push(mdText`**${title}:** ${line.text}`);
      } else if (hidden && hidden.length > 0) {
        parts.push(
          mdText`**${title}:** hidden, because it rests on what you may not read: ${hidden
            .map((source: DataSecurityAnalysisFactSource): string => {
              return DATA_SECURITY_ANALYSIS_HIDDEN_SOURCE_TITLES[source];
            })
            .join(", ")}.`,
        );
      }
    }

    return FeedMarkdown.join(parts, "\n\n").toString();
  }
}
