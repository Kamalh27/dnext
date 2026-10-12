from google.adk.agents import LlmAgent

from app.agent.prompts import SYSTEM
from app.agent.tools import TOOLS
from app.settings import settings


def build_agent() -> LlmAgent:
    return LlmAgent(name="LandslideAnalyst", model=settings().agent_model, instruction=SYSTEM, tools=TOOLS)

root_agent = build_agent()  # for `adk eval` / `adk web`
