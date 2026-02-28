from aiogram.fsm.state import StatesGroup, State

class BotStates(StatesGroup):
    waiting_for_chat_to_join = State()
    waiting_for_chat_to_parse = State()
    waiting_for_user_to_parse = State()
    waiting_for_filter_name = State()
