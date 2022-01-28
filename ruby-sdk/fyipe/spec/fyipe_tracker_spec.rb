# spec/oneuptime_tracker_spec.rb
require_relative '../lib/oneuptime'
require_relative 'helper'

RSpec.configure do |config|
    config.before(:suite){
        # using $ registers the variable as a global variable
        # ref: https://stackoverflow.com/a/19167379/6800815
        $apiUrl = 'http://localhost:3002/api'
        $helper = Helper.new()
        sampleUser = $helper.getSampleUser()
        $customTimeline = {}
        $customTimeline["category"] = "cart"
        $customTimeline["type"] = "info"
        $customTimeline["content"] = { "message": "test-content"}

        begin
            # create user
            createdUser = $helper.makeApiRequest($apiUrl+"/user/signup", sampleUser)

            # get token and project
            $token = createdUser['tokens']['jwtAccessToken']
            $project = createdUser['project']

            # create a component
            component = { 'name' => $helper.getTitle() }
            $createdComponent = $helper.makeApiRequest($apiUrl+"/component/"+$project["_id"], component, $token) 
            
            # create an errorTracker and set it as the global error tracker.
            errorTrack = { 'name' => $helper.getTitle() }
            $errorTracker = $helper.makeApiRequest($apiUrl+"/error-tracker/"+$project["_id"]+"/"+$createdComponent["_id"]+"/create", errorTrack, $token)
        rescue => exception
            puts "Couldnt create an error tracker to run a test, Error occured: #{exception.message}"
        ensure
            puts "All clear, Tests will commence now"
        end 
                        
    }
end

