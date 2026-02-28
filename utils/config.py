import os
from dotenv import load_dotenv

load_dotenv()

API_ID = os.getenv("API_ID")
API_HASH = os.getenv("API_HASH")
BOT_TOKEN = os.getenv("BOT_TOKEN")
_admin_id_raw = os.getenv("ADMIN_ID", "")

ADMIN_IDS = []
for _id in _admin_id_raw.split(","):
    _id = _id.strip()
    if _id.lstrip("-").isdigit():
        ADMIN_IDS.append(int(_id))

# Для совместимости
ADMIN_ID = ADMIN_IDS[0] if ADMIN_IDS else 0
