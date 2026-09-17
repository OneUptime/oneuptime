import IconProp from "../../../../Types/Icon/IconProp";
import { HeaderAlertType } from "../HeaderAlert";

export interface NotificationItem {
  id: string;
  icon: IconProp;
  title: string;
  count: number;
  alertType: HeaderAlertType;
  tooltip?: string;
  onClick?: () => void;
  suffix?: string;
}
