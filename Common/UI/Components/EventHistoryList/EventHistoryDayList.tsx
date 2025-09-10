import EventHistoryItem, {
  ComponentProps as ItemComponentProps,
} from "../EventItem/EventItem";
import OneUptimeDate from "../../../Types/Date";
import React, {
  FunctionComponent,
  ReactElement,
  useState,
  useEffect,
} from "react";

export interface ComponentProps {
  date: Date;
  items: Array<ItemComponentProps>;
  isLastItem?: boolean | undefined;
}

const EventHistoryDayList: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );

  useEffect(() => {
    const handleResize: () => void = (): void => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup event listener on component unmount
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const isMobile: boolean = windowWidth <= 768;
  return (
    <div
      className="md:flex bottom-Gray500-border"
      style={{
        marginLeft: "-10px",
        marginRight: "-10px",
        marginBottom: props.isLastItem ? "0px" : "20px",
        borderBottomWidth: props.isLastItem ? "0px" : "1px",
      }}
    >
      <div
        className="text-gray-400 mt-2 text-sm"
        style={{
          padding: "20px",
          paddingLeft: "10px",
          paddingRight: "0px",
          width: isMobile ? "100%" : "15%",
        }}
      >
        {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
          props.date,
          true,
        )}
      </div>
      <div
        style={{
          padding: "10px",
          paddingTop: "0px",
          width: isMobile ? "100%" : "85%",
        }}
      >
        {props.items.map((item: ItemComponentProps, i: number) => {
          return <EventHistoryItem key={i} {...item} />;
        })}
      </div>
    </div>
  );
};

export default EventHistoryDayList;
