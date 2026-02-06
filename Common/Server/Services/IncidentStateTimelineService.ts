import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import IncidentPublicNoteService from "./IncidentPublicNoteService";
import IncidentService from "./IncidentService";
import IncidentSlaService from "./IncidentSlaService";
import IncidentStateService from "./IncidentStateService";
import UserService from "./UserService";
import IncidentMemberService from "./IncidentMemberService";
import IncidentRoleService from "./IncidentRoleService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentMember from "../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../Models/DatabaseModels/IncidentRole";
import { IsBillingEnabled } from "../EnvironmentConfig";
import logger from "../Utils/Logger";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";

export class Service extends DatabaseService<IncidentStateTimeline> {
  public constructor() {
    super(IncidentStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("startsAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
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

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentStateTimeline>,
  ): Promise<OnCreate<IncidentStateTimeline>> {
    let mutex: SemaphoreMutex | null = null;

    try {
      if (!createBy.data.incidentId) {
        throw new BadDataException("incidentId is null");
      }

      try {
        mutex = await Semaphore.lock({
          key: createBy.data.incidentId.toString(),
          namespace: "IncidentStateTimeline.create",
        });
      } catch (err) {
        logger.error(err);
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

        if (userId) {
          createBy.data.rootCause = `Incident state created by ${await UserService.getUserMarkdownString(
            {
              userId: userId!,
              projectId: createBy.data.projectId || createBy.props.tenantId!,
            },
          )}`;
        }
      }

      const incidentStateId: ObjectID | undefined | null =
        createBy.data.incidentStateId || createBy.data.incidentState?.id;

      if (!incidentStateId) {
        throw new BadDataException("incidentStateId is null");
      }

      // Execute queries for before and after states in parallel for better performance
      const [stateBeforeThis, stateAfterThis] = await Promise.all([
        this.findOneBy({
          query: {
            incidentId: createBy.data.incidentId,
            startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            incidentStateId: true,
            incidentState: {
              _id: true,
              order: true,
              name: true,
              isResolvedState: true,
            },
            startsAt: true,
            endsAt: true,
          },
        }),
        this.findOneBy({
          query: {
            incidentId: createBy.data.incidentId,
            startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
          select: {
            incidentStateId: true,
            startsAt: true,
            endsAt: true,
          },
        }),
      ]);

      logger.debug("State Before this");
      logger.debug(stateBeforeThis);

      // If this is the first state, then do not notify the owner.
      if (!stateBeforeThis) {
        // since this is the first status, do not notify the owner.
        createBy.data.isOwnerNotified = true;
      }

      /*
       * check if this new state and the previous state are same.
       * if yes, then throw bad data exception.
       */

      if (
        stateBeforeThis &&
        stateBeforeThis.incidentStateId &&
        incidentStateId
      ) {
        if (
          stateBeforeThis.incidentStateId.toString() ===
          incidentStateId.toString()
        ) {
          throw new BadDataException(
            "Incident state cannot be same as previous state.",
          );
        }
      }

      if (stateBeforeThis && stateBeforeThis.incidentState?.order) {
        const newIncidentState: IncidentState | null =
          await IncidentStateService.findOneBy({
            query: {
              _id: incidentStateId,
            },
            select: {
              order: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (newIncidentState && newIncidentState.order) {
          // check if the new incident state is in order is greater than the previous state order
          if (
            stateBeforeThis &&
            stateBeforeThis.incidentState &&
            stateBeforeThis.incidentState.order &&
            newIncidentState.order <= stateBeforeThis.incidentState.order
          ) {
            throw new BadDataException(
              `Incident cannot transition to ${newIncidentState.name} state from ${stateBeforeThis.incidentState.name} state because ${newIncidentState.name} is before ${stateBeforeThis.incidentState.name} in the order of incident states.`,
            );
          }
        }
      }

      // compute ends at. It's the start of the next status.
      if (stateAfterThis && stateAfterThis.startsAt) {
        createBy.data.endsAt = stateAfterThis.startsAt;
      }

      /*
       * check if this new state and the previous state are same.
       * if yes, then throw bad data exception.
       */

      if (stateAfterThis && stateAfterThis.incidentStateId && incidentStateId) {
        if (
          stateAfterThis.incidentStateId.toString() ===
          incidentStateId.toString()
        ) {
          throw new BadDataException(
            "Incident state cannot be same as next state.",
          );
        }
      }

      logger.debug("State After this");
      logger.debug(stateAfterThis);

      const publicNote: string | undefined = (
        createBy.miscDataProps as JSONObject | undefined
      )?.["publicNote"] as string | undefined;

      if (publicNote) {
        // mark status page subscribers as notified for this state change because we dont want to send duplicate (two) emails one for public note and one for state change.
        if (createBy.data.shouldStatusPageSubscribersBeNotified) {
          createBy.data.subscriberNotificationStatus =
            StatusPageSubscriberNotificationStatus.Success;
        }
      }

      // Set notification status based on shouldStatusPageSubscribersBeNotified
      if (createBy.data.shouldStatusPageSubscribersBeNotified === false) {
        createBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Skipped;
        createBy.data.subscriberNotificationStatusMessage =
          "Notifications skipped as subscribers are not to be notified for this incident state change.";
      } else if (
        createBy.data.shouldStatusPageSubscribersBeNotified === true &&
        !publicNote
      ) {
        // Only set to Pending if there's no public note (public note handling sets it to Success)
        createBy.data.subscriberNotificationStatus =
          StatusPageSubscriberNotificationStatus.Pending;
      }

      return {
        createBy,
        carryForward: {
          statusTimelineBeforeThisStatus: stateBeforeThis || null,
          statusTimelineAfterThisStatus: stateAfterThis || null,
          publicNote: publicNote,
          mutex: mutex,
        },
      };
    } catch (err) {
      // release the mutex if it was acquired.
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }

      throw err;
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<IncidentStateTimeline>,
    createdItem: IncidentStateTimeline,
  ): Promise<IncidentStateTimeline> {
    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

    if (!createdItem.incidentId) {
      throw new BadDataException("incidentId is null");
    }

    if (!createdItem.incidentStateId) {
      throw new BadDataException("incidentStateId is null");
    }
    // update the last status as ended.

    logger.debug("Status Timeline Before this");
    logger.debug(onCreate.carryForward.statusTimelineBeforeThisStatus);

    logger.debug("Status Timeline After this");
    logger.debug(onCreate.carryForward.statusTimelineAfterThisStatus);

    logger.debug("Created Item");
    logger.debug(createdItem);

    /*
     * now there are three cases.
     * 1. This is the first status OR there's no status after this.
     */
    if (!onCreate.carryForward.statusTimelineBeforeThisStatus) {
      // This is the first status, no need to update previous status.
      logger.debug("This is the first status.");
    } else if (!onCreate.carryForward.statusTimelineAfterThisStatus) {
      /*
       * 2. This is the last status.
       * Update the previous status to end at the start of this status.
       */
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        data: {
          endsAt: createdItem.startsAt!,
        },
        props: {
          isRoot: true,
        },
      });
      logger.debug("This is the last status.");
    } else {
      /*
       * 3. This is in the middle.
       * Update the previous status to end at the start of this status.
       */
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineBeforeThisStatus.id!,
        data: {
          endsAt: createdItem.startsAt!,
        },
        props: {
          isRoot: true,
        },
      });

      // Update the next status to start at the end of this status.
      await this.updateOneById({
        id: onCreate.carryForward.statusTimelineAfterThisStatus.id!,
        data: {
          startsAt: createdItem.endsAt!,
        },
        props: {
          isRoot: true,
        },
      });
      logger.debug("This status is in the middle.");
    }

    if (!createdItem.endsAt) {
      await IncidentService.updateOneBy({
        query: {
          _id: createdItem.incidentId?.toString(),
        },
        data: {
          currentIncidentStateId: createdItem.incidentStateId,
        },
        props: onCreate.createBy.props,
      });
    }

    const incidentState: IncidentState | null =
      await IncidentStateService.findOneBy({
        query: {
          _id: createdItem.incidentStateId.toString()!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          isResolvedState: true,
          isAcknowledgedState: true,
          isCreatedState: true,
          color: true,
          name: true,
        },
      });

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }

    const stateName: string = incidentState?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to ✅.

    if (incidentState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (incidentState?.isAcknowledgedState) {
      // eyes emoji for acknowledged state.
      stateEmoji = "👀";
    } else if (incidentState?.isCreatedState) {
      stateEmoji = "🔴";
    }

    const incidentNumberResult: {
      number: number | null;
      numberWithPrefix: string | null;
    } = await IncidentService.getIncidentNumber({
      incidentId: createdItem.incidentId,
    });
    const incidentNumberDisplay: string =
      incidentNumberResult.numberWithPrefix ||
      "#" + incidentNumberResult.number;

    const projectId: ObjectID = createdItem.projectId!;
    const incidentId: ObjectID = createdItem.incidentId!;

    await IncidentFeedService.createIncidentFeedItem({
      incidentId: createdItem.incidentId!,
      projectId: createdItem.projectId!,
      incidentFeedEventType: IncidentFeedEventType.IncidentStateChanged,
      displayColor: incidentState?.color,
      feedInfoInMarkdown:
        stateEmoji +
        ` Changed **[Incident ${incidentNumberDisplay}](${(await IncidentService.getIncidentLinkInDashboard(projectId!, incidentId!)).toString()}) State** to **` +
        stateName +
        "**",
      moreInformationInMarkdown: `**Cause:**
${createdItem.rootCause}`,
      userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId:
          createdItem.createdByUserId || onCreate.createBy.props.userId,
      },
    });

    // Auto-assign Incident Commander if not already assigned
    const stateChangeUserId: ObjectID | undefined =
      createdItem.createdByUserId || onCreate.createBy.props.userId;

    if (stateChangeUserId) {
      this.autoAssignIncidentCommander({
        incidentId: createdItem.incidentId!,
        projectId: createdItem.projectId!,
        userId: stateChangeUserId,
      }).catch((error: Error) => {
        logger.error(`Error while auto-assigning incident commander:`);
        logger.error(error);
      });
    }

    const isResolvedState: boolean = incidentState?.isResolvedState || false;

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

    if (onCreate.carryForward.publicNote) {
      const publicNote: string = onCreate.carryForward.publicNote;

      const incidentPublicNote: IncidentPublicNote = new IncidentPublicNote();
      incidentPublicNote.incidentId = createdItem.incidentId;
      incidentPublicNote.note = publicNote;
      incidentPublicNote.postedAt = createdItem.startsAt!;
      incidentPublicNote.createdAt = createdItem.startsAt!;
      incidentPublicNote.projectId = createdItem.projectId!;
      incidentPublicNote.shouldStatusPageSubscribersBeNotifiedOnNoteCreated =
        Boolean(createdItem.shouldStatusPageSubscribersBeNotified);

      await IncidentPublicNoteService.create({
        data: incidentPublicNote,
        props: onCreate.createBy.props,
      });
    }

    IncidentService.refreshIncidentMetrics({
      incidentId: createdItem.incidentId,
    }).catch((error: Error) => {
      logger.error(`Error while refreshing incident metrics:`);
      logger.error(error);
    });

    // Track SLA response/resolution times
    this.trackSlaStateChange({
      incidentId: createdItem.incidentId,
      projectId: createdItem.projectId!,
      isAcknowledgedState: incidentState?.isAcknowledgedState || false,
      isResolvedState: incidentState?.isResolvedState || false,
      stateChangedAt: createdItem.startsAt || OneUptimeDate.getCurrentDate(),
      previousStateWasResolved:
        onCreate.carryForward.statusTimelineBeforeThisStatus?.incidentState
          ?.isResolvedState || false,
    }).catch((error: Error) => {
      logger.error(`Error while tracking SLA state change:`);
      logger.error(error);
    });

    const isLastIncidentState: boolean = await this.isLastIncidentState({
      projectId: createdItem.projectId!,
      incidentStateId: createdItem.incidentStateId,
    });

    if (isLastIncidentState) {
      WorkspaceNotificationRuleService.archiveWorkspaceChannels({
        projectId: createdItem.projectId!,
        notificationFor: {
          incidentId: createdItem.incidentId,
        },
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: `**[Incident ${incidentNumberDisplay}](${(
            await IncidentService.getIncidentLinkInDashboard(
              createdItem.projectId!,
              createdItem.incidentId!,
            )
          ).toString()})** is resolved. Archiving channel.`,
        },
      }).catch((error: Error) => {
        logger.error(`Error while archiving workspace channels:`);
        logger.error(error);
      });
    }

    return createdItem;
  }

