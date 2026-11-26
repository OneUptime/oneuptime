import MEMBER_SAVED_SIGN_IN_SETTINGS_COPY, {
  MEMBER_SAVED_SIGN_IN_SETTINGS_ALREADY_CLEARED_TOAST_TEST_ID,
  MEMBER_SAVED_SIGN_IN_SETTINGS_CLEARED_TOAST_TEST_ID,
  MEMBER_SAVED_SIGN_IN_SETTINGS_LIST_TEST_ID,
} from "./MemberSavedSignInSettingsCopy";
import { getRowUserId } from "../../Utils/ProjectRemovalReach";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { ErrorFunction, VoidFunction } from "Common/Types/FunctionTypes";
import HeldPermissionsUtil from "Common/Types/HeldPermissions";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  ClearSavedSignInSettingsAnswer,
  getProjectClearPersonSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsOfPeopleRoute,
  LocalSignInSettings,
  MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK,
  PersonSavedSignInSettings,
  readClearSavedSignInSettingsAnswer,
  readSavedSignInSettingsOfPeopleAnswer,
  toSavedSignInSettingsOfPeopleRequestJSON,
} from "Common/Types/SSO/LocalSignInClearing";
import ActionButtonSchema, {
  RowActionConfirmation,
  RowActionContext,
} from "Common/UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import {
  getGlobalTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import UserUtil from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useRef,
  useState,
} from "react";

/*
 * CLEARING ONE MEMBER'S SAVED SIGN-IN SETTINGS, FROM THE USERS LIST (#9993).
 *
 * While a project manages its people's sign-in with SSO, its owners can
 * clear what their people saved before - a password, passkeys, second steps
 * - all at once, from the Require SSO card (#9820). Here, one person at a
 * time: the project's Users list ("the Members page") asks the server, for
 * the members its page shows, which of them still have settings saved that
 * this owner may clear (POST /project/:id/saved-sign-in-settings/people),
 * says so beside their Member chip, and offers Clear Sign-In Settings in
 * their row's menu, behind a question that names them and lists exactly
 * what goes. The server holds the rule on every request - the list's and
 * the clear's (Common/Server/Utils/ProjectSignInClearing): only a member
 * whose every project is one this owner owns that manages sign-in with SSO,
 * never a master admin, never the owner. The page holds it again where it
 * can: only an owner of the project, by their own permission rows, asks;
 * only rows of members it drew are asked about; the reader's own row and a
 * pending invitation's are never offered, whatever an answer says; and an
 * answer that names anybody it did not ask about is not read.
 *
 * The clear is the bulk clear's, for one person: the same audit entry, the
 * same email. Once it is done, a toast says so and the list reads its rows
 * again, which asks the server again. It waits, as every clear does, until
 * the owner's session has confirmed it's theirs (#10775): the API client
 * asks them and sends it again. When another clear of the person came
 * first, the server clears and records nothing (#10776), and the toast says
 * their settings were already cleared.
 */

/*
 * Whether the signed-in reader may clear their people's saved sign-in
 * settings in this project: a Project Owner of it by their own permission
 * rows, a team's block taking it away, as the server reads it - never by
 * master-admin standing, which the server does not count.
 */
export const isMemberSavedSignInSettingsAsked: () => boolean = (): boolean => {
  return HeldPermissionsUtil.holdsAnyOf(
    HeldPermissionsUtil.fromRows({
      rows: PermissionUtil.getProjectPermissions()?.permissions || [],
      globalPermissions:
        PermissionUtil.getGlobalPermissions()?.globalPermissions || [],
    }),
    [Permission.ProjectOwner],
  );
};

// Whether this row is the signed-in reader's own.
const isReadersOwnRow: (row: TeamMember) => boolean = (
  row: TeamMember,
): boolean => {
  const readerId: string = (UserUtil.getUserId()?.toString() || "")
    .trim()
    .toLowerCase();

  return Boolean(readerId) && getRowUserId(row) === readerId;
};

/*
 * The members of these rows the server may be asked about: joined (a
 * pending invitation is nobody's to clear), never the reader, each once, a
 * page at most.
 */