RSpec.describe OneUptimeTracker do
    it 'test_should_take_in_custom_timeline_event' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        timeline = tracker.getTimeline()
        expect(timeline).to be_an_instance_of(Array)
        expect(timeline.length()).to eql 1
        expect($customTimeline["category"]).to eql timeline[0]["category"]
    end
    it 'test_should_ensure_timeline_event_contains_eventId_and_timestamp' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        timeline = tracker.getTimeline()

        expect(timeline[0]["eventId"]).to be_an_instance_of(String)
        expect(timeline[0]["timestamp"]).to be_an_instance_of(String)
    end
    it 'test_should_ensure_different_timeline_event_have_the_same_eventId' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "error")

        timeline = tracker.getTimeline()
        expect(timeline.length()).to eql 2 # two timeline events
        expect(timeline[0]["eventId"]).to eql timeline[1]["eventId"] # their eventId is the same, till there is an error sent to the server
    end
    it 'test_should_ensure_max_timline_cant_be_set_as_a_negative_number' do
        options = {
            "maxTimeline": -5
        }
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)

        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "error")

        timeline = tracker.getTimeline()
        expect(timeline.length()).to eql 2 # two timeline events
    end
    it 'test_should_ensure_new_timeline_event_after_max_timeline_are_discarded' do
        options = {
            "maxTimeline": 2
        }
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)

        customTimeline2 = {}

        customTimeline2["category"] = "logout"
        customTimeline2["type"] = "success"
        customTimeline2["content"] = {"message": "tester"}

        # add 3 timeline events
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tracker.addToTimeline(customTimeline2["category"], customTimeline2["content"], customTimeline2["type"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], "debug")

        timeline = tracker.getTimeline()
        
        expect(options[:maxTimeline]).to eql timeline.length() # two timeline events
        expect(timeline[0]["type"]).to eql $customTimeline["type"]
        expect(timeline[1]["category"]).to eql customTimeline2["category"]
    end

    it 'test_should_add_tags' do 
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        tag = {
            "key": "location",
            "value": "Warsaw"
        } 
        tracker.setTag(tag[:key], tag[:value])
        
        availableTags = tracker.getTags()
        expect(availableTags).to be_an_instance_of(Array)
        expect(availableTags.length()).to eql 1
        expect(tag[:key]).to eql availableTags[0]["key"]
    end

    it 'test_should_add_multiple_tags' do
        
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        tags = []
        tag = {
            "key": "location",
            "value": "Warsaw"
        } 
        tags.append(tag)

        tagB = {
            "key": "city",
            "value": "Leeds"
        } 
        tags.append(tagB)

        tagC = {
            "key": "device",
            "value": "iPhone"
        } 
        tags.append(tagC)

        tracker.setTags(tags)

        availableTags = tracker.getTags()
        expect(availableTags).to be_an_instance_of(Array)
        expect(availableTags.length()).to eql tags.length()
    end

    it 'test_should_overwrite_existing_keys_to_avoid_duplicate_tags' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        tags = []
        tag = {
            "key": "location",
            "value": "Warsaw"
        } 
        tags.append(tag)

        tagB = {
            "key": "city",
            "value": "Leeds"
        } 
        tags.append(tagB)

        tagC = {
            "key": "location",
            "value": "Paris"
        } 
        tags.append(tagC)

        tagD = {
            "key": "device",
            "value": "iPhone"
        } 
        tags.append(tagD)

        tagE = {
            "key": "location",
            "value": "London"
        } 
        tags.append(tagE)

        tracker.setTags(tags)

        availableTags = tracker.getTags()
        expect(availableTags).to be_an_instance_of(Array)
        expect(availableTags.length()).to eql 3 # only 3 unique tags
        expect(tagC[:key]).to eql availableTags[0]["key"]
        expect(tagC[:value]).not_to eql availableTags[0]["value"]# old value for that tag location
        expect(tagE[:key]).to eql availableTags[0]["key"]
        expect(tagE[:value]).to eql availableTags[0]["value"]# latest value for that tag location
    end

    it 'test_should_create_fingerprint_as_message_for_error_capture_without_any_fingerprint' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = "Uncaught Exception"
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()
        expect(event["fingerprint"][0]).to eql errorMessage
    end
    it 'test_should_use_defined_fingerprint_array_for_error_capture_with_fingerprint' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])


        fingerprints = ['custom', 'errors']
        tracker.setFingerPrint(fingerprints)
        errorMessage = 'Uncaught Exception'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()
        expect(event["fingerprint"][0]).to eql fingerprints[0]
        expect(event["fingerprint"][1]).to eql fingerprints[1]
    end
    it 'test_should_use_defined_fingerprint_string_for_error_capture_with_fingerprint' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        fingerprint = 'custom-fingerprint'
        tracker.setFingerPrint(fingerprint)
        errorMessage = 'Uncaught Exception'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()
        expect(event["fingerprint"][0]).to eql fingerprint
    end
    it 'test_should_create_an_event_ready_for_the_server_using_capture_message' do 
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = 'This is a test'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()
        expect(event["type"]).to eql "message"
        expect(event["exception"]["message"]).to eql errorMessage
    end 
    it 'test_should_create_an_event_ready_for_the_server_while_having_the_timeline_with_same_event_id' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        
        errorMessage = 'This is a test'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()

        expect(event["timeline"].length()).to eql 2
        expect(event["eventId"]).to eql event["timeline"][0]["eventId"]
        expect(event["exception"]["message"]).to eql errorMessage
    end
    it 'test_should_create_an_event_ready_for_the_server_using_capture_exception' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = 'Error Found'
        tracker.captureException(Exception.new(errorMessage))
        event = tracker.getCurrentEvent()

        expect(event["type"]).to eql "exception"
        expect(event["exception"]["message"]).to eql errorMessage
    end
    it 'test_should_create_an_event_with_array_of_stacktrace' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorType = ""
        begin
            divByZero = 1/0
        rescue => ex
            errorType = ex.class
            tracker.captureException(ex)
        end
        event = tracker.getCurrentEvent()

        expect(event["type"]).to eql "exception"
        expect(event["exception"]["type"]).to eql errorType
        expect(event["exception"]["stacktrace"]).to be_an_instance_of(Hash)
        expect(event["exception"]["stacktrace"]["frames"]).to be_an_instance_of(Array)
    end   
    it 'test_should_create_an_event_with_the_object_of_the_stacktrace_in_place' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorType = ''
        begin
            divByZero= 1/0
        rescue => ex
            errorType = ex.class
            tracker.captureException(ex)
        end

        event = tracker.getCurrentEvent()
        frame = event["exception"]["stacktrace"]["frames"][0]
        
        expect(frame).to have_key('methodName')
        expect(frame).to have_key('lineNumber')
        expect(frame).to have_key('fileName')

    end 
    it 'test_should_create_an_event_and_new_event_should_have_different_id' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = 'random error occured'
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        event = tracker.captureMessage(errorMessage)

        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        newEvent = nil
        errorMessageException = ''
        begin
            divByZero= 1/0
        rescue => ex
            errorMessageException = ex.message
            newEvent = tracker.captureException(ex)
        end

        # ensure that the first event have a type message, same error message
        expect(event["type"]).to eql "message"
        expect(event["content"]["message"]).to eql errorMessage


        # ensure that the second event have a type exception, same error message
        expect(newEvent["type"]).to eql "exception"
        expect(newEvent["content"]["message"]).to eql errorMessageException

        
        # confim their eventId is different
        expect(event["_id"]).not_to eql newEvent["_id"]
    end
    it 'test_should_create_an_event_that_has_timeline_and_new_event_having_timeline_and_tags' do 
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = 'random error caused midway'
        errorMessageObj = '';

        # add timeline to first tracker
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        event =tracker.captureMessage(errorMessage)

        # add timeline and tag to second tracker
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])
        tag = {
            "key": "location",
            "value": "Warsaw"
        } 
        tracker.setTag(tag[:key], tag[:value])
        newEvent = nil
        begin  
            divByZero= 1/0
        rescue => ex
            errorMessageObj = ex.message
            newEvent = tracker.captureException(ex)
        end

        # puts event["timeline"]
        # ensure that the first event have a type message, same error message and two timeline (one custom, one generic)
        expect(event["type"]).to eql "message"
        expect(event["content"]["message"]).to eql errorMessage
        expect(event["timeline"].length()).to eql 2
        expect(event["tags"].length()).to eql 1 # the default event tag added

        # ensure that the second event have a type exception, same error message and 2 tags
        expect(newEvent["type"]).to eql "exception"
        expect(newEvent["content"]["message"]).to eql errorMessageObj
        expect(newEvent["timeline"].length()).to eql 2
        expect(newEvent["tags"].length()).to eql 2 # the default and custom tag
    end
    it 'test_should_contain_version_number_and_sdk_name_in_captured_message' do
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"])

        errorMessage = 'Error Found'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()

        expect(event["sdk"]["name"]).to be_an_instance_of(String)

        expect(event['sdk']['version']).to match(/(([0-9])+\.([0-9])+\.([0-9])+)/)# confirm that the version follows the pattern XX.XX.XX where X is a non negative integer
    end
    it 'test_should_add_code_capture_to_stack_trace_when_flag_is_passed_in_options' do
        options = {
            "captureCodeSnippet": true
        }
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        event = nil
        errorMsg = ''
        begin
            divByZero = 1/0
        rescue => ex
            errorMsg = ex.message
            event = tracker.captureException(ex)
        end

        expect(event["type"]).to eql "exception"
        expect(event["content"]["message"]).to eql errorMsg
        expect(event["content"]["stacktrace"]).to be_an_instance_of(Hash)
        expect(event["content"]["stacktrace"]["frames"]).to be_an_instance_of(Array)
        
        
        incidentFrame = event["content"]["stacktrace"]["frames"][0]
        expect(incidentFrame).to have_key('linesBeforeError')
        expect(incidentFrame).to have_key('linesAfterError')
        expect(incidentFrame).to have_key('errorLine')
    end
    it 'test_should_not_add_code_capture_to_stack_trace_when_flag_is_passed_in_options' do
        options = {
            "captureCodeSnippet": false
        }
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        event = nil
        errorType = ''
        begin
            divByZero = 1/0
        rescue => ex
            errorType = ex.class.to_s
            event = tracker.captureException(ex)
        end

        expect(event["type"]).to eql "exception"
        expect(event["content"]["type"]).to eql errorType
        expect(event["content"]["stacktrace"]).to be_an_instance_of(Hash)
        expect(event["content"]["stacktrace"]["frames"]).to be_an_instance_of(Array)
        
        
        incidentFrame = event["content"]["stacktrace"]["frames"][0]
        expect(incidentFrame).to_not have_key('linesBeforeError')
        expect(incidentFrame).to_not have_key('linesAfterError')
        expect(incidentFrame).to_not have_key('errorLine')
    end
    it 'test_should_add_code_capture_to_stack_trace_by_default_when_unwanted_flag_is_passed_in_options' do
        options = {
            "captureCodeSnippet": "heyy" # sdk expects a true or false but it defaults to true if wrong value is sent
        }
        tracker = OneUptimeTracker.new($apiUrl, $errorTracker["_id"], $errorTracker["key"], options)
        tracker.addToTimeline($customTimeline["category"], $customTimeline["content"], $customTimeline["type"])

        event = nil
        errorMsg = ''
        begin
            divByZero = 1/0
        rescue => ex
            errorMsg = ex.message
            event = tracker.captureException(ex)
        end

        expect(event["type"]).to eql "exception"
        expect(event["content"]["message"]).to eql errorMsg
        expect(event["content"]["stacktrace"]).to be_an_instance_of(Hash)
        expect(event["content"]["stacktrace"]["frames"]).to be_an_instance_of(Array)
        
        
        incidentFrame = event["content"]["stacktrace"]["frames"][0]
        expect(incidentFrame).to have_key('linesBeforeError')
        expect(incidentFrame).to have_key('linesAfterError')
        expect(incidentFrame).to have_key('errorLine')
    end
end