  private async isLastIncidentState(data: {
    projectId: ObjectID;
    incidentStateId: ObjectID;
  }): Promise<boolean> {
    // find all the states for this project and sort it by order. Then, check if this is the last state.
    const incidentStates: IncidentState[] = await IncidentStateService.findBy({
      query: {
        projectId: data.projectId,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: {
        order: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });

    const incidentState: IncidentState | null =
      incidentStates.find((incidentState: IncidentState) => {
        return incidentState.id?.toString() === data.incidentStateId.toString();
      }) || null;

    if (!incidentState) {
      throw new BadDataException("Incident state not found.");
    }

    const lastIncidentState: IncidentState | undefined =
      incidentStates[incidentStates.length - 1];

    if (lastIncidentState && lastIncidentState.id) {
      return lastIncidentState.id.toString() === incidentState.id?.toString();
    }

    return false;
  }

  @CaptureSpan()
  private async autoAssignIncidentCommander(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    // Find the primary role (Incident Commander) for this project
    const primaryRole: IncidentRole | null =
      await IncidentRoleService.findOneBy({
        query: {
          projectId: data.projectId,
          isPrimaryRole: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!primaryRole || !primaryRole.id) {
      // No primary role found for this project
      return;
    }

    // Check if there's already an Incident Commander assigned to this incident
    const existingCommander: IncidentMember | null =
      await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          incidentRoleId: primaryRole.id,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingCommander) {
      // Already has an Incident Commander, don't assign another one
      return;
    }

    // Check if this user is already assigned to the incident (with any role)
    const existingMembership: IncidentMember | null =
      await IncidentMemberService.findOneBy({
        query: {
          incidentId: data.incidentId,
          userId: data.userId,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (existingMembership) {
      // User is already assigned to this incident, don't assign again
      return;
    }

    // Assign the user as Incident Commander
    const incidentMember: IncidentMember = new IncidentMember();
    incidentMember.incidentId = data.incidentId;
    incidentMember.projectId = data.projectId;
    incidentMember.userId = data.userId;
    incidentMember.incidentRoleId = primaryRole.id;

    await IncidentMemberService.create({
      data: incidentMember,
      props: {
        isRoot: true,
      },
    });

    logger.debug(
      `Auto-assigned user ${data.userId.toString()} as Incident Commander for incident ${data.incidentId.toString()}`,
    );
  }

  @CaptureSpan()
  private async trackSlaStateChange(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    isAcknowledgedState: boolean;
    isResolvedState: boolean;
    stateChangedAt: Date;
    previousStateWasResolved: boolean;
  }): Promise<void> {
    try {
      // Check if incident is being reopened (previous state was resolved, current state is not resolved)
      if (data.previousStateWasResolved && !data.isResolvedState) {
        // Incident is being reopened - create a new SLA record
        const incident: Incident | null = await IncidentService.findOneById({
          id: data.incidentId,
          select: {
            declaredAt: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (incident && incident.declaredAt) {
          // Create a new SLA record starting from the reopen time
          await IncidentSlaService.createSlaForIncident({
            incidentId: data.incidentId,
            projectId: data.projectId,
            declaredAt: data.stateChangedAt, // Use reopen time as SLA start time
          });

          logger.info(
            `Created new SLA record for reopened incident ${data.incidentId}`,
          );
        }

        return;
      }

      // Track acknowledged state
      if (data.isAcknowledgedState) {
        await IncidentSlaService.markResponded({
          incidentId: data.incidentId,
          respondedAt: data.stateChangedAt,
        });
      }

      // Track resolved state
      if (data.isResolvedState) {
        await IncidentSlaService.markResolved({
          incidentId: data.incidentId,
          resolvedAt: data.stateChangedAt,
        });
      }
    } catch (error) {
      logger.error(`Error in trackSlaStateChange: ${error}`);
      throw error;
    }
  }

  @CaptureSpan()
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
            endsAt: true,
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

        if (!incidentStateTimelineToBeDeleted) {
          throw new BadDataException("Incident state timeline not found.");
        }

        if (incidentStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Incident should have at least one state in its timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first state.
         * 2. This is the last state.
         * 3. This is in the middle.
         */

        const stateBeforeThis: IncidentStateTimeline | null =
          await this.findOneBy({
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              incidentId: incidentId,
              startsAt: QueryHelper.lessThanEqualTo(
                incidentStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              incidentStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        const stateAfterThis: IncidentStateTimeline | null =
          await this.findOneBy({
            query: {
              incidentId: incidentId,
              startsAt: QueryHelper.greaterThan(
                incidentStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Ascending,
            },
            props: {
              isRoot: true,
            },
            select: {
              incidentStateId: true,
              startsAt: true,
              endsAt: true,
            },
          });

        if (!stateBeforeThis) {
          // This is the first state, no need to update previous state.
          logger.debug("This is the first state.");
        } else if (!stateAfterThis) {
          /*
           * This is the last state.
           * Update the previous state to end at the end of this state.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: incidentStateTimelineToBeDeleted.endsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This is the last state.");
        } else {
          /*
           * This state is in the middle.
           * Update the previous state to end at the start of the next state.
           */
          await this.updateOneById({
            id: stateBeforeThis.id!,
            data: {
              endsAt: stateAfterThis.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });

          // Update the next state to start at the start of this state.
          await this.updateOneById({
            id: stateAfterThis.id!,
            data: {
              startsAt: incidentStateTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This state is in the middle.");
        }
      }

      return { deleteBy, carryForward: incidentId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<IncidentStateTimeline>> {
    if (onDelete.carryForward) {
      // this is incidentId.
      const incidentId: ObjectID = onDelete.carryForward as ObjectID;

      // get last status of this incident.
      const incidentStateTimeline: IncidentStateTimeline | null =
        await this.findOneBy({
          query: {
            incidentId: incidentId,
          },
          sort: {
            startsAt: SortOrder.Descending,
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
