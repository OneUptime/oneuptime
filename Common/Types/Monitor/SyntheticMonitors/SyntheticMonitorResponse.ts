import CustomCodeMonitorResponse from '../CustomCodeMonitor/CustomCodeMonitorResponse';
import BrowserType from './BrowserType';
import ScreenSizeType from './ScreenSizeType';
import Screenshots from './Screenshot';

export default interface SyntheticMonitorResponse
    extends CustomCodeMonitorResponse {
    screenshots?: Screenshots | undefined; // base 64 encoded screenshots
    browserType: BrowserType;
    screenSizeType: ScreenSizeType;
}
