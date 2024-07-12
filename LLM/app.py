import uuid
import transformers
import asyncio
import os
import torch
import aiohttp
from fastapi import FastAPI
from pydantic import BaseModel
from contextlib import asynccontextmanager
from apscheduler.schedulers.background import BackgroundScheduler

# ENV VARS
ONEUPTIME_URL = os.getenv("ONEUPTIME_URL")

if not ONEUPTIME_URL:
    ONEUPTIME_URL = "https://oneuptime.com"

print(f"ONEUPTIME_URL: {ONEUPTIME_URL}")

# TODO: Store this in redis down the line. 
items_pending = {}
items_processed = {}
errors = {}

async def validateSecretKey(secretKey):
    try:

        # If no secret key then return false 
        if not secretKey:
            return False

        async with aiohttp.ClientSession() as session:
            print(f"Validating secret key")
            url = f"{ONEUPTIME_URL}/api/copilot-code-repository/is-valid/{secretKey}"
            async with session.get(url) as response:
                print(response)
                if response.status == 200:
                    return True
                else:
                    return False
                
    except Exception as e:
        print(repr(e))
        return False

async def job(queue):
    print("Processing queue...")

    model_path = "/app/Models/Meta-Llama-3-8B-Instruct"

    pipe = transformers.pipeline(
        "text-generation", 
        model=model_path,
        # use gpu if available
        device="cuda" if torch.cuda.is_available() else "cpu",
        # max_new_tokens=8096
        )

    while True:

        random_id = None

        try:
            # process this item.
            random_id = await queue.get()
            print(f"Processing item {random_id}")
            messages = items_pending[random_id]
            print(f"Messages:")
            print(messages)
            outputs = pipe(messages)
            items_processed[random_id] = outputs
            del items_pending[random_id]
            print(f"Processed item {random_id}")
        except Exception as e:
            print(f"Error processing item {random_id}")
            # store error
            errors[random_id] = repr(e)
            # delete from items_pending
            if random_id in items_pending:
                del items_pending[random_id]
            print(e)

       


@asynccontextmanager
async def lifespan(app:FastAPI):
    queue = asyncio.Queue()
    app.model_queue = queue
    asyncio.create_task(job(queue))
    yield

# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   messages: list
   # secretkey: str

# Declare a Pydantic model for the request body
class PromptResult(BaseModel):
   id: str
   # secretkey: str

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
     return {"status": "ok"}

@app.get("/status")
async def status():
     return {"status": "ok"}

@app.post("/prompt/")
async def create_item(prompt: Prompt):

    try:
        # If not prompt then return bad request error
        if not prompt:
            return {"error": "Prompt is required"}
        
        # Validate the secret key
        # is_valid = await validateSecretKey(prompt.secretkey)

        # if not is_valid:
        #     print("Invalid secret key")
        #     return {"error": "Invalid secret key"}
        
        # messages are in str format. We need to convert them fron json [] to list
        messages = prompt.messages

        # Log prompt to console
        print(messages)

        # Generate UUID
        random_id = str(uuid.uuid4())

        # add to queue

        items_pending[random_id] = messages
        await app.model_queue.put(random_id)

        # Return response
        return {
            "id": random_id,
            "status": "queued"
        }
    except Exception as e:
        print(e)
        return {"error": repr(e)}

# Disable this API in production
@app.get("/queue-status/")
async def queue_status():
    try: 
        return {"pending": items_pending, "processed": items_processed, "queue": app.model_queue.qsize(), "errors": errors}
    except Exception as e:
        print(e)
        return {"error": repr(e)}

@app.post("/prompt-result/")
async def prompt_status(prompt_status: PromptResult):
    try:
        # Log prompt status to console
        print(prompt_status)

        # Validate the secret key
        # is_valid = await validateSecretKey(prompt_status.secretkey)

        # if not is_valid:
        #     print("Invalid secret key")
        #     return {"error": "Invalid secret key"}
        
        # If not prompt status then return bad request error
        if not prompt_status:
            return {"error": "Prompt status is required"}
    
        # check if item is processed. 
        if prompt_status.id in items_processed:

           
            return_value =  {
                "id": prompt_status.id,
                "status": "processed",
                "output": items_processed[prompt_status.id]
            }

            # delete from item_processed
            del items_processed[prompt_status.id]

            return return_value
        else:

            status = "not found" 

            if prompt_status.id in items_pending:
                status = "pending"

            return {
                "id": prompt_status.id,
                "status": status
            }
    except Exception as e:
        print(e)
        return {"error": repr(e)}




