class OneUptimeTimelineManager {
    options: $TSFixMe;
    timeLineStack: $TSFixMe;
    constructor(options: $TSFixMe) {
        this.options = options;
        this.timeLineStack = [];
    }
    _addItemToTimeline(item: $TSFixMe): void {
        // get the size of the stack
        if (this.timeLineStack.length === this.options.maxTimeline) {
            // this.timeLineStack.shift(); // remove the oldest item
            return; // It discards new timline update once maximum is reached
        }
        // add time to it
        item.timestamp = Date.now();
        // add a new item to the stack
        this.timeLineStack.push(item);
        return true;
    }
    addToTimeline(item: $TSFixMe): void {
        this._addItemToTimeline(item);
    }
    // return the timeline
    getTimeline(): void {
        return this.timeLineStack;
    }
    // clear the timeline
    clearTimeline(): void {
        this.timeLineStack = [];
    }
}
export default OneUptimeTimelineManager;
