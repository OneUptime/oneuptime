import MonitorElement from "../Monitor/Monitor";
import MonitorGroupElement from "../MonitorGroup/MonitorGroupElement";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import IsolatedLine from "Common/UI/Components/IsolatedText/IsolatedLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A STATUS PAGE RESOURCE'S NAME IN STATUS PAGE > RESOURCES (#6864).
 *
 * Each row of a group's list (ResourceList) and each chip of its grid
 * (ResourceGrid) names the resource's monitor or monitor group by its link.
 * With the monitor groups feature on, the link draws its kind's icon and
 * puts the name on a line of its own beside it (RecordLinkName), which
 * reads the way the name is written. With it off, the link draws its bare
 * name, <span class="flex"> name</span>, which the row's name box lays out
 * as a block that truncates (RESOURCE_ROW_NAME_CLASS_NAME): a line of the
 * page's. So on a Persian or Arabic page an English name too long for its
 * column was cut where the page's lines end, at its start - "...ilization
 * on AllNodesInEuWest1" for "oneuptime-test - High Node Memory Utilization
 * on AllNodesInEuWest1".
 *
 * Here the bare name is a line of its own that reads the way it is written
 * (IsolatedLine): its block takes the line's dir and its alignment, so an
 * English name ends in "..." at its own end and a short one still starts
 * where the page's lines do. The link's markup is left as table cells read
 * it: the bare span of a record link with no icon. A name that reads the
 * page's way keeps it: its line has no dir.
 *
 * A resource whose monitor was deleted is named by its display name, the
 * only handle left on it - a line of its own too, read the way it is
 * written.
 *
 * The line cuts itself short (NAME_LINE_CLASS_NAME). The row's and the
 * chip's boxes truncate, but text-overflow only cuts a box's own lines,
 * never a block inside it: a deleted monitor's display name, plain text on
 * this block line, ran out of its box clipped mid-letter with no "...".
 * A monitor's bare name is a block of its own that truncates (the boxes'
 * RESOURCE_BARE_NAME_CLASS_NAME), which this leaves as it was.
 */

export const STATUS_PAGE_RESOURCE_NAME_TEST_ID: string =
  "status-page-resource-name";

// One line, ending in "..." where its box does.
const NAME_LINE_CLASS_NAME: string = "truncate";

export interface ComponentProps {
  statusPageResource: StatusPageResource;
  // The monitor groups feature is on: each link draws its kind's icon.
  showIcon: boolean;
}

interface DrawnName {
  // The words that decide which way the name's line reads.
  text: string;
  element: ReactElement;
  // Drawn beside its kind's icon, on a line of its own (RecordLinkName).
  isBesideItsIcon: boolean;
}

const StatusPageResourceName: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const resource: StatusPageResource = props.statusPageResource;

  const getDrawnName: () => DrawnName = (): DrawnName => {
    if (resource.monitor) {
      return {
        text: resource.monitor.name || "",
        element: (
          <MonitorElement
            monitor={resource.monitor}
            showIcon={props.showIcon}
          />
        ),
        isBesideItsIcon: props.showIcon,
      };
    }

    if (resource.monitorGroup) {
      return {
        text: resource.monitorGroup.name || "",
        element: (
          <MonitorGroupElement
            monitorGroup={resource.monitorGroup}
            showIcon={props.showIcon}
          />
        ),
        isBesideItsIcon: props.showIcon,
      };
    }

    /*
     * A resource whose monitor was deleted still has to be identifiable -
     * its display name is the only handle left on it, and its row exists to
     * be acted on.
     */
    const name: string =
      resource.displayName ||
      translator.translateText("Unknown resource") ||
      "";

    return {
      text: name,
      element: <span className="text-gray-500">{name}</span>,
      isBesideItsIcon: false,
    };
  };

  const drawn: DrawnName = getDrawnName();

  if (drawn.isBesideItsIcon) {
    return drawn.element;
  }

  return (
    <IsolatedLine
      text={drawn.text}
      className={NAME_LINE_CLASS_NAME}
      dataTestId={STATUS_PAGE_RESOURCE_NAME_TEST_ID}
    >
      {drawn.element}
    </IsolatedLine>
  );
};

export default StatusPageResourceName;
