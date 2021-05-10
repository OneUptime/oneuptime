import requests

class FyipeTransport:
    
    def __init__(self, apiUrl):
        # set up the api transporter
        self.apiUrl = apiUrl
    
    def sendErrorEventToServer(self, event):
        response = self._makeApiRequest_(event)
        return response

    def _makeApiRequest_(self, body):
        # make api request and return response
        response = requests.post(self.apiUrl, json=body)
        return response.json()
    