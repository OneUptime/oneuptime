import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SideMenu from "Common/UI/Components/SideMenu/SideMenu";
import SideMenuItem from "Common/UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "Common/UI/Components/SideMenu/SideMenuSection";
import React, { FunctionComponent, ReactElement } from "react";
import useAiOffered from "../../../Utils/UseAiOffered";

export interface ComponentProps {
  modelId: ObjectID;
}

const ExceptionViewSideMenu: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const getRoute: (pageMap: PageMap) => Route = (pageMap: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
      modelId: props.modelId,
    });
  };

  /*
   * AI Assistance is an AI action: with the project's AI switched off there
   * is nothing on it anyone can start, so it is not in the menu
   * (Common/Utils/Suggestions/AiSuggestion).
   */
  const isAiOffered: boolean = useAiOffered();

  return (
    <SideMenu>
      <SideMenuSection title="Investigate">
        <SideMenuItem
          link={{ title: "Overview", to: getRoute(PageMap.EXCEPTIONS_VIEW) }}
          icon={IconProp.Info}
        />
        <SideMenuItem
          link={{
            title: "Stack Trace",
            to: getRoute(PageMap.EXCEPTIONS_VIEW_STACK_TRACE),
          }}
          icon={IconProp.Code}
        />
        <SideMenuItem
          link={{
            title: "Occurrences",
            to: getRoute(PageMap.EXCEPTIONS_VIEW_OCCURRENCES),
          }}
          icon={IconProp.List}
        />
        <SideMenuItem
          link={{
            title: "Context",
            to: getRoute(PageMap.EXCEPTIONS_VIEW_CONTEXT),
          }}
          icon={IconProp.Activity}
        />
        <SideMenuItem
          link={{
            title: "Logs",
            to: getRoute(PageMap.EXCEPTIONS_VIEW_LOGS),
          }}
          icon={IconProp.Logs}
        />
      </SideMenuSection>

      {isAiOffered ? (
        <SideMenuSection title="Resolve">
          <SideMenuItem
            link={{
              title: "AI Assistance",
              to: getRoute(PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE),
            }}
            icon={IconProp.Bolt}
          />
        </SideMenuSection>
      ) : (
        <></>
      )}

      <SideMenuSection title="Manage">
        <SideMenuItem
          link={{
            title: "Settings",
            to: getRoute(PageMap.EXCEPTIONS_VIEW_SETTINGS),
          }}
          icon={IconProp.Settings}
        />
      </SideMenuSection>
    </SideMenu>
  );
};

export default ExceptionViewSideMenu;
