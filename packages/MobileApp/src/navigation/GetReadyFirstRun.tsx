import React, { useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useProject } from "../hooks/useProject";
import { isFirstRunOfThisInstall } from "../onboarding/firstRun";
import { markGetReadySeen } from "../storage/getReady";
import type { MainTabParamList } from "./types";

// Whether the tabs stand where the app opens them: on Home.
export function isOnHome(navigation: {
  getState?: () =>
    | { index?: number; routes?: Array<{ name: string }> }
    | undefined;
}): boolean {
  const state:
    | { index?: number; routes?: Array<{ name: string }> }
    | undefined = navigation.getState?.();

  if (!state || !state.routes || state.routes.length === 0) {
    return false;
  }

  return state.routes[state.index ?? 0]?.name === "Home";
}

/*
 * THE FIRST STEPS, OPENED BY THEMSELVES ONCE (#7041): on a new install's
 * first launch (onboarding/firstRun.ts), as soon as the person is signed in
 * to a project, the app opens Get Ready for On-Call - a sheet over the
 * on-call overview, which Not Now puts away.
 *
 * Once, ever: it is marked opened before it opens, so a crash, a kill or a
 * sign-out never brings it back. Settings > Get Ready for On-Call opens it
 * any time after.
 */
export default function GetReadyFirstRun(): null {
  const navigation: BottomTabNavigationProp<MainTabParamList> =
    useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const { projectList, isLoadingProjects } = useProject();
  const hasOpened: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);

  const hasProject: boolean = projectList.length > 0;

  useEffect((): (() => void) => {
    isMounted.current = true;

    return (): void => {
      isMounted.current = false;
    };
  }, []);

  useEffect((): void => {
    if (hasOpened.current || isLoadingProjects || !hasProject) {
      return;
    }

    void isFirstRunOfThisInstall().then(
      async (isFirstRun: boolean): Promise<void> => {
        if (!isFirstRun || hasOpened.current || !isMounted.current) {
          return;
        }

        /*
         * Only from where the app opens - Home, with nothing opened yet. A
         * page the person or a notification already opened is never taken
         * from them; Settings has the first steps whenever they want them.
         */
        if (!isOnHome(navigation)) {
          return;
        }

        hasOpened.current = true;
        await markGetReadySeen();

        if (isMounted.current && isOnHome(navigation)) {
          navigation.navigate("OnCall", {
            screen: "GetReady",
            initial: false,
          });
        }
      },
    );
  }, [isLoadingProjects, hasProject, navigation]);

  return null;
}
