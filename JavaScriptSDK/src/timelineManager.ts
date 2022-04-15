class OneUptimeTimelineManager {
    private options: $TSFixMe;
    private timeLineStack: $TSFixMe;
    public constructor(options: $TSFixMe) {
        this.options = options;
        this.timeLineStack = [];
    }
    private _addItemToTimeline(item: $TSFixMe): void {
        // Get the size of the stack
        if (this.timeLineStack.length === this.options.maxTimeline) {
            // This.timeLineStack.shift(); // remove the oldest item
            return; // It discards new timline update once maximum is reached
        }
        // Add time to it
        item.timestamp = Date.now();
        // Add a new item to the stack
        this.timeLineStack.push(item);
        return true;
    }
    public addToTimeline(item: $TSFixMe): void {
        this._addItemToTimeline(item);
    }
    // Return the timeline
    public getTimeline(): void {
        return this.timeLineStack;
    }
    // Clear the timeline
    public clearTimeline(): void {
        this.timeLineStack = [];
    }
}
export default OneUptimeTimelineManager;
