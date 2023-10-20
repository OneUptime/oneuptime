import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';
import CommonModel from './CommonModel';

export default class NestedModel extends CommonModel {
    public constructor(data: { tableColumns: Array<AnalyticsTableColumn> }) {
        super(data);
    }
}
