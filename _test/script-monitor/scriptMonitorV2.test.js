const { expect } = require("chai");
const { runScript } = require("./scriptMonitorV2");

describe('ScriptMonitor V2', function() {
  this.timeout(10000);
  describe("runScript function", function(){
    let server;
    
    // create a quick express server
    before(function(){
      const express = require("express");
      const app = express();
      app.get("/test", (req, res) => res.send("yipee!"));
      server = app.listen(5050);
    });

    // close express server
    after(function(){
      server.close();
    });

    it("should return success for a valid script", async function() {     
      const someFunction = async (done) => {
        // make api requests using "axios" or "request"
        const axios = require("axios").default;
        // const request = require("request-promise");

        const res = await axios.get("http://localhost:5050/test");
        // const res = await request.get("http://localhost:5050/test");
        
        done();
      }
      
      const result = await runScript(someFunction.toString(), true);      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.true;

    });

    it("should return false for error thrown in script", async function() {
      const someFunction = async (done) => {
        throw new Error("Bad error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.not.be.undefined;
      expect(result.success).to.be.false;
    });

    it("should return scriptMonitor error when script returns a value in cb", async function() {
      const someFunction = async (done) => {
        done("Some Error");
      }
      const result = await runScript(someFunction.toString(), true);
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).to.be.string("Script monitor resource error");
      expect(result.errors).to.be.ok;
    });

    it("should return timeout error when script takes too long", async function() {
      const someFunction = async (done) => {
        return new Promise((resolve) => {
          setTimeout(() => "All timed out", 7000);
        })
      }
      const result = await runScript(someFunction.toString(), true, {maxScriptRunTime: 1500});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. script execution time exceeded");
    });

    it("should return timeout error when statement takes too long", async function() {
      const someFunction = async (done) => {
        while(true){
          // statement stuck in loop or too busy
        }
      }
      const result = await runScript(someFunction.toString(), true, {maxSyncStatementDuration: 300});
      
      expect(result).to.be.ok;
      expect(result.success).to.be.false;
      expect(result.message).contains("Max. synchronous statement execution time exceeded");
    });
  });
  
});
