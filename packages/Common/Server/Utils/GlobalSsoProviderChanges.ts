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
import logger from "./Logger";
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
  StrandedProjectList,
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
 *   - a write that turns a provider off writes when (signInsEndedAt), in
 *     the same write: the Global SSO sign-ins it gave before then stop
 *     counting, and turning it on again does not bring them back
 *     (SsoSignInsEnded, UserMiddleware.isGlobalSsoTokenAuthorizedForProject).
 *     It writes the time whatever it reads first: a provider that was off
 *     already gave no sign-ins since, so a later time ends none that its
 *     own did not, and one turned on a moment before - under no lock - is
 *     stamped too;
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
 *     read and what it writes. It is taken once every permission check has
 *     passed (the services' onUpdatePermitted and onCreatePermitted; a
 *     delete has no later hook than onBeforeDelete, and takes it last
 *     there), kept while the check reads, kept alive while the write runs
 *     (ProjectSsoProviderChanges.holdForWrite) - so the write never lands
 *     once it could have run out, and is refused when it was lost before -
 *     and given back as soon as the write is done (afterWrite, first in the
 *     success hooks; afterHardDelete for a hard delete, which runs none of
 *     them) or fails (the error hooks). A write that only lets a provider
 *     sign more people in - turning it or an attachment on, lifting the
 *     restriction - takes no lock and is never refused; where it moves the
 *     provider is worked out all the same, unlocked (workOutUnlocked). One
 *     that writes neither switch - a new certificate, a new name - reads
 *     nothing;
 *   - a write that names its providers or attachments by a filter writes
 *     exactly the rows its hooks read (ProjectSsoProviderChanges.
 *     writeOnlyTheRowsRead): a row that comes to match the filter
 *     afterwards - created, renamed, turned on or attached a moment later -
 *     was never checked, nor worked out, and is left alone. A delete,
 *     a hard delete included, reaches no other row that is there, only rows
 *     deleted before, which sign nobody in.
 *
 * Every server hearing of the change is the services' part
 * (announceGlobalSignInChange): told when the write changed where a
 * provider signs people in (afterWrite) - narrowed or widened - and not
 * when it turned a provider or an attachment on, or opened one, that was so
 * already. A write that turns a provider off or restricts it is told
 * whatever it read (isGlobalProviderNarrowing), and so is one that turns an
 * attachment off or moves it, touching a provider restricted to its attached
 * projects (touchesRestrictedProvider): a write that turns one on takes no
 * lock, and may land between what it read and what it wrote.
 */

