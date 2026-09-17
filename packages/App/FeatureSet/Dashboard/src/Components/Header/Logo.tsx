// Tailwind
import Image from "Common/UI/Components/Image/Image";
import OneUptimeLogo from "Common/UI/Images/logos/OneUptimeSVG/3-transparent.svg";
import { Theme, useTheme } from "Common/UI/Utils/Theme";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  onClick: () => void;
}

const getDarkThemeLogo: (logo: string) => string = (logo: string): string => {
  const base64Marker: string = "base64,";
  const markerIndex: number = logo.indexOf(base64Marker);

  if (
    markerIndex === -1 ||
    typeof window === "undefined" ||
    typeof window.atob !== "function" ||
    typeof window.btoa !== "function"
  ) {
    return logo;
  }

  try {
    const prefix: string = logo.substring(0, markerIndex + base64Marker.length);
    const source: string = window.atob(
      logo.substring(markerIndex + base64Marker.length),
    );
    const darkSource: string = source.split("#121212").join("#f8fafc");
    return `${prefix}${window.btoa(darkSource)}`;
  } catch {
    return logo;
  }
};

const DarkOneUptimeLogo: string = getDarkThemeLogo(OneUptimeLogo);

const Logo: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const theme: Theme = useTheme();

  return (
    /*
     * The wordmark is a 5:1 letterbox, so at h-8 it is 160px wide — nearly
     * half a phone header, and the profile and bell buttons beside it have
     * nowhere to go. Shrink the mark and its gutter below sm.
     */
    <div className="relative z-10 flex items-center border-r border-gray-200 pr-2 mr-2 -ml-2 sm:pr-4 sm:mr-4 sm:-ml-5">
      <div className="flex flex-shrink-0 items-center">
        <Image
          className="oneuptime-dashboard-logo block h-6 w-auto cursor-pointer hover:opacity-80 transition-opacity sm:h-8"
          onClick={() => {
            if (props.onClick) {
              props.onClick();
            }
          }}
          imageUrl={theme === Theme.Dark ? DarkOneUptimeLogo : OneUptimeLogo}
          alt={"OneUptime"}
        />
      </div>
    </div>
  );
};

export default Logo;
