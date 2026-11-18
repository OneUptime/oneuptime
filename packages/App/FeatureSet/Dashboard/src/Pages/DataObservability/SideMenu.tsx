import DataObservabilityApi from "../../Components/DataObservability/DataObservabilityApi";
import {
  DATA_OBSERVABILITY_MENU,
  DataObservabilityMenuItem,
  DataObservabilityMenuSection,
} from "../../Utils/DataObservabilityNavigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { BadgeType } from "Common/UI/Components/Badge/Badge";
import SideMenu, {
  SideMenuItemProps,
  SideMenuSectionProps,
} from "Common/UI/Components/SideMenu/SideMenu";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * The Data Observability side menu: its sections and their pages, as
 * DataObservabilityNavigation.ts lists them - the everyday pages first,
 * then Quality (the rules the data keeps) and Usage (who relies on it and
 * what it costs), with Rules, Help and Advanced folded by their titles.
 *
 * Beside Overview, how many things need someone now (#6552), on every page
 * of the product, so a problem is seen from Tables or Checks too. Asked
 * once, when the menu is first drawn - the menu stays as the person moves
 * between the product's pages - from a route that counts and never lists
 * (DataObservabilityAttentionCount), so it slows no page. None is drawn at
 * zero, nor when it cannot be counted: the page behind works either way.
 */

export function getAttentionCountLabel(
  translator: Translator,
  count: number,
): string {
  return translator.translatePlural(
    {
      one: "{{count}} needs attention",
      other: "{{count}} need attention",
    },
    count,
  );
}

const DataObservabilitySideMenu: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();
  const [attentionCount, setAttentionCount] = useState<number>(0);

  useEffect(() => {
    let isCurrent: boolean = true;

    DataObservabilityApi.getAttentionCount()
      .then((count: number) => {
        if (isCurrent) {
          setAttentionCount(count);
        }
      })
      .catch(() => {
        // No count is drawn: a missing number beats a red error in a menu.
      });

    return () => {
      isCurrent = false;
    };
  }, []);

  const sections: Array<SideMenuSectionProps> = DATA_OBSERVABILITY_MENU.map(
    (section: DataObservabilityMenuSection): SideMenuSectionProps => {
      return {
        title: section.title,
        items: section.items.map(
          (item: DataObservabilityMenuItem): SideMenuItemProps => {
            const isOverview: boolean =
              item.page === PageMap.DATA_OBSERVABILITY_OVERVIEW &&
              attentionCount > 0;

            return {
              link: {
                title: item.title,
                to: RouteUtil.populateRouteParams(RouteMap[item.page] as Route),
              },
              icon: item.icon,
              ...(isOverview
                ? {
                    badge: attentionCount,
                    badgeType: BadgeType.WARNING,
                    badgeLabel: getAttentionCountLabel(
                      translator,
                      attentionCount,
                    ),
                  }
                : {}),
            };
          },
        ),
      };
    },
  );

  return <SideMenu sections={sections} />;
};

export default DataObservabilitySideMenu;