// What a write does to where global providers sign people in.
export interface GlobalSsoProviderWrite {
  // The providers it changes: where each signs people in, before and after.
  reachChanges: Array<GlobalProviderReachChange>;
  /*
   * The lock on the server's sign-in rules, held from before the rows were
   * read until the write is done or fails (afterWrite). None for a write
   * that only lets providers sign more people in (workOutUnlocked).
   */
  locks?: Array<SemaphoreMutex> | undefined;
  /*
   * Where the write moves the providers could not be worked out (the read
   * failed): it counts as a change, so every server is told.
   */
  isReachUnknown?: boolean | undefined;
  /*
   * A write that turns attachments off or moves them, and touches - before
   * or after - a provider restricted to its attached projects, as read
   * under the lock: it counts as a change whatever else it read, since an
   * attachment turned on takes no lock and may land between that read and
   * the write.
   */
  touchesRestrictedProvider?: boolean | undefined;
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

/*
 * What a write is known by between its hooks: the UpdateBy, DeleteBy or
 * CreateBy the service hands back from its before-hook, which
 * DatabaseService passes on to the later ones.
 */
type WriteKey = UpdateBy<BaseModel> | DeleteBy<BaseModel> | CreateBy<BaseModel>;

function keyOf<TModel extends BaseModel>(
  write: UpdateBy<TModel> | DeleteBy<TModel> | CreateBy<TModel>,
): WriteKey {
  return write as unknown as WriteKey;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Why a global change is refused, in words that name the projects it would
 * strand and say what to do first: a sentence for the projects that
 * require this provider by id, and one for those it would leave with no
 * provider at all.
 */
export function getGlobalChangeRefusalMessage(
  stranded: StrandedProjects,
): string {
  const sentences: Array<string> = [];

  const required: StrandedProjectList =
    stranded.byReason[StrandReason.RequiredProvider];

  if (required.count > 0) {
    sentences.push(
      `${capitalize(describeStrandedProjects(required))} ${
        required.count === 1 ? "requires" : "require"
      } sign-in with this SSO provider. Require another provider there, or turn off Require SSO for Login, first, so people can still sign in.`,
    );
  }

  const noProvider: StrandedProjectList =
    stranded.byReason[StrandReason.NoProvider];

  if (noProvider.count > 0) {
    const projects: string = describeStrandedProjects(noProvider);
    const isOne: boolean = noProvider.count === 1;
    const them: string = isOne ? "it" : "them";

    sentences.push(
      noProvider.firstProjects.every((project: StrandedProject): boolean => {
        return project.requiresSsoItself;
      })
        ? `This change would leave ${projects} with no SSO provider people can sign in with, and ${
            isOne ? "it requires" : "they require"
          } SSO. Turn on another SSO provider for ${them} first, or turn off Require SSO for Login there.`
        : `This server requires SSO for everyone, and this change would leave ${projects} with no SSO provider people can sign in with. Turn on another SSO provider for ${them} first.`,
    );
  }

  return sentences.join(" ");
}

export default class GlobalSsoProviderChanges {
  /*
   * The writes worked out before they run, for the hooks after them: keyed
   * by the UpdateBy, DeleteBy or CreateBy the services hand back from their
   * before-hooks, which DatabaseService passes on to the later ones. The
   * services hand back the very object they were given, so the key the
   * permitted hook is handed is the one the success and error hooks are -
   * DatabaseService hands those the caller's object - and the suites that
   * give the lock back after each write (GlobalSsoProviderChanges.test)
   * fail if one ever does not.
   */
  private static writes: WeakMap<WriteKey, GlobalSsoProviderWrite> =
    new WeakMap<WriteKey, GlobalSsoProviderWrite>();

  /*
   * Before an update to a global provider is written (onUpdatePermitted,
   * once every permission check has passed): one that turns it off or
   * restricts it to its attached projects is checked, under the lock on the
   * server's sign-in rules, against the projects it would stop signing
   * people in to. One that turns it on or lifts the restriction is never
   * refused and takes no lock; where it moves the provider is worked out
   * without one (workOutUnlocked). Null for an update that writes neither
   * switch.
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

    // Writes neither switch: where the provider signs people in stays as it is.
    if (isEnabled === undefined && restrictToAttachedProjects === undefined) {
      return null;
    }

    const work: () => Promise<
      Omit<GlobalSsoProviderWrite, "locks">
    > = async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
      const read: Array<GlobalProviderRow> =
        await GlobalSsoProviderChanges.readProviders({
          service: data.service,
          query: data.updateBy.query,
          limit: data.updateBy.limit,
          skip: data.updateBy.skip,
        });

      // The write goes to exactly the providers read here.
      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: data.service,
        write: data.updateBy,
        rowIds: GlobalSsoProviderChanges.idsOf(read),
        isDelete: false,
      });

      /*
       * Only the providers whose switches the write changes: one it leaves
       * as it was - an edit form sends every switch it shows - signs the
       * same people in after it, and its attachments are not read.
       */
      const providers: Array<GlobalProviderRow> = read.filter(
        (provider: GlobalProviderRow): boolean => {
          return (
            (isEnabled !== undefined && isEnabled !== provider.isEnabled) ||
            (restrictToAttachedProjects !== undefined &&
              restrictToAttachedProjects !==
                provider.restrictToAttachedProjects)
          );
        },
      );

      if (providers.length === 0) {
        return { reachChanges: [] };
      }

      const attachments: Map<
        string,
        Array<AttachmentRow>
      > = await GlobalSsoProviderChanges.readAttachments({
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
      };
    };

    // Turned on, or opened to every project: never refused, so no lock.
    if (isEnabled !== false && restrictToAttachedProjects !== true) {
      return await GlobalSsoProviderChanges.workOutUnlocked({
        key: keyOf(data.updateBy),
        work,
      });
    }

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: keyOf(data.updateBy),
      work,
    });
  }

  /*
   * The last step before an update to a global provider is written
   * (onUpdatePermitted, after beforeProviderUpdate): one that turns it off
   * writes when, in the same write (SsoSignInsEnded.stampWhenTurnedOff),
   * whether or not the provider was on when it was read: one that was off
   * already gave no sign-ins while it was off, so the later time ends none
   * that its own did not, and one turned on in between - turning on takes
   * no lock - is stamped too.
   */
  public static async beforeProviderWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    await SsoSignInsEnded.stampWhenTurnedOff({
      service: data.service,
      updateBy: data.updateBy,
      turnsOneOff: true,
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
      key: keyOf(data.deleteBy),
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const providers: Array<GlobalProviderRow> =
          await GlobalSsoProviderChanges.readProviders({
            service: data.service,
            query: data.deleteBy.query,
            limit: data.deleteBy.limit,
            skip: data.deleteBy.skip,
          });

        /*
         * The delete goes to exactly the providers read here, under the
         * lock - and rows deleted before, which a hard delete purges.
         */
        ProjectSsoProviderChanges.writeOnlyTheRowsRead({
          service: data.service,
          write: data.deleteBy,
          rowIds: GlobalSsoProviderChanges.idsOf(providers),
          isDelete: true,
        });

        const attachments: Map<
          string,
          Array<AttachmentRow>
        > = await GlobalSsoProviderChanges.readAttachments({
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
        };
      },
    });
  }

  /*
   * Before an attachment is added (onCreatePermitted, once every permission
   * and clash check has passed; onBeforeCreate resolved its project): the
   * first attachment of a provider restricted to its attached projects
   * narrows it from every project to that one, and one added off to none.
   * Checked under the lock either way, so a provider restricted at the same
   * moment reads it.
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
      isEnabled:
        record["isEnabled"] === undefined || record["isEnabled"] === null
          ? true
          : record["isEnabled"] === true,
    };

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: keyOf(data.createBy),
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        return {
          reachChanges:
            await GlobalSsoProviderChanges.getAttachmentReachChanges({
              providerType: data.providerType,
              before: [],
              after: [added],
            }),
        };
      },
    });
  }

  /*
   * Before an update to attachments is written (onUpdatePermitted): one
   * that turns them off or moves them - to another project or another
   * provider - is checked under the lock. Turning them on only widens: no
   * lock, no check, but where it moves their providers is worked out,
   * unlocked (workOutUnlocked). Changing their teams changes nothing there.
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

    // Neither turned on or off nor moved: where it signs people in stays as it is.
    if (isEnabled === undefined && !writesProvider && !writesProject) {
      return null;
    }

    const newProviderId: string | null = writesProvider
      ? toIdString(
          RelationIdUtil.readConsistent(written, providerColumns, "Global SSO"),
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

    // Turned on, in place: it only widens, and is never refused.
    const isTurnedOnInPlace: boolean =
      isEnabled !== false && !writesProvider && !writesProject;

    const work: () => Promise<
      Omit<GlobalSsoProviderWrite, "locks">
    > = async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
      const matched: Array<AttachmentRow> =
        await GlobalSsoProviderChanges.readAttachmentRows({
          providerType: data.providerType,
          service: data.service,
          query: data.updateBy.query,
          limit: data.updateBy.limit,
          skip: data.updateBy.skip,
        });

      // The write goes to exactly the attachments read here.
      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: data.service,
        write: data.updateBy,
        rowIds: GlobalSsoProviderChanges.idsOf(matched),
        isDelete: false,
      });

      /*
       * Turned off or moved: told whatever else was read when a provider it
       * touches - the one each attachment leaves, and the one it moves to -
       * is restricted to its attached projects.
       */
      const touchesRestrictedProvider: boolean = isTurnedOnInPlace
        ? false
        : await GlobalSsoProviderChanges.touchesRestrictedProvider({
            providerType: data.providerType,
            providerIds: [
              ...matched.map((row: AttachmentRow): string | null => {
                return row.providerId;
              }),
              ...(writesProvider && matched.length > 0 ? [newProviderId] : []),
            ],
          });

      const before: Array<AttachmentRow> = [];
      const after: Array<AttachmentRow> = [];

      /*
       * Only the attachments the write changes: one it leaves as it was -
       * turned on again while on - changes nothing, and nothing more is
       * read for it.
       */
      for (const row of matched) {
        const written: AttachmentRow = {
          id: row.id,
          providerId: writesProvider ? newProviderId : row.providerId,
          projectId: writesProject ? newProjectId : row.projectId,
          isEnabled: isEnabled !== undefined ? isEnabled : row.isEnabled,
        };

        if (
          written.providerId !== row.providerId ||
          written.projectId !== row.projectId ||
          written.isEnabled !== row.isEnabled
        ) {
          before.push(row);
          after.push(written);
        }
      }

      return {
        reachChanges: await GlobalSsoProviderChanges.getAttachmentReachChanges({
          providerType: data.providerType,
          before,
          after,
        }),
        touchesRestrictedProvider,
      };
    };

    // Turned on, in place: never refused, so no lock.
    if (isTurnedOnInPlace) {
      return await GlobalSsoProviderChanges.workOutUnlocked({
        key: keyOf(data.updateBy),
        work,
      });
    }

    return await GlobalSsoProviderChanges.lockAndCheck({
      key: keyOf(data.updateBy),
      work,
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
      key: keyOf(data.deleteBy),
      work: async (): Promise<Omit<GlobalSsoProviderWrite, "locks">> => {
        const matched: Array<AttachmentRow> =
          await GlobalSsoProviderChanges.readAttachmentRows({
            providerType: data.providerType,
            service: data.service,
            query: data.deleteBy.query,
            limit: data.deleteBy.limit,
            skip: data.deleteBy.skip,
          });

        /*
         * The delete goes to exactly the attachments read here, under the
         * lock - and rows deleted before, which a hard delete purges.
         */
        ProjectSsoProviderChanges.writeOnlyTheRowsRead({
          service: data.service,
          write: data.deleteBy,
          rowIds: GlobalSsoProviderChanges.idsOf(matched),
          isDelete: true,
        });

        return {
          reachChanges:
            await GlobalSsoProviderChanges.getAttachmentReachChanges({
              providerType: data.providerType,
              before: matched,
              after: [],
            }),
        };
      },
    });
  }

  /*
   * Once the write is done (first in the success hooks, a hard delete's
   * too) or has failed (the error hooks, and a create's own wrapper): its
   * lock is given back, once, and whether it changed where a provider signs
   * people in is answered, for the service to tell every server: as read
   * under the lock, or - for one that only lets a provider sign more people
   * in - as worked out without it, a switch written back as it was
   * changing nothing. An attachment turned off or moved that touches a
   * provider restricted to its attached projects counts whatever was read
   * (touchesRestrictedProvider). A write that names neither switch changed
   * nothing there; nor did one that failed, whatever it answers. Never
   * throws.
   */
  public static async afterWrite<TModel extends BaseModel>(
    written: UpdateBy<TModel> | DeleteBy<TModel> | CreateBy<TModel>,
  ): Promise<boolean> {
    const key: WriteKey = keyOf(written);
    const write: GlobalSsoProviderWrite | undefined =
      GlobalSsoProviderChanges.writes.get(key);

    GlobalSsoProviderChanges.writes.delete(key);

    await GlobalSsoProviderChanges.release(write);

    return Boolean(
      write &&
        (write.isReachUnknown ||
          write.touchesRestrictedProvider ||
          write.reachChanges.some(
            (change: GlobalProviderReachChange): boolean => {
              return !GlobalSsoProviderChanges.isSameReach(
                change.before,
                change.after,
              );
            },
          )),
    );
  }

  /*
   * Once a hard delete is done (the services' onHardDeleteSuccess: it runs
   * no onDeleteSuccess - the retention job's purge): its lock is given
   * back, and whether to tell every server is answered - only when it
   * deleted a row and changed where a provider signs people in, as read
   * under the lock. A purge of rows deleted long ago, which reads none of
   * them as signing anyone in, tells no server anything.
   */
  public static async afterHardDelete<TModel extends BaseModel>(
    deleteBy: DeleteBy<TModel>,
    deletedIds: Array<ObjectID>,
  ): Promise<boolean> {
    const changedReach: boolean =
      await GlobalSsoProviderChanges.afterWrite(deleteBy);

    return changedReach && deletedIds.length > 0;
  }

  // Gives a write's lock back, once.
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

  /*
   * The last step of a service that does more once its check is done - an
   * attachment's delete reads the providers it detaches, under the lock -
   * right before the write: the lock is kept once more
   * (ProjectSsoProviderChanges.holdForWrite), and one found gone by now
   * refuses the write, giving back whatever it still holds: a delete's
   * before-hook has no error hook after it that could. A write that holds
   * no lock goes on.
   */
  public static async holdForWrite<TModel extends BaseModel>(
    written: UpdateBy<TModel> | DeleteBy<TModel> | CreateBy<TModel>,
  ): Promise<void> {
    const write: GlobalSsoProviderWrite | undefined =
      GlobalSsoProviderChanges.writes.get(keyOf(written));

    if (!write?.locks || write.locks.length === 0) {
      return;
    }

    try {
      await ProjectSsoProviderChanges.holdForWrite(write.locks);
    } catch (err) {
      await GlobalSsoProviderChanges.afterWrite(written);
      throw err;
    }
  }

  // The write a before-hook worked out, for tests and the success hooks.
  public static getWrite<TModel extends BaseModel>(
    written: UpdateBy<TModel> | DeleteBy<TModel> | CreateBy<TModel>,
  ): GlobalSsoProviderWrite | undefined {
    return GlobalSsoProviderChanges.writes.get(keyOf(written));
  }

  /*
   * A write that is never refused - it turns a provider or an attachment
   * on, or lifts the restriction - takes no lock and checks nothing, but
   * where it moves the providers is worked out all the same, so afterWrite
   * answers whether it changed anything: a switch written back as it was
   * tells no server. Read without the lock, the answer can miss a change
   * another write makes at that moment: a write that turns a provider or
   * an attachment off, or restricts it, tells the servers itself whatever
   * it read (the services' success hooks), and any other answer a server
   * holds runs out within a minute. Never throws: when the read fails, the
   * write counts as a change.
   */
  private static async workOutUnlocked(data: {
    key: WriteKey;
    work: () => Promise<Omit<GlobalSsoProviderWrite, "locks">>;
  }): Promise<GlobalSsoProviderWrite> {
    let write: GlobalSsoProviderWrite;

    try {
      write = { ...(await data.work()), locks: [] };
    } catch (err) {
      logger.warn(
        "Global SSO provider change: could not work out what it changes; every server is told.",
      );
      logger.warn(err);
      write = { reachChanges: [], locks: [], isReachUnknown: true };
    }

    GlobalSsoProviderChanges.writes.set(data.key, write);

    return write;
  }

  /*
   * Takes the lock on the server's sign-in rules, works the write out from
   * what it reads under it, and refuses it when it would strand a project.
   *
   * The rows are read under the lock, never before it: whether a write
   * narrows a provider's reach depends on the provider's switch and
   * restriction and on its other attachments, which other writes change,
   * and so does which rows a write that names them by a filter reaches. A
   * decision made from an earlier read could be overtaken by one of them -
   * an attachment created, or removed, while its provider is restricted to
   * its attached projects. Global provider and attachment writes are rare,
   * and each holds the lock for one check and one write.
   *
   * The lock is kept while the check reads, page by page, and from then on
   * kept alive for the write (ProjectSsoProviderChanges.holdForWrite) until
   * it is done (afterWrite), or given back at once when the write is
   * refused. A lock found gone when the check is done refuses the write.
   */
  private static async lockAndCheck(data: {
    key: WriteKey;
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

      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects(
          {
            globalProviders: write.reachChanges,
          },
          {
            keepLocks: async (): Promise<void> => {
              await ProjectSsoProviderChanges.keepSignInChange(locks);
            },
          },
        );

      if (stranded.count > 0) {
        throw new BadDataException(getGlobalChangeRefusalMessage(stranded));
      }

      // Checked: the lock is kept for the write until it is done.
      await ProjectSsoProviderChanges.holdForWrite(locks);

      GlobalSsoProviderChanges.writes.set(data.key, write);

      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  // The ids of rows the hooks read.
  private static idsOf(rows: Array<{ id: string }>): Array<string> {
    return rows.map((row: { id: string }): string => {
      return row.id;
    });
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

    const attachments: Map<
      string,
      Array<AttachmentRow>
    > = await GlobalSsoProviderChanges.readAttachments({
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

  /*
   * Whether any of these providers is restricted to its attached projects,
   * on or off - one that is off may be turned on, under no lock, before the
   * write lands. One that cannot be named (null) or is not found counts as
   * restricted, so a missing row never keeps a change quiet.
   */
  private static async touchesRestrictedProvider(data: {
    providerType: GlobalSsoProviderType;
    providerIds: Array<string | null>;
  }): Promise<boolean> {
    const ids: Set<string> = new Set<string>();

    for (const providerId of data.providerIds) {
      if (!providerId) {
        return true;
      }

      ids.add(providerId);
    }

    if (ids.size === 0) {
      return false;
    }

    const providers: Array<GlobalProviderRow> =
      await GlobalSsoProviderChanges.readProvidersById({
        providerType: data.providerType,
        ids: Array.from(ids),
      });

    return (
      providers.length < ids.size ||
      providers.some((provider: GlobalProviderRow): boolean => {
        return provider.restrictToAttachedProjects;
      })
    );
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
        restrictToAttachedProjects:
          record["restrictToAttachedProjects"] === true,
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
