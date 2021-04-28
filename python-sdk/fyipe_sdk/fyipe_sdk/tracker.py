
from fyipe_sdk.fyipe_sdk.util import Util
from fyipe_sdk.fyipe_sdk.fyipeListener import FyipeListener

class FyipeTracker:
    def __init__(self, apiUrl, errorTrackerId, errorTrackerKey, options = {}):
        self.configKeys = ['baseUrl'];
        self.MAX_ITEMS_ALLOWED_IN_STACK = 100
        self.options = {
            'maxTimeline': 5,
            'captureCodeSnippet': True
        }
        self.errorTrackerId = errorTrackerId
        self.errorTrackerKey = errorTrackerKey
        self.apiUrl = apiUrl + "/error-tracker/" + errorTrackerId + "/track"
        self.setUpOptions(options)
        self.util = Util(self.options)
        self.setEventId()
        self.listenerObj = FyipeListener(self.eventId, self.options)

    # set up options     
    def setUpOptions(self, options):
        """
        Set up options needed for Fyipe Tracker
        """
        if(isinstance(options, dict) != True):
            return # ignore passed options if it is not an object
        
        for option in options:
            value = options[option]
            # proceed with current key if it is not in the config keys
            if option not in self.configKeys:
                # if key is allowed in options
                if self.options[option] is not None:
                    # set max timeline properly after checking conditions
                    if option == 'maxTimeline':
                        allowedValue = value
                        if value > self.MAX_ITEMS_ALLOWED_IN_STACK or value < 1 :
                            allowedValue = self.MAX_ITEMS_ALLOWED_IN_STACK
                        
                        self.options[option] = allowedValue;
                    else:
                        self.options[option] = value;
                            



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




