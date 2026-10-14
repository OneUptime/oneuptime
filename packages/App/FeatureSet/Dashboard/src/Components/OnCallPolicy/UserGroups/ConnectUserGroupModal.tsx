import UserGroupsAPI, { AvailableUserGroups } from "./UserGroupsAPI";
import {
  CONNECT_FORM_TEXT,
  ConnectNote,
  getConnectNotes,
  NEW_USER_GROUP_VALUE,
  USER_GROUP_LABELS,
  USER_GROUPS_COPY,
  UserGroupsWorkspaceCopy,
} from "./UserGroupsCopy";
import {
  getSuggestedSlackHandle,
  getSuggestedUserGroupName,
  isValidSlackUserGroupHandle,
  MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
  readSlackUserGroupHandle,
  SLACK_USER_GROUP_NAME_MAX_LENGTH,
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupConnectRequest,
  WorkspaceUserGroupTeam,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Modal from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * CONNECT A USER GROUP (or a tag) TO A SCHEDULE.
 *
 * Slack: one list - "Create a new user group" first, then the workspace's
 * groups as people mention them ("@payments-oncall · Payments on-call ·
 * 3 people"). A new group gets a name and a handle, suggested from the
 * schedule's name. Under the list, what connecting the group picked does:
 * the schedules it follows already, the people in it now that are
 * replaced, a group that is turned off turned back on.
 *
 * Microsoft Teams: the team (one OneUptime's app is in) and the tag's name -
 * the team's tag of that name, or a new one.
 *
 * Connecting answers with the group as it is then, for the card to show.
 */

export interface ComponentProps {
  workspaceType: WorkspaceType;
  scheduleId: string;
  scheduleName: string;
  /*
   * The groups that follow this schedule already: left out of the list,
   * since connecting one again changes nothing.
   */
  followingIds?: Array<string> | undefined;
  onClose: () => void;
  onConnected: (view: WorkspaceUserGroupView) => void;
}

interface ConnectFormValues {
  userGroup?: string | undefined;
  newGroupName?: string | undefined;
  newGroupHandle?: string | undefined;
  teamId?: string | undefined;
  tagName?: string | undefined;
}

// A Slack group as the list names it.
export const getUserGroupOptionLabel: (data: {
  group: WorkspaceAvailableUserGroup;
  translator: Translator;
}) => string = (data: {
  group: WorkspaceAvailableUserGroup;
  translator: Translator;
}): string => {
  const parts: Array<string> = [
    data.group.handle ? `@${data.group.handle}` : data.group.name,
  ];

  if (data.group.handle && data.group.name) {
    parts.push(data.group.name);
  }

  if (data.group.userCount !== null && data.group.userCount !== undefined) {
    parts.push(
      data.translator.translatePlural(
        {
          one: CONNECT_FORM_TEXT.peopleCountOne,
          other: CONNECT_FORM_TEXT.peopleCount,
        },
        data.group.userCount,
      ),
    );
  }

  if (data.group.isTurnedOff) {
    parts.push(
      data.translator.translateText(CONNECT_FORM_TEXT.turnedOffOption) ||
        CONNECT_FORM_TEXT.turnedOffOption,
    );
  }

  return parts.join(" · ");
};

const ConnectUserGroupModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const copy: UserGroupsWorkspaceCopy = USER_GROUPS_COPY[props.workspaceType];
  const isSlack: boolean = props.workspaceType === WorkspaceType.Slack;

  const [available, setAvailable] = useState<AvailableUserGroups | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>("");
  // What was sent last: the form opens with it again after a refusal.
  const [lastValues, setLastValues] =
    useState<FormValues<ConnectFormValues> | null>(null);

  useEffect(() => {
    let isCurrent: boolean = true;

    UserGroupsAPI.getAvailable({ workspaceType: props.workspaceType })
      .then((result: AvailableUserGroups) => {
        if (isCurrent) {
          setAvailable(result);
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLoadError(API.getFriendlyMessage(err));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.workspaceType]);

  const submit: (values: FormValues<ConnectFormValues>) => Promise<void> =
    async (values: FormValues<ConnectFormValues>): Promise<void> => {
      setIsSubmitting(true);
      setSubmitError("");
      setLastValues(values);

      const request: WorkspaceUserGroupConnectRequest = {
        onCallDutyPolicyScheduleId: props.scheduleId,
        workspaceType: props.workspaceType,
      };

      if (isSlack) {
        if (values.userGroup === NEW_USER_GROUP_VALUE) {
          request.newGroupName = (values.newGroupName || "").trim();
          request.newGroupHandle = readSlackUserGroupHandle(
            values.newGroupHandle || "",
          );
        } else {
          request.workspaceGroupId = values.userGroup || "";
        }
      } else {
        request.workspaceTeamId = values.teamId || "";
        request.tagName = (values.tagName || "").trim();
      }

      try {
        const view: WorkspaceUserGroupView =
          await UserGroupsAPI.connect(request);
        props.onConnected(view);
      } catch (err) {
        setSubmitError(API.getFriendlyMessage(err));
      } finally {
        setIsSubmitting(false);
      }
    };

  // The list could not be read, or there is nothing to connect to.
  const blocker: string | null = loadError
    ? loadError
    : available && !isSlack && available.teams.length === 0
      ? translator.translateText(CONNECT_FORM_TEXT.noTeams) ||
        CONNECT_FORM_TEXT.noTeams
      : null;

  if (!available || blocker) {
    return (
      <Modal
        title={copy.connectTitle}
        description={copy.connectDescription}
        isBodyLoading={!blocker}
        error={blocker || undefined}
        onClose={props.onClose}
        disableSubmitButton={true}
        submitButtonText={USER_GROUP_LABELS.connect}
        onSubmit={() => {
          // Nothing to connect yet.
        }}
      >
        <div data-testid="connect-user-group-waiting"></div>
      </Modal>
    );
  }

  const groups: Array<WorkspaceAvailableUserGroup> = available.groups.filter(
    (group: WorkspaceAvailableUserGroup): boolean => {
      return (
        !group.workspaceUserGroupId ||
        !(props.followingIds || []).includes(group.workspaceUserGroupId)
      );
    },
  );

  const fields: Array<Field<ConnectFormValues>> = isSlack
    ? [
        {
          field: { userGroup: true },
          title: CONNECT_FORM_TEXT.userGroup,
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: CONNECT_FORM_TEXT.userGroupPlaceholder,
          dropdownOptions: [
            {
              label:
                translator.translateText(CONNECT_FORM_TEXT.newUserGroup) ||
                CONNECT_FORM_TEXT.newUserGroup,
              value: NEW_USER_GROUP_VALUE,
            },
            ...groups.map(
              (group: WorkspaceAvailableUserGroup): DropdownOption => {
                return {
                  label: getUserGroupOptionLabel({
                    group: group,
                    translator: translator,
                  }),
                  value: group.workspaceGroupId,
                };
              },
            ),
          ],
          getFooterElement: (
            values: FormValues<ConnectFormValues>,
          ): ReactElement | undefined => {
            const notes: Array<ConnectNote> = getConnectNotes({
              group: groups.find(
                (group: WorkspaceAvailableUserGroup): boolean => {
                  return group.workspaceGroupId === values.userGroup;
                },
              ),
            });

            if (notes.length === 0) {
              return undefined;
            }

            return (
              <ul
                data-testid="connect-user-group-notes"
                className="mt-2 space-y-1 text-sm text-gray-600"
              >
                {notes.map((note: ConnectNote) => {
                  return (
                    <li key={note.template} className="text-pretty">
                      {note.count !== undefined && note.oneTemplate
                        ? translator.translatePlural(
                            { one: note.oneTemplate, other: note.template },
                            note.count,
                          )
                        : translator.translateTemplate(
                            note.template,
                            note.values,
                          )}
                    </li>
                  );
                })}
              </ul>
            );
          },
        },
        {
          field: { newGroupName: true },
          title: CONNECT_FORM_TEXT.name,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          defaultValue: getSuggestedUserGroupName({
            scheduleName: props.scheduleName,
            maxLength: SLACK_USER_GROUP_NAME_MAX_LENGTH,
          }),
          validation: {
            maxLength: SLACK_USER_GROUP_NAME_MAX_LENGTH,
          },
          showIf: (values: FormValues<ConnectFormValues>): boolean => {
            return values.userGroup === NEW_USER_GROUP_VALUE;
          },
        },
        {
          field: { newGroupHandle: true },
          title: CONNECT_FORM_TEXT.handle,
          description: CONNECT_FORM_TEXT.handleDescription,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          defaultValue: getSuggestedSlackHandle(props.scheduleName),
          showIf: (values: FormValues<ConnectFormValues>): boolean => {
            return values.userGroup === NEW_USER_GROUP_VALUE;
          },
          customValidation: (
            values: FormValues<ConnectFormValues>,
          ): string | null => {
            if (values.userGroup !== NEW_USER_GROUP_VALUE) {
              return null;
            }

            return isValidSlackUserGroupHandle(
              readSlackUserGroupHandle(values.newGroupHandle || ""),
            )
              ? null
              : translator.translateText(CONNECT_FORM_TEXT.handleInvalid) ||
                  CONNECT_FORM_TEXT.handleInvalid;
          },
        },
      ]
    : [
        {
          field: { teamId: true },
          title: CONNECT_FORM_TEXT.team,
          description: CONNECT_FORM_TEXT.teamDescription,
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          placeholder: CONNECT_FORM_TEXT.teamPlaceholder,
          defaultValue:
            available.teams.length === 1 ? available.teams[0]!.teamId : "",
          dropdownOptions: available.teams.map(
            (team: WorkspaceUserGroupTeam): DropdownOption => {
              return { label: team.name, value: team.teamId };
            },
          ),
        },
        {
          field: { tagName: true },
          title: CONNECT_FORM_TEXT.tag,
          description: CONNECT_FORM_TEXT.tagDescription,
          fieldType: FormFieldSchemaType.Text,
          required: true,
          defaultValue: getSuggestedUserGroupName({
            scheduleName: props.scheduleName,
            maxLength: MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
          }),
          validation: {
            maxLength: MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH,
          },
        },
      ];

  return (
    <BasicFormModal<ConnectFormValues>
      title={copy.connectTitle}
      description={copy.connectDescription}
      name="Connect on-call user group"
      submitButtonText={USER_GROUP_LABELS.connect}
      isLoading={isSubmitting}
      error={submitError || undefined}
      onClose={props.onClose}
      onSubmit={(values: ConnectFormValues) => {
        submit(values as FormValues<ConnectFormValues>).catch(() => {
          // submit keeps its own error.
        });
      }}
      formProps={{
        id: `connect-user-group-${props.workspaceType}`,
        fields: fields,
        ...(lastValues ? { initialValues: lastValues } : {}),
      }}
    />
  );
};

export default ConnectUserGroupModal;
