
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
        self.tags = []
        self.fingerprint = []
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
    
    def setTag(self, key, value):
    
        if ( not (isinstance(key, str) or isinstance(value, str)) ):
            raise Exception("Invalid Tag")
        
        exist = False;
        for tag in self.tags:
            if(tag['key'] == key):
                # set the round flag
                exist = True
                # replace value if it exist
                tag["value"] = value
                break
            
        if not exist:
            # push key and value if it doesnt
            tag = {
                "key": key,
                "value": value
            }
            self.tags.append(tag)
        
    def setTags(self, tags):
    
        if (not isinstance(tags, list) ):
            raise Exception("Invalid Tags")
        
        for tag in tags:
            if(tag['key'] is not None and tag['value'] is not None):
                self.setTag(tag['key'], tag['value'])

    def getTags(self):
        return self.tags
    
    def setFingerPrint(self, key):
    
        if not isinstance(key, (str, list)):
            raise Exception("Invalid Fingerprint")

        fingerprint = key
        if isinstance(key, str):
            fingerprint = [key]
        
        self.fingerprint = fingerprint
    
    def getFingerprint(self, errorMessage):
    
        # if no fingerprint exist currently
        if (len(self.fingerprint) < 1):
            # set up finger print based on error since none exist
            self.setFingerprint(errorMessage)
        
        return self.fingerprint
    def captureMessage(self, message):
        # set the a handled tag
        self.setTag('handled', 'true')
        messageObj = {
            "message": message
        }

        self.prepareErrorObject('message', messageObj);

        # TODO send to the server
        # return self.sendErrorEventToServer();
    
    def prepareErrorObject(self, eventType, errorStackTrace):
        # set a last timeline as the error message
        self.listenerObj.logErrorEvent(errorStackTrace["message"], type)
        
        # get current timeline
        timeline = self.getTimeline()
        # TODO get device location and details
        
        tags = self.getTags()
        fingerprint = self.getFingerprint(errorStackTrace["message"]) # default fingerprint will be the message from the error stacktrace
        # get event ID
        # Temporary display the state of the error stack, timeline and device details when an error occur
        # prepare the event so it can be sent to the server
        self.event = {
            "type": eventType,
            "timeline": timeline,
            "exception": errorStackTrace,
            "eventId": self.getEventId(),
            "tags": tags,
            "fingerprint": fingerprint,
            "errorTrackerKey": self.errorTrackerKey
        }
    
    # def sendErrorEventToServer(self):

    def getCurrentEvent(self):
        return self.event