export const getMembersToAskAbout: (
  rows: Array<TeamMember>,
) => Array<string> = (rows: Array<TeamMember>): Array<string> => {
  const userIds: Set<string> = new Set<string>();

  for (const row of rows) {
    const userId: string = getRowUserId(row);

    if (!userId || !row.hasAcceptedInvitation || isReadersOwnRow(row)) {
      continue;
    }

    userIds.add(userId);
  }

  return Array.from(userIds).slice(
    0,
    MAX_PEOPLE_PER_SAVED_SIGN_IN_SETTINGS_ASK,
  );
};

/*
 * Of these members, the ones whose saved sign-in settings the reader may
 * clear, with what each has - or null when it could not be read, and
 * nothing is offered. Only people who were asked about: an answer can name
 * nobody else.
 */
export const fetchSavedSignInSettingsOfMembers: (
  userIds: Array<string>,
) => Promise<Array<PersonSavedSignInSettings> | null> = async (
  userIds: Array<string>,
): Promise<Array<PersonSavedSignInSettings> | null> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId || userIds.length === 0) {
    return [];
  }

  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromURL(APP_API_URL).addRoute(
          new Route(
            getProjectSavedSignInSettingsOfPeopleRoute(projectId.toString()),
          ),
        ),
        data: toSavedSignInSettingsOfPeopleRequestJSON(userIds),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return null;
    }

    const askedIds: Set<string> = new Set<string>(
      userIds.map((userId: string): string => {
        return userId.trim().toLowerCase();
      }),
    );

    const people: Array<PersonSavedSignInSettings> | null =
      readSavedSignInSettingsOfPeopleAnswer(response.data);

    if (!people) {
      return null;
    }

    return people.filter((person: PersonSavedSignInSettings): boolean => {
      return askedIds.has(person.userId);
    });
  } catch {
    return null;
  }
};

/*
 * Clears one member's saved sign-in settings: how many people the server
 * cleared - one, or none when another clear of them came first (#10776) -
 * null when no answer could be read, or a throw - the error response
 * itself, for the question to say why.
 *
 * The server clears only once the owner's session has confirmed it's
 * theirs (#10775): until then it refuses, changing nothing, and the
 * Dashboard's API client asks them (Confirm It's You, mounted in App.tsx)
 * and sends the same clear again once they have, while the question waits.
 * Cancelled, the refusal is thrown, and the question says why.
 */
export const clearMemberSavedSignInSettings: (
  userId: string,
) => Promise<number | null> = async (
  userId: string,
): Promise<number | null> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return null;
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromURL(APP_API_URL).addRoute(
        new Route(
          getProjectClearPersonSavedSignInSettingsRoute(
            projectId.toString(),
            userId,
          ),
        ),
      ),
      data: {},
      headers: ModelAPI.getCommonHeaders(),
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  const answer: ClearSavedSignInSettingsAnswer | null =
    readClearSavedSignInSettingsAnswer(response.data);

  return answer ? answer.peopleCleared : null;
};

/*
 * What a clear removes from this person, one line each, in the reader's
 * words: what they have, as the server read it.
 */
export const getSavedSignInSettingLines: (
  settings: LocalSignInSettings,
  translator: Translator,
) => Array<string> = (
  settings: LocalSignInSettings,
  translator: Translator,
): Array<string> => {
  const copy: typeof MEMBER_SAVED_SIGN_IN_SETTINGS_COPY =
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY;
  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };
  const lines: Array<string> = [];

  if (settings.hasPassword) {
    lines.push(text(copy.password));
  } else if (settings.hasPasswordResetLink) {
    lines.push(text(copy.passwordResetLink));
  }

  if (settings.passkeyAndSecurityKeyCount > 0) {
    lines.push(
      translator.translatePlural(
        copy.passkeys,
        settings.passkeyAndSecurityKeyCount,
      ),
    );
  }

  if (settings.authenticatorAppCount > 0) {
    lines.push(
      translator.translatePlural(
        copy.authenticatorApps,
        settings.authenticatorAppCount,
      ),
    );
  }

  if (settings.backupCodeCount > 0) {
    lines.push(
      translator.translatePlural(copy.backupCodes, settings.backupCodeCount),
    );
  }

  if (settings.isTwoFactorAuthEnabled) {
    lines.push(text(copy.twoFactorAuth));
  }

  return lines;
};

