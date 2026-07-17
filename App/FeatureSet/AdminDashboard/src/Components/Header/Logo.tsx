// Tailwind
import Route from "Common/Types/API/Route";
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
    <div className="relative z-10 flex px-2 lg:px-0">
      <div className="flex flex-shrink-0 items-center">
        <Image
          className="block h-8 w-auto"
          onClick={() => {
            if (props.onClick) {
              props.onClick();
            }
          }}
          imageUrl={Route.fromString(
            theme === Theme.Dark ? DarkOneUptimeLogo : OneUptimeLogo,
          )}
          alt={"OneUptime"}
        />
      </div>
    </div>
  );
};

export default Logo;
