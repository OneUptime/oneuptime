require 'httparty'

class OneUptimeLogger
    
    include HTTParty
    # OneUptimeLogger constructor.
    # @param string apiUrl
    # @param string applicationLogId
    # @param string applicationLogKey
    
    def initialize(apiUrl, applicationLogId, applicationLogKey)
        # instance variable intialzation
        @applicationLogId = applicationLogId
        setApiUrl(apiUrl)
        @applicationLogKey = applicationLogKey
    end

    def setApiUrl(apiUrl)
        @apiUrl = apiUrl + '/application-log/' + @applicationLogId + '/log';
    end

    def validateItems(content, tags)
         # get the class of the content and convert to string for comparison
         contentType = content.class.to_s
         tagType = tags != nil ? tags.class.to_s : nil
         
         # check if content type is not a string or hash object
         if(!((contentType.eql? "String") || (contentType.eql? "Hash")))
             raise "Invalid Content to be logged"
         end
 
         # check if tag type is avialable and its not a string or hash object
         if(tagType != nil && (!((tagType.eql? "String") || (tagType.eql? "Array"))))
             raise "Invalid Content Tags to be logged"
         end
    end

    def log(content, tags = nil)
        validateItems(content, tags)

        #set log type
        logType = "info";
        return makeApiRequest(content, logType, tags)
    end

    def warning(content, tags = nil)
        validateItems(content, tags)

        #set log type
        logType = "warning";
        return makeApiRequest(content, logType, tags)
    end

    def error(content, tags = nil)
        validateItems(content, tags)

        #set log type
        logType = "error";
        return makeApiRequest(content, logType, tags)
    end

    def makeApiRequest(data, type, tags = nil)
        # make api request and return response 
        
        body = { content: data, type: type, applicationLogKey: @applicationLogKey }
        if (tags != nil)    
            body['tags'] = tags;
        end 
        params = { body: body }

        response = self.class.post(@apiUrl, params).parsed_response
        return response
    
    end

end