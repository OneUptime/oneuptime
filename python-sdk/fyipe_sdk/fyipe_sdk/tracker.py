
from util import Util
from fyipeListener import FyipeListener

class FyipeTracker:
    def __init__(self, apiUrl, errorTrackerId, errorTrackerKey, options = []):
        self.configKeys = ['baseUrl'];
        self.options = {
            'maxTimeline': 5,
            'captureCodeSnippet': True
        }
        self.errorTrackerId = errorTrackerId
        self.errorTrackerKey = errorTrackerKey
        self.apiUrl = apiUrl + "/error-tracker/" + errorTrackerId + "/track"
        self.util = Util(self.options)
        self.listenerObj = FyipeListener(self.eventId, self.options)

    # TODO set up options     
    # def setUpOptions(self, options):
    #     """
    #     Set up options needed for Fyipe Tracker
    #     """
    #     if(isinstance(options, dict) != True):
    #         return # ignore passed options if it is not an object
        
    #     for option in options:
    #         # proceed with current key if it is not in the config keys
    #         if option.key not in self.configKeys:

    def setEventId(self):
        self.eventId = self.util.v4()
    
    def getEventId(self):
        return self.eventId
    
    def addToTimeline(self, category, content, type):
        timelineObj =  {
            "category": category,
            "data": content,
            "type": type
        }

        self.listenerObj.logCustomTimelineEvent(timelineObj);

    def getTimeline(self):
        return self.listenerObj.getTimeline();




