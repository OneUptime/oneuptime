export interface DashboardSize {
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
}

const DefaultDashboardSize: DashboardSize = {
  widthInDashboardUnits: 12,
  heightInDashboardUnits: 60,
};

export const SpaceBetweenUnitsInPx: number = 10;
export const MarginForEachUnitInPx: number = 10 / 2;

/*
 * Below this viewport width the canvas drops to a stacked single-column
 * layout: each component renders full-width in display order. Edit-mode
 * drag/resize is disabled at this width since absolute coordinates lose
 * their meaning on a 1-column grid.
 */
export const MobileBreakpointInPx: number = 768;

export const isMobileViewport: (widthInPx: number) => boolean = (
  widthInPx: number,
): boolean => {
  return widthInPx > 0 && widthInPx < MobileBreakpointInPx;
};

type GetDashboardUnitWidthInPxFunction = (
  currentTotalDashboardWidthInPx: number,
) => number;

export const GetDashboardUnitWidthInPx: GetDashboardUnitWidthInPxFunction = (
  currentTotalDashboardWidthInPx: number,
): number => {
  return (
    (currentTotalDashboardWidthInPx -
      (DefaultDashboardSize.widthInDashboardUnits - 1) *
        SpaceBetweenUnitsInPx) /
    DefaultDashboardSize.widthInDashboardUnits
  );
};

type GetDashboardUnitHeightInPxFunction = (
  currentTotalDashboardWidthInPx: number,
) => number;

export const GetDashboardUnitHeightInPx: GetDashboardUnitHeightInPxFunction = (
  currentTotalDashboardWidthInPx: number,
): number => {
  return GetDashboardUnitWidthInPx(currentTotalDashboardWidthInPx); // its a square, so height is the same as width
};

type GetHeightOfDashboardComponentFunction = (
  heightInDashboardUnits: number,
  totalCurrentDashboardWidthInPx: number,
) => number;

export const GetHeightOfDashboardComponent: GetHeightOfDashboardComponentFunction =
  (
    heightInDashboardUnits: number,
    totalCurrentDashboardWidthInPx: number,
  ): number => {
    return (
      heightInDashboardUnits *
        GetDashboardUnitHeightInPx(totalCurrentDashboardWidthInPx) +
      (heightInDashboardUnits - 1) * SpaceBetweenUnitsInPx
    );
  };

type GetWidthOfDashboardComponentFunction = (
  widthInDashboardUnits: number,
  totalCurrentDashboardWidthInPx: number,
) => number;

export const GetWidthOfDashboardComponent: GetWidthOfDashboardComponentFunction =
  (
    widthInDashboardUnits: number,
    totalCurrentDashboardWidthInPx: number,
  ): number => {
    return (
      widthInDashboardUnits *
        GetDashboardUnitWidthInPx(totalCurrentDashboardWidthInPx) +
      (widthInDashboardUnits - 1) * SpaceBetweenUnitsInPx
    );
  };

type GetDashboardComponentWidthInDashboardUnitsFunction = (
  currentTotalDashboardWidthInPx: number,
  componentWidthInPx: number,
) => number;

export const GetDashboardComponentWidthInDashboardUnits: GetDashboardComponentWidthInDashboardUnitsFunction =
  (
    currentTotalDashboardWidthInPx: number,
    componentWidthInPx: number,
  ): number => {
    const eachUnitSizeInPx: number =
      currentTotalDashboardWidthInPx /
      DefaultDashboardSize.widthInDashboardUnits; // each square is these many pixels

    // now check how many squares can fit in the component width
    const units: number = Math.ceil(componentWidthInPx / eachUnitSizeInPx);

    if (units < 1) {
      return 1;
    }

    return units;
  };

type GetDashboardComponentHeightInDashboardUnitsFunction = (
  currentTotalDashboardWidthInPx: number,
  componentHeightInPx: number,
) => number;

export const GetDashboardComponentHeightInDashboardUnits: GetDashboardComponentHeightInDashboardUnitsFunction =
  (
    currentTotalDashboardWidthInPx: number,
    componentHeightInPx: number,
  ): number => {
    const eachUnitSizeInPx: number =
      currentTotalDashboardWidthInPx /
      DefaultDashboardSize.widthInDashboardUnits; // each square is these many pixels

    // now check how many squares can fit in the component height
    const units: number = Math.ceil(componentHeightInPx / eachUnitSizeInPx);

    if (units < 1) {
      return 1;
    }

    return units;
  };

export default DefaultDashboardSize;