// The person a row stands for, as the question and the toast name them.
export const getMemberName: (row: TeamMember) => string = (
  row: TeamMember,
): string => {
  return (
    row.user?.name?.toString().trim() ||
    row.user?.email?.toString().trim() ||
    ""
  );
};

// Under the question: exactly what goes, a line each.
export const SavedSignInSettingsList: FunctionComponent<{
  settings: LocalSignInSettings;
  translator: Translator;
}> = (props: {
  settings: LocalSignInSettings;
  translator: Translator;
}): ReactElement => {
  return (
    <ul
      className="list-disc space-y-1 ps-5 text-sm text-gray-600"
      data-testid={MEMBER_SAVED_SIGN_IN_SETTINGS_LIST_TEST_ID}
    >
      {getSavedSignInSettingLines(props.settings, props.translator).map(
        (line: string, index: number): ReactElement => {
          return <li key={index}>{line}</li>;
        },
      )}
    </ul>
  );
};

export interface MemberSavedSignInSettings {
  // Whether this reader asks at all: a Project Owner of the project.
  isAsked: boolean;
  // For the ModelTable: the rows it has just drawn.
  onFetchSuccess: (rows: Array<TeamMember>) => void;
  /*
   * What this row's member has saved that the reader may clear, or
   * undefined: not asked, not named by the server, a pending invitation,
   * or the reader's own row.
   */
  getSettings: (row: TeamMember) => LocalSignInSettings | undefined;
  // Forgets what was known of this person: their settings are gone.
  forget: (userId: string) => void;
}

/*
 * The Users list's half: hand `onFetchSuccess` to the ModelTable, draw the
 * chip where `getSettings` answers, and add the row action. What each page
 * answered is kept for the visit; a page read again replaces what it said
 * of its own people.
 */
export const useMemberSavedSignInSettings: () => MemberSavedSignInSettings =
  (): MemberSavedSignInSettings => {
    const isAsked: boolean = isMemberSavedSignInSettingsAsked();

    const [known, setKnown] = useState<
      ReadonlyMap<string, LocalSignInSettings>
    >(new Map<string, LocalSignInSettings>());

    /*
     * The ModelTable calls the onFetchSuccess it had when it fetched, which
     * can be a render's before: whether to ask is read from a ref, so the
     * latest decides.
     */
    const isAskedRef: MutableRefObject<boolean> = useRef<boolean>(isAsked);
    isAskedRef.current = isAsked;

    const onFetchSuccess: (rows: Array<TeamMember>) => void = useCallback(
      (rows: Array<TeamMember>): void => {
        if (!isAskedRef.current) {
          return;
        }

        const userIds: Array<string> = getMembersToAskAbout(rows);

        if (userIds.length === 0) {
          return;
        }

        fetchSavedSignInSettingsOfMembers(userIds)
          .then((people: Array<PersonSavedSignInSettings> | null): void => {
            if (!people) {
              return;
            }

            setKnown(
              (
                current: ReadonlyMap<string, LocalSignInSettings>,
              ): ReadonlyMap<string, LocalSignInSettings> => {
                const next: Map<string, LocalSignInSettings> = new Map(current);

                // What this page said of its people replaces what was known.
                for (const userId of userIds) {
                  next.delete(userId);
                }

                for (const person of people) {
                  next.set(person.userId, person.settings);
                }

                return next;
              },
            );
          })
          .catch((): void => {
            // fetchSavedSignInSettingsOfMembers answers null rather than throw.
          });
      },
      [],
    );

    const getSettings: (row: TeamMember) => LocalSignInSettings | undefined =
      useCallback(
        (row: TeamMember): LocalSignInSettings | undefined => {
          if (!isAsked || !row.hasAcceptedInvitation || isReadersOwnRow(row)) {
            return undefined;
          }

          return known.get(getRowUserId(row));
        },
        [isAsked, known],
      );

    const forget: (userId: string) => void = useCallback(
      (userId: string): void => {
        setKnown(
          (
            current: ReadonlyMap<string, LocalSignInSettings>,
          ): ReadonlyMap<string, LocalSignInSettings> => {
            const key: string = userId.trim().toLowerCase();

            if (!current.has(key)) {
              return current;
            }

            const next: Map<string, LocalSignInSettings> = new Map(current);
            next.delete(key);
            return next;
          },
        );
      },
      [],
    );

    return {
      isAsked: isAsked,
      onFetchSuccess: onFetchSuccess,
      getSettings: getSettings,
      forget: forget,
    };
  };

