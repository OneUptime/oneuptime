import transformers
from fastapi import FastAPI
from pydantic import BaseModel


# Declare a Pydantic model for the request body
class Prompt(BaseModel):
   prompt: str

model_path = "/app/Models/Meta-Llama-3-8B-Instruct"

pipe = transformers.pipeline("text-generation", model=model_path)

app = FastAPI()

@app.post("/prompt/")
async def create_item(prompt: Prompt):

    # If not prompt then return bad request error
    if not prompt:
        return {"error": "Prompt is required"}

    messages = [
        {"role": "user", "content": "Who are you?"},
    ]

    outputs = pipe(messages)
   

    output = outputs[0]["generated_text"][-1]

    # return prompt response
    return {"response": output}


