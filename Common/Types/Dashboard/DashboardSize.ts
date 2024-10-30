export interface DashboardSize {
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
}

const DefaultDashboardSize: DashboardSize = {
  widthInDashboardUnits: 12,
  heightInDashboardUnits: 60,
};
// 5 rem is the dashboard unit width, and 0.94 is margin between those units.

export const DashboardRemConversionFactor: number = 5.94;

export const DahboardHeightUnitInRem: number = 5;

export const DashboardWidthUnitInRem: number = 5; 

export const DashboardSpaceBetweenUnitsInRem: number = 0.94;

export const TotalWidthOfDashboardInRem: number =
  DefaultDashboardSize.widthInDashboardUnits * DashboardRemConversionFactor;

export default DefaultDashboardSize;
