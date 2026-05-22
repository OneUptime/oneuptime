import LabelsElement from "Common/UI/Components/Label/Labels";
import MonitorTypeUtil from "../../Utils/MonitorType";
import ProjectUtil from "Common/UI/Utils/Project";

import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { Black, Gray500, Red500 } from "Common/Types/BrandColors";
import BadDataException from "Common/Types/Exception/BadDataException";
import IconProp from "Common/Types/Icon/IconProp";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import {
  ModalTableBulkDefaultActions,
  SaveFilterProps,
} from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import useBulkLabelActions from "Common/UI/Components/BulkUpdate/BulkLabelActions";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import FieldType from "Common/UI/Components/Types/FieldType";
import API from "Common/UI/Utils/API/API";
import Query from "Common/Types/BaseDatabase/Query";
import Includes from "Common/Types/BaseDatabase/Includes";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import Team from "Common/Models/DatabaseModels/Team";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
  useEffect,
} from "react";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import MonitorElement from "./Monitor";
import MonitorOwnersCell, { MonitorOwnerEntry } from "./MonitorOwnersCell";
import ActionButtonSchema from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { CardButtonSchema } from "Common/UI/Components/Card/Card";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ObjectID from "Common/Types/ObjectID";
import ProbeUtil from "../../Utils/Probe";
import ProjectUser from "../../Utils/ProjectUser";

export interface ComponentProps {
  query?: Query<Monitor> | undefined;
  noItemsMessage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  disableCreate?: boolean | undefined;
  actionButtons?: Array<ActionButtonSchema<Monitor>> | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
  saveFilterProps?: SaveFilterProps | undefined;
  videoLink?: Route | URL | undefined;
  refreshToggle?: string | undefined;
}

const MonitorsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [probes, setProbes] = useState<Array<Probe>>([]);
  const [showAddProbesModal, setShowAddProbesModal] = useState<boolean>(false);
  const [showRemoveProbesModal, setShowRemoveProbesModal] =
    useState<boolean>(false);
  const [bulkActionProps, setBulkActionProps] =
    useState<BulkActionOnClickProps<Monitor> | null>(null);

  const [ownersByMonitorId, setOwnersByMonitorId] = useState<{
    [monitorId: string]: Array<MonitorOwnerEntry>;
  }>({});
  const [isLoadingOwners, setIsLoadingOwners] = useState<boolean>(false);

  const [userOptions, setUserOptions] = useState<Array<DropdownOption>>([]);
  const [teamOptions, setTeamOptions] = useState<Array<DropdownOption>>([]);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(
    null,
  );
  const [selectedOwnerTeamId, setSelectedOwnerTeamId] = useState<string | null>(
    null,
  );
  const [ownerFilterMonitorIds, setOwnerFilterMonitorIds] =
    useState<Array<string> | null>(null);

  const { bulkActions: labelBulkActions, modals: labelBulkActionModals } =
    useBulkLabelActions<Monitor>({ modelType: Monitor });

  useEffect(() => {
    const fetchProbes: () => Promise<void> = async (): Promise<void> => {
      try {
        const allProbes: Array<Probe> = await ProbeUtil.getAllProbes();
        setProbes(allProbes);
      } catch {
        // probes will remain empty, bulk actions will still work
      }
    };

    fetchProbes();
  }, []);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const fetchOwnerFilterOptions: () => Promise<void> =
      async (): Promise<void> => {
        try {
          const [users, teamsResult]: [
            Array<DropdownOption>,
            ListResult<Team>,
          ] = await Promise.all([
            ProjectUser.fetchProjectUsersAsDropdownOptions(projectId),
            ModelAPI.getList<Team>({
              modelType: Team,
              query: { projectId: projectId },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
              },
              sort: { name: 1 },
            }),
          ]);

          setUserOptions(users);
          setTeamOptions(
            teamsResult.data.map((team: Team) => {
              return {
                value: team._id as string,
                label: team.name?.toString() || "",
              };
            }),
          );
        } catch {
          // dropdowns will stay empty; filter still degrades gracefully
        }
      };

    fetchOwnerFilterOptions();
  }, []);

  useEffect(() => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    if (!selectedOwnerUserId && !selectedOwnerTeamId) {
      setOwnerFilterMonitorIds(null);
      return;
    }

    let cancelled: boolean = false;

    const computeMatchingMonitorIds: () => Promise<void> =
      async (): Promise<void> => {
        try {
          let userMonitorIds: Set<string> | null = null;
          let teamMonitorIds: Set<string> | null = null;

          if (selectedOwnerUserId) {
            const result: ListResult<MonitorOwnerUser> =
              await ModelAPI.getList<MonitorOwnerUser>({
                modelType: MonitorOwnerUser,
                query: {
                  userId: new ObjectID(selectedOwnerUserId),
                  projectId: projectId,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: { monitorId: true },
                sort: {},
              });

            userMonitorIds = new Set(
              result.data
                .map((item: MonitorOwnerUser) => {
                  return item.monitorId?.toString();
                })
                .filter((id: string | undefined): id is string => {
                  return Boolean(id);
                }),
            );
          }

          if (selectedOwnerTeamId) {
            const result: ListResult<MonitorOwnerTeam> =
              await ModelAPI.getList<MonitorOwnerTeam>({
                modelType: MonitorOwnerTeam,
                query: {
                  teamId: new ObjectID(selectedOwnerTeamId),
                  projectId: projectId,
                },
                limit: LIMIT_PER_PROJECT,
                skip: 0,
                select: { monitorId: true },
                sort: {},
              });

            teamMonitorIds = new Set(
              result.data
                .map((item: MonitorOwnerTeam) => {
                  return item.monitorId?.toString();
                })
                .filter((id: string | undefined): id is string => {
                  return Boolean(id);
                }),
            );
          }

          let finalIds: Array<string>;
          if (userMonitorIds && teamMonitorIds) {
            finalIds = [...userMonitorIds].filter((id: string) => {
              return teamMonitorIds!.has(id);
            });
          } else {
            finalIds = Array.from(
              userMonitorIds || teamMonitorIds || new Set<string>(),
            );
          }

          if (!cancelled) {
            setOwnerFilterMonitorIds(finalIds);
          }
        } catch {
          if (!cancelled) {
            setOwnerFilterMonitorIds([]);
          }
        }
      };

    computeMatchingMonitorIds();

    return () => {
      cancelled = true;
    };
  }, [selectedOwnerUserId, selectedOwnerTeamId]);

  const mergedQuery: Query<Monitor> = useMemo(() => {
    const base: Query<Monitor> = (props.query as Query<Monitor>) || {};

    if (ownerFilterMonitorIds === null) {
      return base;
    }

    if (ownerFilterMonitorIds.length === 0) {
      return {
        ...base,
        _id: new Includes([
          new ObjectID("00000000-0000-0000-0000-000000000000"),
        ]),
      } as Query<Monitor>;
    }

    return {
      ...base,
      _id: new Includes(
        ownerFilterMonitorIds.map((id: string) => {
          return new ObjectID(id);
        }),
      ),
    } as Query<Monitor>;
  }, [props.query, ownerFilterMonitorIds]);

  const handleMonitorsFetched: (monitors: Array<Monitor>) => void = (
    monitors: Array<Monitor>,
  ): void => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      return;
    }

    const monitorIds: Array<string> = monitors
      .map((m: Monitor) => {
        return m.id?.toString();
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (monitorIds.length === 0) {
      setOwnersByMonitorId({});
      return;
    }

    setIsLoadingOwners(true);

    const fetchOwners: () => Promise<void> = async (): Promise<void> => {
      try {
        const [userResult, teamResult]: [
          ListResult<MonitorOwnerUser>,
          ListResult<MonitorOwnerTeam>,
        ] = await Promise.all([
          ModelAPI.getList<MonitorOwnerUser>({
            modelType: MonitorOwnerUser,
            query: {
              monitorId: new Includes(
                monitorIds.map((id: string) => {
                  return new ObjectID(id);
                }),
              ),
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              monitorId: true,
              user: {
                _id: true,
                name: true,
                email: true,
                profilePictureId: true,
              },
            },
            sort: {},
          }),
          ModelAPI.getList<MonitorOwnerTeam>({
            modelType: MonitorOwnerTeam,
            query: {
              monitorId: new Includes(
                monitorIds.map((id: string) => {
                  return new ObjectID(id);
                }),
              ),
              projectId: projectId,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              monitorId: true,
              team: {
                _id: true,
                name: true,
              },
            },
            sort: {},
          }),
        ]);

        const map: { [k: string]: Array<MonitorOwnerEntry> } = {};

        for (const id of monitorIds) {
          map[id] = [];
        }

        for (const item of userResult.data) {
          const key: string | undefined = item.monitorId?.toString();
          if (key && item.user) {
            map[key]?.push({ kind: "user", user: item.user });
          }
        }

        for (const item of teamResult.data) {
          const key: string | undefined = item.monitorId?.toString();
          if (key && item.team) {
            map[key]?.push({ kind: "team", team: item.team });
          }
        }

        setOwnersByMonitorId(map);
      } catch {
        // leave owners empty if fetch fails
      } finally {
        setIsLoadingOwners(false);
      }
    };

    fetchOwners();
  };

  const clearOwnerFilter: () => void = (): void => {
    setSelectedOwnerUserId(null);
    setSelectedOwnerTeamId(null);
  };

  const isOwnerFilterActive: boolean = Boolean(
    selectedOwnerUserId || selectedOwnerTeamId,
  );

  const handleBulkAddProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    onBulkActionStart();

    const inProgressItems: Array<Monitor> = [...items];
    const totalItems: Array<Monitor> = [...items];
    const successItems: Array<Monitor> = [];
    const failedItems: Array<BulkActionFailed<Monitor>> = [];

    for (const monitor of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

      try {
        if (!monitor.id) {
          throw new BadDataException("Monitor ID not found");
        }

        if (
          !monitor.monitorType ||
          !MonitorTypeHelper.isProbableMonitor(
            monitor.monitorType as MonitorType,
          )
        ) {
          failedItems.push({
            item: monitor,
            failedMessage: "This monitor type does not support probes",
          });

          onProgressInfo({
            totalItems: totalItems,
            failed: failedItems,
            successItems: successItems,
            inProgressItems: inProgressItems,
          });

          continue;
        }

        // Check if this probe is already assigned to this monitor
        const existingProbes: ListResult<MonitorProbe> =
          await ModelAPI.getList<MonitorProbe>({
            modelType: MonitorProbe,
            query: {
              monitorId: monitor.id,
              probeId: probeId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (existingProbes.data.length > 0) {
          failedItems.push({
            item: monitor,
            failedMessage: "Probe is already assigned to this monitor",
          });
        } else {
          const monitorProbe: MonitorProbe = new MonitorProbe();
          monitorProbe.monitorId = monitor.id;
          monitorProbe.probeId = probeId;
          monitorProbe.projectId = ProjectUtil.getCurrentProjectId()!;
          monitorProbe.isEnabled = true;

          await ModelAPI.create<MonitorProbe>({
            model: monitorProbe,
            modelType: MonitorProbe,
          });

          successItems.push(monitor);
        }
      } catch (err) {
        failedItems.push({
          item: monitor,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowAddProbesModal(false);
    setBulkActionProps(null);
  };

  const handleBulkRemoveProbes: (probeId: ObjectID) => Promise<void> = async (
    probeId: ObjectID,
  ): Promise<void> => {
    if (!bulkActionProps) {
      return;
    }

    const { items, onProgressInfo, onBulkActionStart, onBulkActionEnd } =
      bulkActionProps;

    onBulkActionStart();

    const inProgressItems: Array<Monitor> = [...items];
    const totalItems: Array<Monitor> = [...items];
    const successItems: Array<Monitor> = [];
    const failedItems: Array<BulkActionFailed<Monitor>> = [];

    for (const monitor of totalItems) {
      inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

      try {
        if (!monitor.id) {
          throw new BadDataException("Monitor ID not found");
        }

        if (
          !monitor.monitorType ||
          !MonitorTypeHelper.isProbableMonitor(
            monitor.monitorType as MonitorType,
          )
        ) {
          failedItems.push({
            item: monitor,
            failedMessage: "This monitor type does not support probes",
          });

          onProgressInfo({
            totalItems: totalItems,
            failed: failedItems,
            successItems: successItems,
            inProgressItems: inProgressItems,
          });

          continue;
        }

        // Find the MonitorProbe record to delete
        const existingProbes: ListResult<MonitorProbe> =
          await ModelAPI.getList<MonitorProbe>({
            modelType: MonitorProbe,
            query: {
              monitorId: monitor.id,
              probeId: probeId,
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            limit: 1,
            skip: 0,
            select: {
              _id: true,
            },
            sort: {},
          });

        if (existingProbes.data.length === 0) {
          failedItems.push({
            item: monitor,
            failedMessage: "Probe is not assigned to this monitor",
          });
        } else {
          await ModelAPI.deleteItem<MonitorProbe>({
            modelType: MonitorProbe,
            id: existingProbes.data[0]!.id!,
          });

          successItems.push(monitor);
        }
      } catch (err) {
        failedItems.push({
          item: monitor,
          failedMessage: API.getFriendlyMessage(err),
        });
      }

      onProgressInfo({
        totalItems: totalItems,
        failed: failedItems,
        successItems: successItems,
        inProgressItems: inProgressItems,
      });
    }

    onBulkActionEnd();
    setShowRemoveProbesModal(false);
    setBulkActionProps(null);
  };

  const getBulkAddProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Add Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.Signal,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowAddProbesModal(true);
        },
      };
    };

  const getBulkRemoveProbesAction: () => BulkActionButtonSchema<Monitor> =
    (): BulkActionButtonSchema<Monitor> => {
      return {
        title: "Remove Probe",
        buttonStyleType: ButtonStyleType.NORMAL,
        icon: IconProp.Close,
        onClick: async (
          actionProps: BulkActionOnClickProps<Monitor>,
        ): Promise<void> => {
          setBulkActionProps(actionProps);
          setShowRemoveProbesModal(true);
        },
      };
    };

  let cardbuttons: Array<CardButtonSchema> = props.cardButtons
    ? [...props.cardButtons]
    : [];

  if (!props.disableCreate) {
    // then add a card button that takes to monitor create page
    cardbuttons = [
      ...(props.cardButtons || []),
      {
        title: "Create Monitor",
        onClick: () => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.MONITOR_CREATE] as Route,
            ),
          );
        },
        buttonStyle: ButtonStyleType.NORMAL,
        icon: IconProp.Add,
      },
    ];
  }

  return (
    <div>
      <div className="mb-3 rounded-md border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="monitor-owner-user-filter"
            >
              Filter by owner (User)
            </label>
            <Dropdown
              id="monitor-owner-user-filter"
              placeholder="Any user"
              options={userOptions}
              value={
                selectedOwnerUserId
                  ? userOptions.find((o: DropdownOption) => {
                      return o.value === selectedOwnerUserId;
                    })
                  : undefined
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value === null || Array.isArray(value)) {
                  setSelectedOwnerUserId(null);
                  return;
                }
                setSelectedOwnerUserId(value.toString());
              }}
            />
          </div>
          <div className="flex-1">
            <label
              className="mb-1 block text-xs font-medium text-gray-700"
              htmlFor="monitor-owner-team-filter"
            >
              Filter by owner (Team)
            </label>
            <Dropdown
              id="monitor-owner-team-filter"
              placeholder="Any team"
              options={teamOptions}
              value={
                selectedOwnerTeamId
                  ? teamOptions.find((o: DropdownOption) => {
                      return o.value === selectedOwnerTeamId;
                    })
                  : undefined
              }
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (value === null || Array.isArray(value)) {
                  setSelectedOwnerTeamId(null);
                  return;
                }
                setSelectedOwnerTeamId(value.toString());
              }}
            />
          </div>
          {isOwnerFilterActive && (
            <div>
              <Button
                title="Clear owners"
                buttonStyle={ButtonStyleType.NORMAL}
                onClick={clearOwnerFilter}
              />
            </div>
          )}
        </div>
      </div>
      <ModelTable<Monitor>
        modelType={Monitor}
        name="Monitors"
        userPreferencesKey="monitors-table"
        id="Monitors-table"
        saveFilterProps={props.saveFilterProps}
        bulkActions={{
          buttons: [
            {
              title: "Disable Monitor",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (props: BulkActionOnClickProps<Monitor>) => {
                const inProgressItems: Array<Monitor> = [...props.items]; // items to be disabled
                const totalItems: Array<Monitor> = [...props.items]; // total items
                const successItems: Array<Monitor> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<Monitor>> = []; // items that failed to disable

                props.onBulkActionStart();

                for (const monitor of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

                  try {
                    if (!monitor.id) {
                      throw new BadDataException("Monitor ID not found");
                    }

                    await ModelAPI.updateById<Monitor>({
                      id: monitor.id,
                      modelType: Monitor,
                      data: {
                        disableActiveMonitoring: true,
                      },
                    });

                    successItems.push(monitor);
                  } catch (err) {
                    failedItems.push({
                      item: monitor,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Stop,
              confirmTitle: (items: Array<Monitor>) => {
                return `Disable ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<Monitor>) => {
                return `Are you sure you want to disable ${items.length} monitor(s)?`;
              },
            },
            {
              title: "Enable Monitor",
              buttonStyleType: ButtonStyleType.NORMAL,
              onClick: async (props: BulkActionOnClickProps<Monitor>) => {
                const inProgressItems: Array<Monitor> = [...props.items]; // items to be disabled
                const totalItems: Array<Monitor> = [...props.items]; // total items
                const successItems: Array<Monitor> = []; // items that are disabled
                const failedItems: Array<BulkActionFailed<Monitor>> = []; // items that failed to disable

                props.onBulkActionStart();

                for (const monitor of totalItems) {
                  // remove this item from inProgressItems

                  inProgressItems.splice(inProgressItems.indexOf(monitor), 1);

                  try {
                    if (!monitor.id) {
                      throw new BadDataException("Monitor ID not found");
                    }

                    await ModelAPI.updateById<Monitor>({
                      id: monitor.id,
                      modelType: Monitor,
                      data: {
                        disableActiveMonitoring: false,
                      },
                    });

                    successItems.push(monitor);
                  } catch (err) {
                    failedItems.push({
                      item: monitor,
                      failedMessage: API.getFriendlyMessage(err),
                    });
                  }

                  props.onProgressInfo({
                    totalItems: totalItems,
                    failed: failedItems,
                    successItems: successItems,
                    inProgressItems: inProgressItems,
                  });
                }

                props.onBulkActionEnd();
              },

              icon: IconProp.Play,
              confirmTitle: (items: Array<Monitor>) => {
                return `Enable ${items.length} Monitor(s)`;
              },
              confirmMessage: (items: Array<Monitor>) => {
                return `Are you sure you want to enable ${items.length} monitor(s) for active monitoring?`;
              },
            },
            getBulkAddProbesAction(),
            getBulkRemoveProbesAction(),
            ...labelBulkActions,
            ModalTableBulkDefaultActions.Delete,
          ],
        }}
        actionButtons={props.actionButtons}
        isDeleteable={false}
        showViewIdButton={true}
        isEditable={false}
        isCreateable={false}
        isViewable={true}
        refreshToggle={props.refreshToggle}
        query={mergedQuery}
        onFetchSuccess={(data: Array<Monitor>) => {
          handleMonitorsFetched(data);
        }}
        createEditModalWidth={ModalWidth.Large}
        cardProps={{
          title: props.title || "Monitors",
          description:
            props.description || "Here is a list of monitors for this project.",
          buttons: cardbuttons,
        }}
        videoLink={props.videoLink}
        selectMoreFields={{
          disableActiveMonitoring: true,
          isNoProbeEnabledOnThisMonitor: true,
          isAllProbesDisconnectedFromThisMonitor: true,
          monitorType: true,
        }}
        noItemsMessage={props.noItemsMessage || "No monitors found."}
        showRefreshButton={true}
        searchableFields={["name", "description"]}
        viewPageRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.MONITORS]!,
        )}
        filters={[
          {
            title: "Monitor ID",
            type: FieldType.Text,
            field: {
              _id: true,
            },
          },
          {
            title: "Name",
            type: FieldType.Text,
            field: {
              name: true,
            },
          },
          {
            title: "Monitor Type",
            type: FieldType.Text,
            field: {
              monitorType: true,
            },
            filterDropdownOptions:
              MonitorTypeUtil.monitorTypesAsDropdownOptions(),
          },
          {
            title: "Monitor Status",
            type: FieldType.Entity,
            field: {
              currentMonitorStatus: {
                color: true,
                name: true,
              },
            },
            filterEntityType: MonitorStatus,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            title: "Labels",
            type: FieldType.EntityArray,
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            filterEntityType: Label,
            filterQuery: {
              projectId: ProjectUtil.getCurrentProjectId()!,
            },
            filterDropdownField: {
              label: "name",
              value: "_id",
            },
          },
          {
            title: "Created At",
            type: FieldType.Date,
            field: {
              createdAt: true,
            },
          },
        ]}
        columns={[
          {
            field: {
              name: true,
            },
            title: "Name",
            type: FieldType.Element,
            getElement: (item: Monitor): ReactElement => {
              return <MonitorElement monitor={item} />;
            },
          },
          {
            field: {
              monitorType: true,
            },
            title: "Monitor Type",
            type: FieldType.Text,
            hideOnMobile: true,
          },
          {
            field: {
              currentMonitorStatus: {
                color: true,
                name: true,
              },
            },

            title: "Monitor Status",
            type: FieldType.Entity,

            getElement: (item: Monitor): ReactElement => {
              if (!item["currentMonitorStatus"]) {
                throw new BadDataException("Monitor Status not found");
              }

              if (item && item["disableActiveMonitoring"]) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Gray500}
                    text={"Disabled"}
                  />
                );
              }

              if (item && item.isNoProbeEnabledOnThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Not Enabled"}
                  />
                );
              }

              if (item && item.isAllProbesDisconnectedFromThisMonitor) {
                return (
                  <Statusbubble
                    shouldAnimate={false}
                    color={Red500}
                    text={"Probes Disconnected"}
                  />
                );
              }

              return (
                <Statusbubble
                  color={item.currentMonitorStatus.color || Black}
                  shouldAnimate={true}
                  text={item.currentMonitorStatus.name || "Unknown"}
                />
              );
            },
          },
          {
            field: {
              labels: {
                name: true,
                color: true,
              },
            },
            title: "Labels",
            type: FieldType.EntityArray,
            hideOnMobile: true,

            getElement: (item: Monitor): ReactElement => {
              return <LabelsElement labels={item["labels"] || []} />;
            },
          },
          {
            field: {
              _id: true,
            },
            title: "Owners",
            type: FieldType.Element,
            hideOnMobile: true,
            getElement: (item: Monitor): ReactElement => {
              const id: string | undefined = item.id?.toString();
              const owners: Array<MonitorOwnerEntry> | undefined = id
                ? ownersByMonitorId[id]
                : undefined;
              return (
                <MonitorOwnersCell
                  owners={owners}
                  isLoading={isLoadingOwners}
                />
              );
            },
          },
        ]}
      />

      {showAddProbesModal && (
        <BasicFormModal
          title="Add Probe to Monitors"
          description="Select a probe to add to the selected monitors. Monitors that already have this probe assigned will be skipped."
          onClose={() => {
            setShowAddProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Add Probe"
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkAddProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}

      {labelBulkActionModals}

      {showRemoveProbesModal && (
        <BasicFormModal
          title="Remove Probe from Monitors"
          description="Select a probe to remove from the selected monitors. Monitors that do not have this probe assigned will be skipped."
          onClose={() => {
            setShowRemoveProbesModal(false);
            setBulkActionProps(null);
          }}
          submitButtonText="Remove Probe"
          onSubmit={async (formData: { probeId: ObjectID }) => {
            await handleBulkRemoveProbes(formData.probeId);
          }}
          formProps={{
            fields: [
              {
                field: {
                  probeId: true,
                },
                title: "Select Probe",
                fieldType: FormFieldSchemaType.Dropdown,
                required: true,
                dropdownOptions: probes.map((probe: Probe) => {
                  return {
                    label: probe.name || "",
                    value: probe.id?.toString() || "",
                  };
                }),
              },
            ],
          }}
        />
      )}
    </div>
  );
};

export default MonitorsTable;
