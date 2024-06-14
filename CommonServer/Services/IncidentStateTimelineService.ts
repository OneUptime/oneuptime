import PostgresDatabase from "../Infrastructure/PostgresDatabase";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import IncidentPublicNoteService from "./IncidentPublicNoteService";
import IncidentService from "./IncidentService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Incident from "Model/Models/Incident";
import IncidentPublicNote from "Model/Models/IncidentPublicNote";
import IncidentState from "Model/Models/IncidentState";
import IncidentStateTimeline from "Model/Models/IncidentStateTimeline";
import User from "Model/Models/User";

export class Service extends DatabaseService<IncidentStateTimeline> {
  public constructor(postgresDatabase?: PostgresDatabase) {
    super(IncidentStateTimeline, postgresDatabase);
    this.hardDeleteItemsOlderThanInDays("createdAt", 120);
  }

  public async getResolvedStateIdForProject(
    projectId: ObjectID,
  ): Promise<ObjectID> {
    const resolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          projectId: projectId,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!resolvedState) {
      throw new BadDataException("No resolved state found for the project");
    }

    return resolvedState.id!;
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentStateTimeline>,
  ): Promise<OnCreate<IncidentStateTimeline>> {
    if (!createBy.data.incidentId) {
      throw new BadDataException("incidentId is null");
    }

    if (!createBy.data.startsAt) {
      createBy.data.startsAt = OneUptimeDate.getCurrentDate();
    }

    if (
      (createBy.data.createdByUserId ||
        createBy.data.createdByUser ||
        createBy.props.userId) &&
      !createBy.data.rootCause
    ) {
      let userId: ObjectID | undefined = createBy.data.createdByUserId;

      if (createBy.props.userId) {
        userId = createBy.props.userId;
      }

      if (createBy.data.createdByUser && createBy.data.createdByUser.id) {
        userId = createBy.data.createdByUser.id;
      }

      const user: User | null = await UserService.findOneBy({
        query: {
          _id: userId?.toString() as string,
        },
        select: {
          _id: true,
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (user) {
        createBy.data.rootCause = `Incident state created by ${user.name} (${user.email})`;
      }
    }

    const lastIncidentStateTimeline: IncidentStateTimeline | null =
      await this.findOneBy({
        query: {
          incidentId: createBy.data.incidentId,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    const publicNote: string | undefined = (
      createBy.miscDataProps as JSONObject | undefined
    )?.["publicNote"] as string | undefined;

    if (publicNote) {
      const incidentPublicNote: IncidentPublicNote = new IncidentPublicNote();
      incidentPublicNote.incidentId = createBy.data.incidentId;
      incidentPublicNote.note = publicNote;
      incidentPublicNote.postedAt = createBy.data.startsAt;
      incidentPublicNote.createdAt = createBy.data.startsAt;
      incidentPublicNote.projectId = createBy.data.projectId!;
      incidentPublicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        Boolean(createBy.data.shouldStatusPageSubscribersBeNotified);

      // mark status page subscribers as notified for this state change because we dont want to send duplicate (two) emails one for public note and one for state change.
      if (
        incidentPublicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated
      ) {
        createBy.data.isStatusPageSubscribersNotified = true;
      }

      await IncidentPublicNoteService.create({
        data: incidentPublicNote,
        props: createBy.props,
      });
    }

    return {
      createBy,
      carryForward: {
        lastIncidentStateTimelineId: lastIncidentStateTimeline?.id || null,
      },
    };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<IncidentStateTimeline>,
    createdItem: IncidentStateTimeline,
  ): Promise<IncidentStateTimeline> {
    if (!createdItem.incidentId) {
      throw new BadDataException("incidentId is null");
    }

    if (!createdItem.incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }

    // update the last status as ended.

    if (onCreate.carryForward.lastIncidentStateTimelineId) {
      await this.updateOneById({
        id: onCreate.carryForward.lastIncidentStateTimelineId!,
        data: {
          endsAt: createdItem.createdAt || OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });
    }

    await IncidentService.updateOneBy({
      query: {
        _id: createdItem.incidentId?.toString(),
      },
      data: {
        currentIncidentStateId: createdItem.incidentStateId,
      },
      props: onCreate.createBy.props,
    });

    // TODO: DELETE THIS WHEN WORKFLOW IS IMPLEMENMTED.
    // check if this is resolved state, and if it is then resolve all the monitors.

    const isResolvedState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          _id: createdItem.incidentStateId.toString()!,
          isResolvedState: true,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (isResolvedState) {
      const incident: Incident | null = await IncidentService.findOneBy({
        query: {
          _id: createdItem.incidentId.toString(),
        },
        select: {
          _id: true,
          projectId: true,
          monitors: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (incident) {
        await IncidentService.markMonitorsActiveForMonitoring(
          incident.projectId!,
          incident.monitors || [],
        );
      }
    }

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncidentStateTimeline>,
  ): Promise<OnDelete<IncidentStateTimeline>> {
    if (deleteBy.query._id) {
      const incidentStateTimelineToBeDeleted: IncidentStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            incidentId: true,
            startsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const incidentId: ObjectID | undefined =
        incidentStateTimelineToBeDeleted?.incidentId;

      if (incidentId) {
        const incidentStateTimeline: PositiveNumber = await this.countBy({
          query: {
            incidentId: incidentId,
          },
          props: {
            isRoot: true,
          },
        });

        if (incidentStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Incident should have at least one state in its timeline.",
          );
        }

        if (incidentStateTimelineToBeDeleted?.startsAt) {
          const beforeState: IncidentStateTimeline | null =
            await this.findOneBy({
              query: {
                incidentId: incidentId,
                startsAt: QueryHelper.lessThan(
                  incidentStateTimelineToBeDeleted?.startsAt,
                ),
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
              props: {
                isRoot: true,
              },
              select: {
                _id: true,
                startsAt: true,
              },
            });

          if (beforeState) {
            const afterState: IncidentStateTimeline | null =
              await this.findOneBy({
                query: {
                  incidentId: incidentId,
                  startsAt: QueryHelper.greaterThan(
                    incidentStateTimelineToBeDeleted?.startsAt,
                  ),
                },
                sort: {
                  createdAt: SortOrder.Ascending,
                },
                props: {
                  isRoot: true,
                },
                select: {
                  _id: true,
                  startsAt: true,
                },
              });

            if (!afterState) {
              // if there's nothing after then end date of before state is null.

              await this.updateOneById({
                id: beforeState.id!,
                data: {
                  endsAt: null as any,
                },
                props: {
                  isRoot: true,
                },
              });
            } else {
              // if there's something after then end date of before state is start date of after state.

              await this.updateOneById({
                id: beforeState.id!,
                data: {
                  endsAt: afterState.startsAt!,
                },
                props: {
                  isRoot: true,
                },
              });
            }
          }
        }
      }

      return { deleteBy, carryForward: incidentId };
    }

    return { deleteBy, carryForward: null };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentStateTimeline>> {
    if (onDelete.carryForward) {
      // this is incidentId.
      const incidentId: ObjectID = onDelete.carryForward as ObjectID;

      // get last status of this monitor.
      const incidentStateTimeline: IncidentStateTimeline | null =
        await this.findOneBy({
          query: {
            incidentId: incidentId,
          },
          sort: {
            createdAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            incidentStateId: true,
          },
        });

      if (incidentStateTimeline && incidentStateTimeline.incidentStateId) {
        await IncidentService.updateOneBy({
          query: {
            _id: incidentId.toString(),
          },
          data: {
            currentIncidentStateId: incidentStateTimeline.incidentStateId,
          },
          props: {
            isRoot: true,
          },
        });
      }
    }

    return onDelete;
  }
}

export default new Service();
