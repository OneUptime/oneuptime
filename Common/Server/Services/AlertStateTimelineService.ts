import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import DatabaseService from "./DatabaseService";
import AlertService from "./AlertService";
import AlertStateService from "./AlertStateService";
import UserService from "./UserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import AlertState from "../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../Models/DatabaseModels/AlertStateTimeline";
import { IsBillingEnabled } from "../EnvironmentConfig";
import { JSONObject } from "../../Types/JSON";
import AlertInternalNote from "../../Models/DatabaseModels/AlertInternalNote";
import AlertInternalNoteService from "./AlertInternalNoteService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";

export class Service extends DatabaseService<AlertStateTimeline> {
  public constructor() {
    super(AlertStateTimeline);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async getResolvedStateIdForProject(
    projectId: ObjectID,
  ): Promise<ObjectID> {
    const resolvedState: AlertState | null = await AlertStateService.findOneBy({
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
    createBy: CreateBy<AlertStateTimeline>,
  ): Promise<OnCreate<AlertStateTimeline>> {
    if (!createBy.data.alertId) {
      throw new BadDataException("alertId is null");
    }

    let mutex: SemaphoreMutex | null = null;

    try {
      if (!createBy.data.startsAt) {
        createBy.data.startsAt = OneUptimeDate.getCurrentDate();
      }

      try {
        mutex = await Semaphore.lock({
          key: createBy.data.alertId.toString(),
          namespace: "AlertStateTimeline.create",
        });
      } catch (err) {
        logger.error(err);
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
          createBy.data.rootCause = `Alert state created by ${await UserService.getUserMarkdownString(
            {
              userId: userId!,
              projectId: createBy.data.projectId || createBy.props.tenantId!,
            },
          )}`;
        }
      }

      const alertStateId: ObjectID | undefined | null =
        createBy.data.alertStateId || createBy.data.alertState?.id;

      if (!alertStateId) {
        throw new BadDataException("alertStateId is null");
      }

      const stateBeforeThis: AlertStateTimeline | null = await this.findOneBy({
        query: {
          alertId: createBy.data.alertId,
          startsAt: QueryHelper.lessThanEqualTo(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          alertState: {
            order: true,
            name: true,
          },
          startsAt: true,
          endsAt: true,
        },
      });

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

      if (stateBeforeThis && stateBeforeThis.alertStateId && alertStateId) {
        if (
          stateBeforeThis.alertStateId.toString() === alertStateId.toString()
        ) {
          throw new BadDataException(
            "Alert state cannot be same as previous state.",
          );
        }
      }

      if (stateBeforeThis && stateBeforeThis.alertState?.order) {
        const newAlertState: AlertState | null =
          await AlertStateService.findOneBy({
            query: {
              _id: alertStateId,
            },
            select: {
              order: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (newAlertState && newAlertState.order) {
          // check if the new alert state is in order is greater than the previous state order
          if (
            stateBeforeThis &&
            stateBeforeThis.alertState &&
            stateBeforeThis.alertState.order &&
            newAlertState.order <= stateBeforeThis.alertState.order
          ) {
            throw new BadDataException(
              `Alert cannot transition to ${newAlertState.name} state from ${stateBeforeThis.alertState.name} state because ${newAlertState.name} is before ${stateBeforeThis.alertState.name} in the order of alert states.`,
            );
          }
        }
      }

      const stateAfterThis: AlertStateTimeline | null = await this.findOneBy({
        query: {
          alertId: createBy.data.alertId,
          startsAt: QueryHelper.greaterThan(createBy.data.startsAt),
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        select: {
          alertStateId: true,
          startsAt: true,
          endsAt: true,
        },
      });

      // compute ends at. It's the start of the next status.
      if (stateAfterThis && stateAfterThis.startsAt) {
        createBy.data.endsAt = stateAfterThis.startsAt;
      }

      /*
       * check if this new state and the previous state are same.
       * if yes, then throw bad data exception.
       */

      if (stateAfterThis && stateAfterThis.alertStateId && alertStateId) {
        if (
          stateAfterThis.alertStateId.toString() === alertStateId.toString()
        ) {
          throw new BadDataException(
            "Alert state cannot be same as next state.",
          );
        }
      }

      logger.debug("State After this");
      logger.debug(stateAfterThis);

      const internalNote: string | undefined = (
        createBy.miscDataProps as JSONObject | undefined
      )?.["internalNote"] as string | undefined;

      if (internalNote) {
        const alertNote: AlertInternalNote = new AlertInternalNote();
        alertNote.alertId = createBy.data.alertId;
        alertNote.note = internalNote;
        alertNote.createdAt = createBy.data.startsAt;
        alertNote.projectId = createBy.data.projectId!;

        await AlertInternalNoteService.create({
          data: alertNote,
          props: createBy.props,
        });
      }

      const privateNote: string | undefined = (
        createBy.miscDataProps as JSONObject | undefined
      )?.["privateNote"] as string | undefined;

      return {
        createBy,
        carryForward: {
          statusTimelineBeforeThisStatus: stateBeforeThis || null,
          statusTimelineAfterThisStatus: stateAfterThis || null,
          privateNote: privateNote,
          mutex: mutex,
        },
      };
    } catch (error) {
      // release the mutex if it was acquired.
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }

      throw error;
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<AlertStateTimeline>,
    createdItem: AlertStateTimeline,
  ): Promise<AlertStateTimeline> {
    if (!createdItem.alertId) {
      throw new BadDataException("alertId is null");
    }

    const mutex: SemaphoreMutex | null = onCreate.carryForward.mutex;

    if (!createdItem.alertStateId) {
      throw new BadDataException("alertStateId is null");
    }

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
      await AlertService.updateOneBy({
        query: {
          _id: createdItem.alertId?.toString(),
        },
        data: {
          currentAlertStateId: createdItem.alertStateId,
        },
        props: onCreate.createBy.props,
      });
    }

    if (mutex) {
      try {
        await Semaphore.release(mutex);
      } catch (err) {
        logger.error(err);
      }
    }

    const alertState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        _id: createdItem.alertStateId.toString()!,
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

    const stateName: string = alertState?.name || "";
    let stateEmoji: string = "➡️";

    // if resolved state then change emoji to ✅.

    if (alertState?.isResolvedState) {
      stateEmoji = "✅";
    } else if (alertState?.isAcknowledgedState) {
      // eyes emoji for acknowledged state.
      stateEmoji = "👀";
    } else if (alertState?.isCreatedState) {
      stateEmoji = "🔴";
    }

    const alertNumberResult = await AlertService.getAlertNumber({
      alertId: createdItem.alertId,
    });

    const projectId: ObjectID = createdItem.projectId!;
    const alertId: ObjectID = createdItem.alertId!;

    await AlertFeedService.createAlertFeedItem({
      alertId: createdItem.alertId!,
      projectId: createdItem.projectId!,
      alertFeedEventType: AlertFeedEventType.AlertStateChanged,
      displayColor: alertState?.color,
      feedInfoInMarkdown:
        stateEmoji +
        ` Changed **[Alert ${alertNumberResult.numberWithPrefix || '#' + alertNumberResult.number}](${(await AlertService.getAlertLinkInDashboard(projectId!, alertId!)).toString()}) State** to **` +
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

    if (onCreate.carryForward.privateNote) {
      const privateNote: string = onCreate.carryForward.privateNote;

      const alertInternalNote: AlertInternalNote = new AlertInternalNote();
      alertInternalNote.alertId = createdItem.alertId;
      alertInternalNote.note = privateNote;
      alertInternalNote.createdAt = createdItem.startsAt!;
      alertInternalNote.projectId = createdItem.projectId!;

      await AlertInternalNoteService.create({
        data: alertInternalNote,
        props: onCreate.createBy.props,
      });
    }

    AlertService.refreshAlertMetrics({
      alertId: createdItem.alertId,
    }).catch((error: Error) => {
      logger.error(
        "Error while refreshing alert metrics after alert state timeline creation",
      );
      logger.error(error);
    });

    const isLastAlertState: boolean = await this.isLastAlertState({
      projectId: createdItem.projectId!,
      alertStateId: createdItem.alertStateId,
    });

    if (isLastAlertState) {
      WorkspaceNotificationRuleService.archiveWorkspaceChannels({
        projectId: createdItem.projectId!,
        notificationFor: {
          alertId: createdItem.alertId,
        },
        sendMessageBeforeArchiving: {
          _type: "WorkspacePayloadMarkdown",
          text: `**[Alert ${alertNumberResult.numberWithPrefix || '#' + alertNumberResult.number}](${(
            await AlertService.getAlertLinkInDashboard(
              createdItem.projectId!,
              createdItem.alertId!,
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

  private async isLastAlertState(data: {
    projectId: ObjectID;
    alertStateId: ObjectID;
  }): Promise<boolean> {
    // find all the states for this project and sort it by order. Then, check if this is the last state.
    const alertStates: AlertState[] = await AlertStateService.findBy({
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

    const alertState: AlertState | null =
      alertStates.find((alertState: AlertState) => {
        return alertState.id?.toString() === data.alertStateId.toString();
      }) || null;

    if (!alertState) {
      throw new BadDataException("Alert state not found.");
    }

    const lastAlertState: AlertState | undefined =
      alertStates[alertStates.length - 1];

    if (lastAlertState && lastAlertState.id) {
      return lastAlertState.id.toString() === alertState.id?.toString();
    }

    return false;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<AlertStateTimeline>,
  ): Promise<OnDelete<AlertStateTimeline>> {
    if (deleteBy.query._id) {
      const alertStateTimelineToBeDeleted: AlertStateTimeline | null =
        await this.findOneById({
          id: new ObjectID(deleteBy.query._id as string),
          select: {
            alertId: true,
            startsAt: true,
            endsAt: true,
          },
          props: {
            isRoot: true,
          },
        });

      const alertId: ObjectID | undefined =
        alertStateTimelineToBeDeleted?.alertId;

      if (alertId) {
        const alertStateTimeline: PositiveNumber = await this.countBy({
          query: {
            alertId: alertId,
          },
          props: {
            isRoot: true,
          },
        });

        if (!alertStateTimelineToBeDeleted) {
          throw new BadDataException("Alert state timeline not found.");
        }

        if (alertStateTimeline.isOne()) {
          throw new BadDataException(
            "Cannot delete the only state timeline. Alert should have at least one state in its timeline.",
          );
        }

        /*
         * There are three cases.
         * 1. This is the first state.
         * 2. This is the last state.
         * 3. This is in the middle.
         */

        const stateBeforeThis: AlertStateTimeline | null = await this.findOneBy(
          {
            query: {
              _id: QueryHelper.notEquals(deleteBy.query._id as string),
              alertId: alertId,
              startsAt: QueryHelper.lessThanEqualTo(
                alertStateTimelineToBeDeleted.startsAt!,
              ),
            },
            sort: {
              startsAt: SortOrder.Descending,
            },
            props: {
              isRoot: true,
            },
            select: {
              alertStateId: true,
              startsAt: true,
              endsAt: true,
            },
          },
        );

        const stateAfterThis: AlertStateTimeline | null = await this.findOneBy({
          query: {
            alertId: alertId,
            startsAt: QueryHelper.greaterThan(
              alertStateTimelineToBeDeleted.startsAt!,
            ),
          },
          sort: {
            startsAt: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
          select: {
            alertStateId: true,
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
              endsAt: alertStateTimelineToBeDeleted.endsAt!,
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
              startsAt: alertStateTimelineToBeDeleted.startsAt!,
            },
            props: {
              isRoot: true,
            },
          });
          logger.debug("This state is in the middle.");
        }
      }

      return { deleteBy, carryForward: alertId };
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<AlertStateTimeline>,
    _itemIdsBeforeDelete: ObjectID[],
  ): Promise<OnDelete<AlertStateTimeline>> {
    if (onDelete.carryForward) {
      // this is alertId.
      const alertId: ObjectID = onDelete.carryForward as ObjectID;

      // get last status of this alert.
      const alertStateTimeline: AlertStateTimeline | null =
        await this.findOneBy({
          query: {
            alertId: alertId,
          },
          sort: {
            startsAt: SortOrder.Descending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            alertStateId: true,
          },
        });

      if (alertStateTimeline && alertStateTimeline.alertStateId) {
        await AlertService.updateOneBy({
          query: {
            _id: alertId.toString(),
          },
          data: {
            currentAlertStateId: alertStateTimeline.alertStateId,
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
