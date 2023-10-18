import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';

export default class NestedModel {
    private _nestedColumnns: Array<AnalyticsTableColumn> = [];
    public get nestedColumnns(): Array<AnalyticsTableColumn> {
        return this._nestedColumnns;
    }
    public set nestedColumnns(v: Array<AnalyticsTableColumn>) {
        this._nestedColumnns = v;
    }

    public constructor(data: { nestedColumns: Array<AnalyticsTableColumn> }) {
        this.nestedColumnns = data.nestedColumns;
    }
}
