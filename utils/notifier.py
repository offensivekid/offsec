
from utils.config import ADMIN_IDS
from utils.logger import logger

async def notify_admin(message: str):
    """Отправляет уведомление администраторам бота."""
    from bot.bot_setup import bot
    for admin_id in ADMIN_IDS:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text=f"🚨 <b>СИСТЕМНОЕ УВЕДОМЛЕНИЕ</b>\n\n{message}"
            )
        except Exception as e:
            logger.error(f"Не удалось отправить уведомление админу {admin_id}: {e}")