/*
 * Clear Sign-In Settings, as a row action of the project's Users list: on
 * the rows `getSettings` answers for, behind a question that names the
 * person and lists what goes. The question stays open, its button busy,
 * until the server has cleared them; then a toast says so, and the list
 * reads its rows again. A refusal says why, in the question.
 */
export const getClearMemberSavedSignInSettingsRowAction: (data: {
  savedSignInSettings: MemberSavedSignInSettings;
}) => ActionButtonSchema<TeamMember> = (data: {
  savedSignInSettings: MemberSavedSignInSettings;
}): ActionButtonSchema<TeamMember> => {
  const copy: typeof MEMBER_SAVED_SIGN_IN_SETTINGS_COPY =
    MEMBER_SAVED_SIGN_IN_SETTINGS_COPY;

  return {
    title: copy.action,
    buttonStyleType: ButtonStyleType.DANGER_OUTLINE,
    icon: IconProp.Key,
    isVisible: (item: TeamMember): boolean => {
      return Boolean(data.savedSignInSettings.getSettings(item));
    },
    getConfirmation: (item: TeamMember): RowActionConfirmation | undefined => {
      const settings: LocalSignInSettings | undefined =
        data.savedSignInSettings.getSettings(item);

      if (!settings) {
        return undefined;
      }

      const translator: Translator = getGlobalTranslator();
      const name: string = getMemberName(item);

      return {
        title: name
          ? translator.translateTemplate(copy.confirmTitle, { name: name })
          : translator.translateText(copy.confirmTitleWithoutName) ||
            copy.confirmTitleWithoutName,
        description:
          translator.translateText(copy.confirmDescription) ||
          copy.confirmDescription,
        submitButtonText: copy.action,
        submitButtonType: ButtonStyleType.DANGER,
        details: (
          <SavedSignInSettingsList
            settings={settings}
            translator={translator}
          />
        ),
      };
    },
    onClick: (
      item: TeamMember,
      onCompleteAction: VoidFunction,
      onError: ErrorFunction,
      context?: RowActionContext | undefined,
    ): void => {
      const userId: string = getRowUserId(item);

      if (!userId || !data.savedSignInSettings.getSettings(item)) {
        onCompleteAction();
        return;
      }

      clearMemberSavedSignInSettings(userId)
        .then((peopleCleared: number | null): void => {
          // Their chip goes at once; the list's read asks the server again.
          data.savedSignInSettings.forget(userId);
          context?.refresh();

          const translator: Translator = getGlobalTranslator();
          const name: string = getMemberName(item);

          // Nothing the server said it did: no toast at all.
          if (peopleCleared === null) {
            onCompleteAction();
            return;
          }

          /*
           * The server cleared nobody: another clear of them came first
           * (#10776), and this one removed and recorded nothing. Never a
           * success toast for a clear the server did not say it made.
           */
          if (peopleCleared < 1) {
            Toast.info(
              name
                ? translator.translateTemplate(copy.alreadyCleared, {
                    name: name,
                  })
                : translator.translateText(copy.alreadyClearedWithoutName) ||
                    copy.alreadyClearedWithoutName,
              {
                dataTestId:
                  MEMBER_SAVED_SIGN_IN_SETTINGS_ALREADY_CLEARED_TOAST_TEST_ID,
              },
            );

            onCompleteAction();
            return;
          }

          Toast.success(
            name
              ? translator.translateTemplate(copy.cleared, { name: name })
              : translator.translateText(copy.clearedWithoutName) ||
                  copy.clearedWithoutName,
            {
              dataTestId: MEMBER_SAVED_SIGN_IN_SETTINGS_CLEARED_TOAST_TEST_ID,
            },
          );

          onCompleteAction();
        })
        .catch((err: unknown): void => {
          // The server's own sentence: what happened, and what to do.
          onError(new Error(API.getFriendlyMessage(err)));
        });
    },
  };
};
