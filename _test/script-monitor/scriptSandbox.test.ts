import { expect } from "chai"
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./scriptSandbox"' has no exported member ... Remove this comment to see the full error message
import { runScript } from "./scriptSandbox"

// @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
describe('ScriptMonitor V2', function(this: $TSFixMe) {
  this.timeout(10000);
  // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'describe'. Do you need to instal... Remove this comment to see the full error message
  describe("runScript function", function(){
    let server: $TSFixMe;
    
    // create a quick express server
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'before'.
    before(function(){
      // @ts-expect-error ts-migrate(1232) FIXME: An import declaration can only be used in a namesp... Remove this comment to see the full error message
      import express from "express"
      const app = express();
      app.get("/test", (req: $TSFixMe, res: $TSFixMe) => res.send("yipee!"));
      server = app.listen(5050);
    });

    // close express server
    // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'after'.
    after(function(){
      server.close();
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should return success for a valid script", async function() {     
      const someFunction = async (done: $TSFixMe) => {
        // make api requests using "axios" or "request"
        const axios = require("axios").default;
        // import request from "request-promise"

        const res = await axios.get("http://localhost:5050/test");
        // const res = await request.get("http://localhost:5050/test");
        console.log("hello");
        console.log("world!");
        
        done();
      }
      
      const result = await runScript(someFunction.toString(), true);      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.true;
      expect(result.status).eq("completed");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
      
      expect(result.consoleLogs.length).eql(2);
      expect(result.consoleLogs).to.include('[log]: hello');
      expect(result.consoleLogs).to.include('[log]: world!');

    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should return false for error thrown in script", async function() {
      const someFunction = async (done: $TSFixMe) => {
        console.log('Error log');
        console.error('Bad Error');
        throw new Error("Bad error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.false;
      expect(result.status).eq("error");
      expect(result.executionTime).to.be.a('number');
      
      console.log(result.executionTime);

      expect(result.consoleLogs.length).eql(2);
      expect(result.consoleLogs).to.include('[error]: Bad Error');
      expect(result.consoleLogs).to.include('[log]: Error log');
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should return scriptMonitor error when script returns a value in cb", async function() {
      const someFunction = async (done: $TSFixMe) => {
        done("Some Error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).to.be.string("Script monitor resource error");
      expect(result.errors).to.be.ok;
      expect(result.status).eq("nonEmptyCallback");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should return timeout error when script takes too long", async function() {
      const someFunction = async (done: $TSFixMe) => {
        return new Promise((resolve) => {
          setTimeout(() => "All timed out", 7000);
        })
      }
      const result = await runScript(someFunction.toString(), true, {maxScriptRunTime: 1500});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. script execution time exceeded");
      expect(result.status).eq("timeout");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });

    // @ts-expect-error ts-migrate(2582) FIXME: Cannot find name 'it'. Do you need to install type... Remove this comment to see the full error message
    it("should return timeout error when statement takes too long", async function() {
      const someFunction = async (done: $TSFixMe) => {
        while(true){
          // statement stuck in loop or too busy
        }
      }
      const result = await runScript(someFunction.toString(), true, {maxSyncStatementDuration: 300});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. synchronous statement execution time exceeded");
      expect(result.status).eq("timeout");
      expect(result.executionTime).to.be.a('number');
      console.log(result.executionTime);
    });
  });
  
});
