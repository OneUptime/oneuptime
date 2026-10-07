import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOidc from "../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../Models/DatabaseModels/GlobalSso";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import DatabaseService from "../Services/DatabaseService";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoService from "../Services/GlobalSsoService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "./Database/RelationIdUtil";
import ProjectSsoProviderChanges from "./ProjectSsoProviderChanges";
import SsoSignInsEnded from "./SsoSignInsEnded";
import SsoSignInWays, {
  GlobalProviderAttachmentRows,
  GlobalProviderReachChange,
  GlobalSsoProviderType,
  REACHES_NO_PROJECT,
  SignInReach,
  StrandReason,
  StrandedProject,
  StrandedProjects,
  describeStrandedProjects,
  getGlobalProviderReach,
  toIdString,
} from "./SsoSignInWays";

/*
 * A GLOBAL SSO PROVIDER, OR ONE OF ITS ATTACHMENTS, CHANGED: WHAT ENDS, AND
 * WHAT MUST STAY.
 *
 * What the global SAML and OIDC provider services and their attachment
 * services do when a write changes where a provider signs people in
 * (GlobalSsoService, GlobalOidcService, GlobalSsoProjectService,
 * GlobalOidcProjectService):
 *
 *   - turning a provider off writes when (signInsEndedAt), in the same
 *     write: the Global SSO sign-ins it gave before then stop counting, and
 *     turning it on again does not bring them back (SsoSignInsEnded,
 *     UserMiddleware.isGlobalSsoTokenAuthorizedForProject);
 *   - a project that requires SSO - itself, or because the whole server
 *     does - keeps a way in: a write that would leave one with no provider
 *     to sign in with, or take away the provider it requires, is refused,
 *     naming the projects (SsoSignInWays). That is a provider turned off,
 *     deleted or restricted to its attached projects, and an attachment of a
 *     provider restricted to them added (the first narrows the provider from
 *     every project to the attached ones), turned off, moved or removed;
 *   - the write and its check hold the lock on the server's sign-in rules
 *     (ProjectSsoProviderChanges.lockSignInChange), which every change
 *     whose check reads them holds too, so none comes between what this one
 *     read and what it writes. A write that only lets a provider sign more
 *     people in - turning it or an attachment on, lifting the restriction,
 *     a new certificate - takes no lock and is never refused.
 *
 * Every server hearing of the change is the services' part
 * (announceGlobalSignInChange).
 */

// What a write does to where global providers sign people in.
export interface GlobalSsoProviderWrite {
  // The providers it changes: where each signs people in, before and after.
  reachChanges: Array<GlobalProviderReachChange>;
  // It turns a provider off that was on: the sign-ins it gave end.
  turnsOneOff: boolean;
  /*
   * The lock on the server's sign-in rules, held from before the rows were
   * read until the write is done (afterWrite). A write that fails in
   * between leaves it to run out.
   */
  locks?: Array<SemaphoreMutex> | undefined;
}

// A global provider, as these hooks read it.
interface GlobalProviderRow {
  id: string;
  isEnabled: boolean;
  restrictToAttachedProjects: boolean;
}

