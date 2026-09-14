import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import {
  DASHBOARD_GO_TO_LEADER_KEY,
  DashboardGoToShortcut,
  DashboardKeyAction,
  DashboardKeyResolution,
  getDashboardGoToShortcuts,
  resolveDashboardKeyPress,
} from "../../Utils/KeyboardShortcuts";
// The same ":"-guard the command palette navigates behind — one definition.
import { isRoutePathNavigable } from "../CommandPalette/DashboardCommandPaletteHelpers";
import Route from "Common/Types/API/Route";
import KeyboardKey from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import KeyboardShortcutsModal, {
  KeyboardShortcutDescription,
  KeyboardShortcutGroup,
} from "Common/UI/Components/KeyboardShortcut/KeyboardShortcutsModal";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import Navigation from "Common/UI/Utils/Navigation";
import {
  EMPTY_KEYBOARD_SEQUENCE_STATE,
  hasOpenModalDialog,
  KeyboardSequenceState,
} from "Common/UI/Utils/GlobalKeyboardShortcut";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/**
 * The dashboard's global keyboard layer. Mounted once in App.tsx, beside the
 * command palette and the Ask AI panel, and it owns two things:
 *
 *  - "g then <key>" navigation, so moving between products costs two
 *    keystrokes instead of a trip through a menu, and
 *  - "?", which opens the dialog listing every global shortcut — including the
 *    ones other components own (Cmd/Ctrl+K, Cmd/Ctrl+I, "/"), because a
 *    shortcut nobody can find is a shortcut nobody uses.
 *
 * Deliberately thin: every decision about whether a keypress is ours lives in
 * resolveDashboardKeyPress, where it can be pinned without a browser. All this
 * does is read the DOM for the two facts the resolver needs, and carry out the
 * answer.
 */
const DashboardKeyboardShortcuts: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);

  /*
   * A ref, not state: an armed leader changes nothing on screen, and re-
   * rendering the whole dashboard on the way to a keypress that may not even
   * complete would be a real cost for no visible benefit.
   */
  const sequenceStateRef: React.MutableRefObject<KeyboardSequenceState> =
    useRef<KeyboardSequenceState>(EMPTY_KEYBOARD_SEQUENCE_STATE);

  const closeModal: () => void = useCallback((): void => {
    setIsModalVisible(false);
  }, []);

  // Opened by the Help menu and the command palette as well as by "?".
  useEffect(() => {
    const toggle: () => void = (): void => {
      setIsModalVisible((visible: boolean) => {
        return !visible;
      });
    };

    GlobalEvents.addEventListener(EventName.KEYBOARD_SHORTCUTS_TOGGLE, toggle);

    return () => {
      GlobalEvents.removeEventListener(
        EventName.KEYBOARD_SHORTCUTS_TOGGLE,
        toggle,
      );
    };
  }, []);

  const navigateToPageMap: (pageMap: PageMap) => void = useCallback(
    (pageMap: PageMap): void => {
      const populatedRoute: Route = RouteUtil.populateRouteParams(
        RouteMap[pageMap] as Route,
      );

      /*
       * No project selected yet, so the path still carries ":projectId".
       * Navigating there would land on a broken URL — better to do nothing and
       * leave the user where they are.
       */
      if (!isRoutePathNavigable(populatedRoute.toString())) {
        return;
      }

      Navigation.navigate(populatedRoute);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const resolution: DashboardKeyResolution = resolveDashboardKeyPress({
        event: event,
        isShortcutsModalOpen: isModalVisible,
        isDialogOpen: hasOpenModalDialog(document),
        sequenceState: sequenceStateRef.current,
        now: Date.now(),
      });

      sequenceStateRef.current = resolution.sequenceState;

      if (resolution.shouldPreventDefault) {
        event.preventDefault();
      }

      switch (resolution.action) {
        case DashboardKeyAction.OpenShortcutsModal:
          setIsModalVisible(true);
          break;
        case DashboardKeyAction.CloseShortcutsModal:
          setIsModalVisible(false);
          break;
        case DashboardKeyAction.NavigateToPage:
          if (resolution.pageMap) {
            navigateToPageMap(resolution.pageMap);
          }
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isModalVisible, navigateToPageMap]);

  if (!isModalVisible) {
    /*
     * Nothing to render until it is asked for — this component is mounted on
     * every page, so its closed state has to be free.
     */
    return <></>;
  }

  const goToShortcuts: Array<KeyboardShortcutDescription> =
    getDashboardGoToShortcuts().map(
      (shortcut: DashboardGoToShortcut): KeyboardShortcutDescription => {
        return {
          id: `go-to-${shortcut.key}`,
          keySequence: [[DASHBOARD_GO_TO_LEADER_KEY], [shortcut.key]],
          description: t(shortcut.titleKey, shortcut.defaultTitle),
        };
      },
    );

  const groups: Array<KeyboardShortcutGroup> = [
    {
      id: "general",
      title: t("keyboardShortcuts.groups.general", "General"),
      shortcuts: [
        {
          id: "command-palette",
          keySequence: [[KeyboardKey.Mod, "K"]],
          description: t(
            "keyboardShortcuts.commandPalette",
            "Open the command palette",
          ),
        },
        {
          id: "ask-ai",
          keySequence: [[KeyboardKey.Mod, "I"]],
          description: t("keyboardShortcuts.askAi", "Ask AI"),
        },
        {
          id: "search-list",
          keySequence: [["/"]],
          description: t(
            "keyboardShortcuts.searchList",
            "Search the list on this page",
          ),
        },
        {
          id: "shortcuts-help",
          keySequence: [["?"]],
          description: t(
            "keyboardShortcuts.showShortcuts",
            "Show keyboard shortcuts",
          ),
        },
        {
          id: "dismiss",
          keySequence: [[KeyboardKey.Escape]],
          description: t(
            "keyboardShortcuts.dismiss",
            "Close a dialog or panel",
          ),
        },
      ],
    },
    {
      id: "go-to",
      title: t("keyboardShortcuts.groups.goTo", "Go to"),
      shortcuts: goToShortcuts,
    },
  ];

  return (
    <KeyboardShortcutsModal
      groups={groups}
      title={t("keyboardShortcuts.title", "Keyboard shortcuts")}
      description={t(
        "keyboardShortcuts.description",
        "Work faster without leaving the keyboard.",
      )}
      thenLabel={t("keyboardShortcuts.then", "then")}
      closeButtonText={t("common.close", "Close")}
      onClose={closeModal}
    />
  );
};

export default DashboardKeyboardShortcuts;
