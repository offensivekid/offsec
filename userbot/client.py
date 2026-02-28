from pyrogram import Client
from utils.config import API_ID, API_HASH

# Создаем клиента Pyrogram (Userbot) для парсинга
# Добавлены параметры устройства, так как Telegram начал блокировать 
# дефолтные сессии библиотек (отсюда и непрерывные отключения)
userbot = Client(
    "parser_session",
    api_id=API_ID,
    api_hash=API_HASH,
    device_model="PC Desktop",
    system_version="Windows 11",
    app_version="4.14.9",
    lang_code="ru",
    ipv6=False
)
