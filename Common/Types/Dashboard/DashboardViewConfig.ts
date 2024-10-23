import DashboardBaseComponent from "./DashboardComponents/DashboardBaseComponent";

export default interface DashboardViewConfig {
  _type: "DashboardViewConfig";
  components: Array<DashboardBaseComponent>;
}
