from fastapi import APIRouter, Body
router = APIRouter(prefix="/api", tags=["echo"])

@router.post("/echo")
async def echo(body: dict = Body(...)):
    return {"status": "completed", "result": body, "message": "Task processed by broker agent"}