// An attachment row, as these hooks read it.
interface AttachmentRow {
  id: string;
  providerId: string | null;
  projectId: string | null;
  isEnabled: boolean;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Why a global change is refused, in words that name the projects it would
 * strand and say what to do first.
 */
export function getGlobalChangeRefusalMessage(
  stranded: StrandedProjects,
): string {
  const projects: string = describeStrandedProjects(stranded);
  const isOne: boolean = stranded.count === 1;
  const them: string = isOne ? "it" : "them";

  const named: Array<StrandedProject> = stranded.firstProjects;

  if (
    named.length > 0 &&
    named.every((project: StrandedProject): boolean => {
      return project.reason === StrandReason.RequiredProvider;
    })
  ) {
    return `${capitalize(projects)} ${
      isOne ? "requires" : "require"
    } sign-in with this SSO provider. Turn off Require SSO for Login there first, so people can still sign in.`;
  }

  if (
    named.every((project: StrandedProject): boolean => {
      return project.requiresSsoItself;
    })
  ) {
    return `This change would leave ${projects} with no SSO provider people can sign in with, and ${
      isOne ? "it requires" : "they require"
    } SSO. Turn on another SSO provider for ${them} first, or turn off Require SSO for Login there.`;
  }

  return `This server requires SSO for everyone, and this change would leave ${projects} with no SSO provider people can sign in with. Turn on another SSO provider for ${them} first.`;
}

export default class GlobalSsoProviderChanges {
  /*
   * The writes worked out before they run, for the hooks after them: keyed
   * by the UpdateBy, DeleteBy or CreateBy the services hand back from their
   * before-hooks, which DatabaseService passes on to the later ones.
   */
  private static writes: WeakMap<object, GlobalSsoProviderWrite> = new WeakMap<
    object,
    GlobalSsoProviderWrite
  >();

  /*
   * Before an update to a global provider (onBeforeUpdate): one that turns
   * it off or restricts it to its attached projects is checked, under the
   * lock on the server's sign-in rules, against the projects it would stop
   * signing people in to. Null for any other update, which takes no lock.
   */
  public static async beforeProviderUpdate<TModel extends BaseModel>(data: {
    providerType: GlobalSsoProviderType;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<GlobalSsoProviderWrite | null> {
    const isEnabled: boolean | undefined = SsoSignInsEnded.getWrittenIsEnabled(
      data.updateBy.data,
    );
    const restrictToAttachedProjects: boolean | undefined =
      SsoSignInsEnded.getWrittenBoolean(
        data.updateBy.data,
        "restrictToAttachedProjects",
      );

    if (isEnabled !== false && restrictToAttachedProjects !== true) {
      return null;
    }

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: data.updateBy,
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const providers: Array<GlobalProviderRow> =
          await GlobalSsoProviderChanges.readProviders({
            service: data.service,
            query: data.updateBy.query,
            limit: data.updateBy.limit,
            skip: data.updateBy.skip,
          });

        const attachments: Map<string, Array<AttachmentRow>> =
          await GlobalSsoProviderChanges.readAttachments({
            providerType: data.providerType,
            providerIds: providers.map((provider: GlobalProviderRow) => {
              return provider.id;
            }),
          });

        return {
          reachChanges: providers.map(
            (provider: GlobalProviderRow): GlobalProviderReachChange => {
              const rows: Array<AttachmentRow> =
                attachments.get(provider.id) || [];

              return {
                providerType: data.providerType,
                providerId: provider.id,
                before: GlobalSsoProviderChanges.reachOf(provider, rows),
                after: GlobalSsoProviderChanges.reachOf(
                  {
                    id: provider.id,
                    isEnabled:
                      isEnabled !== undefined ? isEnabled : provider.isEnabled,
                    restrictToAttachedProjects:
                      restrictToAttachedProjects !== undefined
                        ? restrictToAttachedProjects
                        : provider.restrictToAttachedProjects,
                  },
                  rows,
                ),
              };
            },
          ),
          turnsOneOff:
            isEnabled === false &&
            providers.some((provider: GlobalProviderRow): boolean => {
              return provider.isEnabled;
            }),
        };
      },
    });
  }

  /*
   * The last step before an update to a global provider is written
   * (onUpdatePermitted): one that turns it off writes when, in the same
   * write (SsoSignInsEnded.stampWhenTurnedOff), using what
   * beforeProviderUpdate found under the lock.
   */
  public static async beforeProviderWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    const write: GlobalSsoProviderWrite | undefined =
      GlobalSsoProviderChanges.writes.get(data.updateBy);

