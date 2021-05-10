from datetime import datetime

class FyipeTimelineManager:

    def __init__(self, options):
        self.options = options
        self.timeLineStack = []
    
    def _addItemToTimeline(self, item):
        # get the size of the stack
        if (self.options['maxTimeline'] != None and (len(self.timeLineStack) == self.options['maxTimeline'])):
            return; # It discards new timeline update once maximum is reached
        
        # add time to it
        # current date and time
        now = datetime.now()

        timestamp = str( datetime.now())
        item["timestamp"] = timestamp
        
        # add a new item to the stack
        self.timeLineStack.append(item)
        return True
    
    def addToTimeline(self, item):
        self._addItemToTimeline(item)
    
    # return the timeline
    def getTimeline(self):
        return self.timeLineStack
    
    # clear the timeline
    def clearTimeline(self):
        self.timeLineStack = []
    

    