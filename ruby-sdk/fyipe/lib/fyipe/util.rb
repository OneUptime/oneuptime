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
        enumValue = ""
        LogType.each do |key, enum|
            if (key.to_s.eql? "#{val}")
                enumValue = enum.value
            end
        end
        
        return enumValue
    end
end