require 'ruby-enum'

class LogType
    include Ruby::Enum

    define :INFO, "info"
    define :WARNING, "warning"
    define :ERROR, "error"
end