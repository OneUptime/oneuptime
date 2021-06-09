require 'securerandom'
require_relative 'logtype'

class Util 

    def initialize(options)
        @options = options
    end

    def v4()
        return SecureRandom.uuid
    end

    def getErrorType(val)
        return LogType::val
    end
end