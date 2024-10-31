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

export const GetHeightOfDashboardComponent: GetHeightOfDashboardComponentFunction = (
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

export const GetWidthOfDashboardComponent: GetWidthOfDashboardComponentFunction = (
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

export const GetDashboardComponentWidthInDashboardUnits: GetDashboardComponentWidthInDashboardUnitsFunction = (
  currentTotalDashboardWidthInPx: number,
  componentWidthInPx: number,
): number => {
  return Math.floor(
    (componentWidthInPx + (DefaultDashboardSize.widthInDashboardUnits - 1) * SpaceBetweenUnitsInPx) /
      GetDashboardUnitWidthInPx(currentTotalDashboardWidthInPx),
  );
}


type GetDashboardComponentHeightInDashboardUnitsFunction = (
  currentTotalDashboardWidthInPx: number,
  componentHeightInPx: number,
) => number;

export const GetDashboardComponentHeightInDashboardUnits: GetDashboardComponentHeightInDashboardUnitsFunction = (
  currentTotalDashboardWidthInPx: number,
  componentHeightInPx: number,
): number => {
  return Math.floor(
    (componentHeightInPx + (DefaultDashboardSize.heightInDashboardUnits - 1) * SpaceBetweenUnitsInPx) /
      GetDashboardUnitHeightInPx(currentTotalDashboardWidthInPx),
  );
}

export default DefaultDashboardSize;
