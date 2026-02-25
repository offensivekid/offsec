import asyncio
import logging
import os
from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.types import (
    Message, CallbackQuery,
    InlineKeyboardMarkup, InlineKeyboardButton,
    WebAppInfo, FSInputFile
)
from aiogram.filters import CommandStart, Command
from aiogram.enums import ParseMode

# ── CONFIG ──────────────────────────────────────────────────────
BOT_TOKEN  = "8759243252:AAGcMEARFHLaWpFDCghswusg2hbcjnBW9nw"
PORT       = int(os.environ.get("PORT", 8080))
WEBAPP_URL = os.environ.get("WEBAPP_URL", "https://mini-production-be9c.up.railway.app")

# ── ТЕКСТ ПРИВЕТСТВИЯ ────────────────────────────────────────────
WELCOME_TEXT = """
✦ <b>Thin Lucid Agency</b>

Мы строим цифровые продукты — быстро, чисто, без лишнего шума.

<b>Что мы делаем:</b>
┣ 🌐 Сайты и лендинги
┣ ⚙️ Боты и автоматизация
┣ 📱 Мобильные приложения
┗ 🔐 Безопасность и DevOps

Нажми кнопку ниже чтобы узнать больше, оставить заявку или вступить в команду.
"""

# ── КЛАВИАТУРА ────────────────────────────────────────────────────
def main_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🌐 Thin Lucid",
                web_app=WebAppInfo(url=WEBAPP_URL)
            )
        ],
        [
            InlineKeyboardButton(text="📩 Связаться", callback_data="contact"),
            InlineKeyboardButton(text="👥 В команду", callback_data="join"),
        ]
    ])

# ── BOT + DISPATCHER ─────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN, parse_mode=ParseMode.HTML)
dp  = Dispatcher()

# ── /start ────────────────────────────────────────────────────────
@dp.message(CommandStart())
async def cmd_start(message: Message):
    try:
        photo = FSInputFile("banner.jpg")
        await message.answer_photo(
            photo=photo,
            caption=WELCOME_TEXT,
            reply_markup=main_keyboard()
        )
    except Exception:
        await message.answer(
            text=WELCOME_TEXT,
            reply_markup=main_keyboard()
        )

# ── /menu ─────────────────────────────────────────────────────────
@dp.message(Command("menu"))
async def cmd_menu(message: Message):
    await message.answer(
        text="Выбери действие:",
        reply_markup=main_keyboard()
    )

# ── Callbacks ─────────────────────────────────────────────────────
@dp.callback_query(F.data == "contact")
async def cb_contact(callback: CallbackQuery):
    await callback.answer()
    await callback.message.answer(
        text=(
            "📩 <b>Связаться с нами</b>\n\n"
            "Открой приложение и заполни форму «Связаться» — "
            "мы ответим в течение нескольких часов."
        ),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text="📝 Оставить заявку",
                web_app=WebAppInfo(url=WEBAPP_URL + "#contact")
            )
        ]])
    )

@dp.callback_query(F.data == "join")
async def cb_join(callback: CallbackQuery):
    await callback.answer()
    await callback.message.answer(
        text=(
            "👥 <b>Вступить в команду</b>\n\n"
            "Мы всегда ищем талантливых людей.\n"
            "Открой приложение и заполни анкету — "
            "рассмотрим в течение 24 часов."
        ),
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text="🚀 Подать заявку",
                web_app=WebAppInfo(url=WEBAPP_URL + "#join")
            )
        ]])
    )

# ── WEB SERVER (раздаёт index.html) ──────────────────────────────
async def handle_index(request):
    return web.FileResponse("index.html")

async def start_web():
    app = web.Application()
    app.router.add_get("/", handle_index)
    app.router.add_static("/", path=".", show_index=False)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", PORT)
    await site.start()
    logging.info(f"Web started on :{PORT}")

# ── MAIN ─────────────────────────────────────────────────────────
async def main():
    await start_web()
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
