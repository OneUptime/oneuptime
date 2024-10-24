export interface DashboardSize {
  widthInDashboardUnits: number;
  heightInDashboardUnits: number;
}



const DefaultDashboardSize: DashboardSize = {
  widthInDashboardUnits: 12,
  heightInDashboardUnits: 60,
};
// 5 rem is the dashboard unit width, and 0.94 is margin between those units.

export const TotalWidthOfDashboardInRem: number = DefaultDashboardSize.widthInDashboardUnits * 5.94;

export default DefaultDashboardSize;
