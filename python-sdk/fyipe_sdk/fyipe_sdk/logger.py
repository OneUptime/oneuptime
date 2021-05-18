import requests
from .logtype import LogType


class FyipeLogger:
    def __init__(self, apiUrl, applicationLogId, applicationLogKey):
        self.applicationLogId = applicationLogId
        self.applicationLogKey = applicationLogKey
        self.apiUrl = apiUrl + "/application-log/" + applicationLogId + "/log"

    def log(self, data, tags=None):
        """
        Sends a log with type info
        """

        # validate the data is of type string or type object/dictionary
        if isinstance(data, (str, dict)) != True:
            return "Invalid Content to be logged"

        # if a tag is passed, validate that it is of type string or array/list
        if tags is not None:
            if isinstance(tags, (str, list)) != True:
                return "Invalid Content Tags to be logged"
        # make request to the API
        return self._makeApiRequest_(data, LogType.INFO, tags)

    def warning(self, data, tags=None):
        """
        Sends a log with type warning
        """

        # validate the data is of type string or type object/dictionary
        if isinstance(data, (str, dict)) != True:
            return "Invalid Content to be logged"

        # if a tag is passed, validate that it is of type string or array/list
        if tags is not None:
            if isinstance(tags, (str, list)) != True:
                return "Invalid Content Tags to be logged"

        # make request to the API
        return self._makeApiRequest_(data, LogType.WARNING, tags)

    def error(self, data, tags=None):
        """
        Sends a log with type error
        """

        # validate the data is of type string or type object/dictionary
        if isinstance(data, (str, dict)) != True:
            return "Invalid Content to be logged"

        # if a tag is passed, validate that it is of type string or array/list
        if tags is not None:
            if isinstance(tags, (str, list)) != True:
                return "Invalid Content Tags to be logged"

        # make request to the API
        return self._makeApiRequest_(data, LogType.ERROR, tags)

    def _makeApiRequest_(self, content, logType, tags):
        data = {
            "content": content,
            "applicationLogKey": self.applicationLogKey,
            "type": logType,
        }
        if tags is not None:
            data["tags"] = tags

        response = requests.post(self.apiUrl, json=data)
        return response.json()
