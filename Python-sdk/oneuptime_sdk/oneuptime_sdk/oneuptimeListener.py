from .timelineMagager import OneUptimeTimelineManager
from .util import Util


class OneUptimeListener:
    def __init__(self, eventId, options):
        # start the timeline manager
        self.timelineObj = OneUptimeTimelineManager(options)
        self.currentEventId = eventId;
        self.utilObj = Util(options)
    
    def logErrorEvent(self, content, category = 'exception'):

        timelineObj = {
            "category": category,
            "data": content,
            "type": self.utilObj.getErrorType().ERROR,
            "eventId": self.currentEventId
        } 

        # add timeline to the stack
        self.timelineObj.addToTimeline(timelineObj)

    def logCustomTimelineEvent(self, timelineObj):
        timelineObj["eventId"] = self.currentEventId

        # add timeline to the stack
        self.timelineObj.addToTimeline(timelineObj)
    
    def getTimeline(self):
        # this always get the current state of the timeline array
        return self.timelineObj.getTimeline()
    
    def clearTimeline(self, eventId):
        # set a new eventId
        self.currentEventId = eventId
        # this will reset the state of the timeline array
        return self.timelineObj.clearTimeline()
    
    
    