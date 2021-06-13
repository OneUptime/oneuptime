require_relative 'fyipe/util'
require_relative 'fyipe/fyipeListener'
class FyipeTracker
    # FyipeLogger constructor.
    # @param string apiUrl
    # @param string errorTrackerId
    # @param string errorTrackerKey
    
    def initialize(apiUrl, errorTrackerId, errorTrackerKey, options = [])
        # instance variable intialzation
        @configKeys = ['baseUrl']
        @MAX_ITEMS_ALLOWED_IN_STACK = 100
        @errorTrackerId = errorTrackerId
        setApiUrl(apiUrl) 
        @errorTrackerKey = errorTrackerKey
        @tags = []
        @fingerprint = []
        @options = {
            'maxTimeline': 5
        }
        setUpOptions(options)
        @util = Util.new(@options)
        setEventId()
        @listenerObj = FyipeListener.new(getEventId(), @options)
    end

    def setApiUrl(apiUrl)
        @apiUrl = apiUrl + '/error-tracking/' + @errorTrackerId + '/track';
    end

    def setUpOptions(options)
        # set up options
        if(options.class.to_s != "Hash")
            return # ignore passed options if it is not an object
        end

        options.each do |key, value|
            # proceed with current key if it is not in the config keys
             if (!(@configKeys.include? key))
                # if key is allowed in options
                if (@options[key] != nil)
                     # set max timeline properly after hecking conditions
                     if key.to_s == 'maxTimeline'
                        allowedValue = value
                        if value > @MAX_ITEMS_ALLOWED_IN_STACK or value < 1
                            allowedValue = @MAX_ITEMS_ALLOWED_IN_STACK
                        end
                        
                        @options[key] = allowedValue
                    end
                end

             end
        end
    end

    def setEventId()
        @eventId = @util.v4()
    end
    
    def getEventId()
        return @eventId
    end

    def addToTimeline(category, content, type)
        timelineObj =  {}
        timelineObj["category"] = category
        timelineObj["data"] = content,
        timelineObj["type"] = type

        @listenerObj.logCustomTimelineEvent(timelineObj)
    end

    def getTimeline()
        return @listenerObj.getTimeline()
    end
end