    await SsoSignInsEnded.stampWhenTurnedOff({
      service: data.service,
      updateBy: data.updateBy,
      turnsOneOff: write ? write.turnsOneOff : undefined,
    });
  }

  /*
   * Before a global provider is deleted (onBeforeDelete): it stops signing
   * people in anywhere, so the projects it signed people in to are checked
   * under the lock.
   */
  public static async beforeProviderDelete<TModel extends BaseModel>(data: {
    providerType: GlobalSsoProviderType;
    service: DatabaseService<TModel>;
    deleteBy: DeleteBy<TModel>;
  }): Promise<GlobalSsoProviderWrite | null> {
    return await GlobalSsoProviderChanges.lockAndCheck({
      key: data.deleteBy,
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const providers: Array<GlobalProviderRow> =
          await GlobalSsoProviderChanges.readProviders({
            service: data.service,
            query: data.deleteBy.query,
            limit: data.deleteBy.limit,
            skip: data.deleteBy.skip,
          });

        const attachments: Map<string, Array<AttachmentRow>> =
          await GlobalSsoProviderChanges.readAttachments({
            providerType: data.providerType,
            providerIds: providers.map((provider: GlobalProviderRow) => {
              return provider.id;
            }),
          });

        return {
          reachChanges: providers.map(
            (provider: GlobalProviderRow): GlobalProviderReachChange => {
              return {
                providerType: data.providerType,
                providerId: provider.id,
                before: GlobalSsoProviderChanges.reachOf(
                  provider,
                  attachments.get(provider.id) || [],
                ),
                after: REACHES_NO_PROJECT,
              };
            },
          ),
          turnsOneOff: false,
        };
      },
    });
  }

  /*
   * Before an attachment is added (onBeforeCreate, its project already
   * resolved): the first attachment of a provider restricted to its attached
   * projects narrows it from every project to that one, and one added off
   * to none. Checked under the lock either way, so a provider restricted at
   * the same moment reads it.
   */
  public static async beforeAttachmentCreate(data: {
    providerType: GlobalSsoProviderType;
    createBy: CreateBy<BaseModel>;
  }): Promise<GlobalSsoProviderWrite | null> {
    const record: Record<string, unknown> = data.createBy
      .data as unknown as Record<string, unknown>;

    let providerId: string | null = null;

    try {
      providerId = toIdString(
        RelationIdUtil.readConsistent(
          record,
          GlobalSsoProviderChanges.providerColumns(data.providerType),
          "Global SSO",
        ),
      );
    } catch {
      // Names that disagree are refused by DatabaseService on its own.
      providerId = null;
    }

    if (!providerId) {
      return null;
    }

    const added: AttachmentRow = {
      id: "new",
      providerId: providerId,
      projectId: toIdString(record["projectId"]),
      isEnabled: record["isEnabled"] === undefined || record["isEnabled"] === null
        ? true
        : record["isEnabled"] === true,
    };

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: data.createBy,
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        return {
          reachChanges: await GlobalSsoProviderChanges.getAttachmentReachChanges(
            {
              providerType: data.providerType,
              before: [],
              after: [added],
            },
          ),
          turnsOneOff: false,
        };
      },
    });
  }

  /*
   * Before an update to attachments (onBeforeUpdate): one that turns them
   * off or moves them - to another project or another provider - is checked
   * under the lock. Turning them on, or changing their teams, only widens or
   * changes nothing: no lock, no check.
   */
  public static async beforeAttachmentUpdate<TModel extends BaseModel>(data: {
    providerType: GlobalSsoProviderType;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<GlobalSsoProviderWrite | null> {
    const written: Record<string, unknown> = data.updateBy
      .data as unknown as Record<string, unknown>;

    const isEnabled: boolean | undefined =
      SsoSignInsEnded.getWrittenIsEnabled(written);

    const providerColumns: Array<string> =
      GlobalSsoProviderChanges.providerColumns(data.providerType);

    const writesProvider: boolean = providerColumns.some(
      (column: string): boolean => {
        return written[column] !== undefined;
      },
    );
    const writesProject: boolean =
      written["projectId"] !== undefined || written["project"] !== undefined;

    if (isEnabled !== false && !writesProvider && !writesProject) {
      return null;
    }

    const newProviderId: string | null = writesProvider
      ? toIdString(
          RelationIdUtil.readConsistent(
            written,
            providerColumns,
            "Global SSO",
          ),
        )
      : null;
    const newProjectId: string | null = writesProject
      ? toIdString(
          RelationIdUtil.readConsistent(
            written,
            ["projectId", "project"],
            "Project",
          ),
        )
      : null;

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: data.updateBy,
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const matched: Array<AttachmentRow> =
          await GlobalSsoProviderChanges.readAttachmentRows({
            providerType: data.providerType,
            service: data.service,
            query: data.updateBy.query,
            limit: data.updateBy.limit,
            skip: data.updateBy.skip,
          });

        return {
          reachChanges: await GlobalSsoProviderChanges.getAttachmentReachChanges(
            {
              providerType: data.providerType,
              before: matched,
              after: matched.map((row: AttachmentRow): AttachmentRow => {
                return {
                  id: row.id,
                  providerId: writesProvider ? newProviderId : row.providerId,
                  projectId: writesProject ? newProjectId : row.projectId,
                  isEnabled: isEnabled !== undefined ? isEnabled : row.isEnabled,
                };
              }),
            },
          ),
          turnsOneOff: false,
        };
      },
    });
  }

  /*
   * Before attachments are removed (onBeforeDelete): a project they attach
   * stops being signed in to by a provider restricted to its attached
   * projects - unless it was the provider's last attachment, which leaves
   * it signing people in to every project.
   */
  public static async beforeAttachmentDelete<TModel extends BaseModel>(data: {
    providerType: GlobalSsoProviderType;
    service: DatabaseService<TModel>;
    deleteBy: DeleteBy<TModel>;
  }): Promise<GlobalSsoProviderWrite | null> {
    return await GlobalSsoProviderChanges.lockAndCheck({
      key: data.deleteBy,
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const matched: Array<AttachmentRow> =
          await GlobalSsoProviderChanges.readAttachmentRows({
            providerType: data.providerType,
            service: data.service,
            query: data.deleteBy.query,
            limit: data.deleteBy.limit,
            skip: data.deleteBy.skip,
          });

        return {
          reachChanges: await GlobalSsoProviderChanges.getAttachmentReachChanges(
            {
              providerType: data.providerType,
              before: matched,
              after: [],
            },
          ),
          turnsOneOff: false,
        };
      },
    });
  }

  /*
   * Once the write is done, or refused after its before-hook (the success
   * hooks): its lock is given back, once.
   */
  public static async afterWrite(key: object): Promise<void> {
    const write: GlobalSsoProviderWrite | undefined =
      GlobalSsoProviderChanges.writes.get(key);

    GlobalSsoProviderChanges.writes.delete(key);

    await GlobalSsoProviderChanges.release(write);
  }

  /*
   * Gives a write's lock back, once. For a create, whose CreateBy may not
   * reach the success hook as the same object, the write itself is carried
   * forward (carryForward) and given back here.
   */
  public static async release(
    write: GlobalSsoProviderWrite | null | undefined,
  ): Promise<void> {
    if (!write) {
      return;
    }

    const locks: Array<SemaphoreMutex> = write.locks || [];
    write.locks = undefined;

    await ProjectSsoProviderChanges.releaseSignInChange(locks);
  }

  // The write a before-hook worked out, for tests and the success hooks.
  public static getWrite(key: object): GlobalSsoProviderWrite | undefined {
    return GlobalSsoProviderChanges.writes.get(key);
  }

  /*
   * Takes the lock on the server's sign-in rules, works the write out from
   * what it reads under it, and refuses it when it would strand a project.
   * The lock is held for the write (afterWrite), or given back at once when
   * the write is refused.
   */
  private static async lockAndCheck(data: {
    key: object;
    work: () => Promise<Omit<GlobalSsoProviderWrite, "locks">>;
  }): Promise<GlobalSsoProviderWrite> {
    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      const write: GlobalSsoProviderWrite = {
        ...(await data.work()),
        locks,
      };

      const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
        {
          globalProviders: write.reachChanges,
        },
      );

      if (stranded.count > 0) {
        throw new BadDataException(getGlobalChangeRefusalMessage(stranded));
      }

      GlobalSsoProviderChanges.writes.set(data.key, write);

      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * Where the providers of these attachments sign people in before and after
   * the write: each provider's attachments as they are, and as the write
   * leaves them - `before` taken out, `after` put in. Only a provider that
   * is on and restricted to its attached projects reads its attachments.
   */
  private static async getAttachmentReachChanges(data: {
    providerType: GlobalSsoProviderType;
    before: Array<AttachmentRow>;
    after: Array<AttachmentRow>;
  }): Promise<Array<GlobalProviderReachChange>> {
    const providerIds: Set<string> = new Set<string>();

    for (const row of [...data.before, ...data.after]) {
      if (row.providerId) {
        providerIds.add(row.providerId);
      }
    }

    if (providerIds.size === 0) {
      return [];
    }

    const providers: Array<GlobalProviderRow> =
      await GlobalSsoProviderChanges.readProvidersById({
        providerType: data.providerType,
        ids: Array.from(providerIds),
      });

    const attachments: Map<string, Array<AttachmentRow>> =
      await GlobalSsoProviderChanges.readAttachments({
        providerType: data.providerType,
        providerIds: Array.from(providerIds),
      });

    const leaving: Set<string> = new Set<string>(
      data.before.map((row: AttachmentRow): string => {
        return row.id;
      }),
    );

    const changes: Array<GlobalProviderReachChange> = [];

    for (const provider of providers) {
      const rowsBefore: Array<AttachmentRow> =
        attachments.get(provider.id) || [];

      const rowsAfter: Array<AttachmentRow> = [
        ...rowsBefore.filter((row: AttachmentRow): boolean => {
          return !leaving.has(row.id);
        }),
        ...data.after.filter((row: AttachmentRow): boolean => {
          return row.providerId === provider.id;
        }),
      ];

      const before: SignInReach = GlobalSsoProviderChanges.reachOf(
        provider,
        rowsBefore,
      );
      const after: SignInReach = GlobalSsoProviderChanges.reachOf(
        provider,
        rowsAfter,
      );

      /*
       * Every provider whose reach the write changes - one it narrows, and
       * one it widens, which may give a project the way in another loses.
       */
      if (GlobalSsoProviderChanges.isSameReach(before, after)) {
        continue;
      }

      changes.push({
        providerType: data.providerType,
        providerId: provider.id,
        before,
        after,
      });
    }

    return changes;
  }

  private static isSameReach(a: SignInReach, b: SignInReach): boolean {
    if (a.everyProject || b.everyProject) {
      return a.everyProject === b.everyProject;
    }

    if (a.projectIds.size !== b.projectIds.size) {
      return false;
    }

    for (const projectId of a.projectIds) {
      if (!b.projectIds.has(projectId)) {
        return false;
      }
    }

    return true;
  }

  private static reachOf(
    provider: GlobalProviderRow,
    attachments: Array<AttachmentRow>,
  ): SignInReach {
    return getGlobalProviderReach({
      isEnabled: provider.isEnabled,
      restrictToAttachedProjects: provider.restrictToAttachedProjects,
      attachments: attachments,
    });
  }

  private static providerColumns(
    providerType: GlobalSsoProviderType,
  ): Array<string> {
    return providerType === SsoProviderType.GlobalSSO
      ? ["globalSsoId", "globalSso"]
      : ["globalOidcId", "globalOidc"];
  }

  // The providers a write names, read now.
  private static async readProviders<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
  }): Promise<Array<GlobalProviderRow>> {
    const rows: Array<TModel> = await data.service.findAllBy({
      query: data.query,
      select: {
        _id: true,
        isEnabled: true,
        restrictToAttachedProjects: true,
      } as unknown as Select<TModel>,
      limit: data.limit,
      skip: data.skip,
      props: {
        isRoot: true,
      },
    });

    return GlobalSsoProviderChanges.toProviderRows(rows);
  }

  private static async readProvidersById(data: {
    providerType: GlobalSsoProviderType;
    ids: Array<string>;
  }): Promise<Array<GlobalProviderRow>> {
    const query: Query<BaseModel> = {
      _id: QueryHelper.any(
        data.ids.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      ),
    } as unknown as Query<BaseModel>;

    const rows: Array<GlobalSso | GlobalOidc> =
      data.providerType === SsoProviderType.GlobalSSO
        ? await GlobalSsoService.findBy({
            query: query as never,
            select: {
              _id: true,
              isEnabled: true,
              restrictToAttachedProjects: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : await GlobalOidcService.findBy({
            query: query as never,
            select: {
              _id: true,
              isEnabled: true,
              restrictToAttachedProjects: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          });

    return GlobalSsoProviderChanges.toProviderRows(rows);
  }

  private static toProviderRows(
    rows: Array<BaseModel>,
  ): Array<GlobalProviderRow> {
    const providers: Array<GlobalProviderRow> = [];

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const id: string | null = toIdString(row.id);

      if (!id) {
        continue;
      }

      providers.push({
        id,
        isEnabled: record["isEnabled"] === true,
        restrictToAttachedProjects: record["restrictToAttachedProjects"] === true,
      });
    }

    return providers;
  }

  // Every attachment row of these providers, on or off.
  private static async readAttachments(data: {
    providerType: GlobalSsoProviderType;
    providerIds: Array<string>;
  }): Promise<Map<string, Array<AttachmentRow>>> {
    const rows: Map<
      string,
      Array<{ id: string; projectId: string | null; isEnabled: boolean }>
    > = await GlobalProviderAttachmentRows.read({
      providerType: data.providerType,
      ids: data.providerIds,
    });

    const attachments: Map<string, Array<AttachmentRow>> = new Map<
      string,
      Array<AttachmentRow>
    >();

    for (const [providerId, list] of rows) {
      attachments.set(
        providerId,
        list.map(
          (row: {
            id: string;
            projectId: string | null;
            isEnabled: boolean;
          }): AttachmentRow => {
            return {
              id: row.id,
              providerId,
              projectId: row.projectId,
              isEnabled: row.isEnabled,
            };
          },
        ),
      );
    }

    return attachments;
  }

  // The attachment rows a write names, read now.
  private static async readAttachmentRows<TModel extends BaseModel>(data: {
    providerType: GlobalSsoProviderType;
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
  }): Promise<Array<AttachmentRow>> {
    const providerColumn: string =
      data.providerType === SsoProviderType.GlobalSSO
        ? "globalSsoId"
        : "globalOidcId";

    const rows: Array<TModel> = await data.service.findAllBy({
      query: data.query,
      select: {
        _id: true,
        [providerColumn]: true,
        projectId: true,
        isEnabled: true,
      } as unknown as Select<TModel>,
      limit: data.limit,
      skip: data.skip,
      props: {
        isRoot: true,
      },
    });

    const attachments: Array<AttachmentRow> = [];

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const id: string | null = toIdString(row.id);

      if (!id) {
        continue;
      }

      attachments.push({
        id,
        providerId: toIdString(record[providerColumn]),
        projectId: toIdString(record["projectId"]),
        isEnabled: record["isEnabled"] === true,
      });
    }

    return attachments;
  }
}
