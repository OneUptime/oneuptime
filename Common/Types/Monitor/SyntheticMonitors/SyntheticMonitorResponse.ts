import CustomCodeMonitor from "../CustomCodeMonitor/CustomCodeMonitor";
import BrowserType from "./BrowserType";
import ScreenSizeType from "./ScreenSizeType";
import Screenshots from "./Screenshot";

export default interface SyntheticMonitor
  extends CustomCodeMonitor {
  screenshots?: Screenshots | undefined; // base 64 encoded screenshots
  browserType: BrowserType;
  screenSizeType: ScreenSizeType;
}
