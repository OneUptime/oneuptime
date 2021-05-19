class Fyipe
    
    
    # FyipeLogger constructor.
    # @param string apiUrl
    # @param string applicationLogId
    # @param string applicationLogKey
    
    def initialize(applicationLogId, applicationLogKey, apiUrl)
        # instance variable intialzation
        @applicationLogId = applicationLogId
        setApiUrl(apiUrl)
        @applicationLogKey = applicationLogKey
    end

    def setApiUrl(apiUrl)
        @apiUrl = apiUrl + '/application-log/' + @applicationLogId + '/log';
    end

    def display
        puts "Value of APPLICATION LOG ID is: #{@applicationLogId}"
        puts "Value of APPLICATION LOG KEY is: #{@applicationLogKey}"
        puts "Value of APPLICATION LOG URL is: #{@apiUrl}"
    end 
end