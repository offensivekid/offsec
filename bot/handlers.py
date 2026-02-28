from aiogram import Router, F
from aiogram.filters import CommandStart, Command
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from utils.config import ADMIN_IDS
from utils.logger import logger
from userbot.client import userbot
from userbot.services import filter_user_gifts, parse_chat_users
from userbot.parser import SELECTED_GIFTS
from pyrogram.errors import Forbidden, Unauthorized
from utils.notifier import notify_admin
from bot.keyboards import get_main_menu, get_cancel_menu
from bot.states import BotStates

router = Router()

@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext):
    if message.from_user.id not in ADMIN_IDS:
        return await message.answer("У вас нет доступа к этому боту.")
    
    await state.clear()
    await message.answer(
        "👋 <b>Главное меню бота</b>\n\n"
        "Я ищу людей с неулучшенными подарками в чатах.\n"
        "Выберите нужное действие снизу:",
        reply_markup=get_main_menu()
    )

@router.message(Command("menu"))
async def show_menu(message: Message, state: FSMContext):
    if message.from_user.id not in ADMIN_IDS: return
    await state.clear()
    await message.answer("Меню:", reply_markup=get_main_menu())

@router.callback_query(F.data == "menu_cancel")
async def process_cancel(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    await state.clear()
    await callback.message.edit_text("Действие отменено.", reply_markup=get_main_menu())
    await callback.answer()

@router.callback_query(F.data == "menu_join_chat")
async def cb_join_chat(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    await callback.message.edit_text("Отправьте мне ссылку на чат (например: `t.me/chat` или `@username`):", parse_mode="Markdown", reply_markup=get_cancel_menu())
    await state.set_state(BotStates.waiting_for_chat_to_join)
    await callback.answer()

@router.message(BotStates.waiting_for_chat_to_join)
async def state_join_chat(message: Message, state: FSMContext):
    chat_link = message.text.strip()
    msg = await message.answer("⏳ Пытаюсь вступить в чат...")
    try:
        await userbot.join_chat(chat_link)
        await msg.edit_text(f"✅ Парсер успешно вступил в `{chat_link}`!", parse_mode="Markdown")
    except (Forbidden, Unauthorized) as e:
        await notify_admin(f"🚨 Парсер не может вступить в чат!\nОшибка: {e}")
        await msg.edit_text(f"❌ Критическая ошибка доступа или бан парсера!\n{e}")
    except Exception as e:
        await msg.edit_text(f"❌ Ошибка: {e}")
    finally:
        await state.clear()
        await message.answer("Главное меню:", reply_markup=get_main_menu())

@router.callback_query(F.data == "menu_parse_user")
async def cb_parse_user(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    await callback.message.edit_text("Отправьте мне ID пользователя или его @username:", reply_markup=get_cancel_menu())
    await state.set_state(BotStates.waiting_for_user_to_parse)
    await callback.answer()

@router.message(BotStates.waiting_for_user_to_parse)
async def state_parse_user(message: Message, state: FSMContext):
    user_id = message.text.strip()
    if user_id.isdigit(): user_id = int(user_id)
    
    msg = await message.answer(f"⏳ Собираю подарки пользователя {user_id}...")
    try:
        result_text = await filter_user_gifts(user_id)
        if result_text:
            text = f"<b>Результат:</b>\n\n{result_text}"
            if len(text) > 4000: text = text[:4000] + "..."
            await msg.edit_text(text)
        else:
            await msg.edit_text("❌ У пользователя не найдено (подходящих) подарков или профиль скрыт.")
    except Exception as e:
        await msg.edit_text(f"❌ Ошибка парсинга: {e}")
    finally:
        await state.clear()
        await message.answer("Главное меню:", reply_markup=get_main_menu())

@router.callback_query(F.data == "menu_parse_chat")
async def cb_parse_chat(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    await callback.message.edit_text("Введи @username чата (или его ID `например -100XXXX`):\n⚠️ Внимание! Парсер УЖЕ должен состоять в этом чате.", parse_mode="Markdown", reply_markup=get_cancel_menu())
    await state.set_state(BotStates.waiting_for_chat_to_parse)
    await callback.answer()

@router.message(BotStates.waiting_for_chat_to_parse)
async def state_parse_chat(message: Message, state: FSMContext):
    chat_id = message.text.strip()
    if chat_id.isdigit() or chat_id.startswith("-100"): 
        chat_id = int(chat_id)
        
    msg = await message.answer(f"⏳ Начинаю парсинг чата <code>{chat_id}</code>...\nЭто займет некоторое время.")
    
    results = await parse_chat_users(chat_id, limit_users=20)
    
    if not results:
        await msg.edit_text("❌ В чате не найдено пользователей с подходящими подарками, либо список скрыт.")
    else:
        await msg.delete()
        chunk = ""
        count = 0
        for res in results:
             count += 1
             addition = f"{res}\n{'-'*30}\n"
             if len(chunk) + len(addition) > 4000:
                  await message.answer(chunk)
                  chunk = addition
             else:
                  chunk += addition
                  
        if chunk:
            await message.answer(chunk)
            
        await message.answer(f"✅ Парсинг завершен. Найдено пользователей: {count}.")
        
    await state.clear()
    await message.answer("Главное меню:", reply_markup=get_main_menu())

@router.callback_query(F.data == "menu_add_filter")
async def cb_add_filter(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    await callback.message.edit_text("Напишите точное или частичное название подарка для фильтра (например `Пасхальный`):", reply_markup=get_cancel_menu())
    await state.set_state(BotStates.waiting_for_filter_name)
    await callback.answer()

@router.message(BotStates.waiting_for_filter_name)
async def state_add_filter(message: Message, state: FSMContext):
    gift_name = message.text.strip()
    SELECTED_GIFTS.append(gift_name)
    await state.clear()
    await message.answer(f"✅ Фильтр <b>{gift_name}</b> добавлен!\nТекущие фильтры: {', '.join(SELECTED_GIFTS)}", reply_markup=get_main_menu())

@router.callback_query(F.data == "menu_clear_filters")
async def cb_clear_filters(callback: CallbackQuery, state: FSMContext):
    if callback.from_user.id not in ADMIN_IDS: return
    SELECTED_GIFTS.clear()
    await callback.message.edit_text("✅ Фильтры очищены. Теперь парсим ВСЕ неулучшенные подарки.", reply_markup=get_main_menu())
    await callback.answer()

@router.callback_query(F.data == "menu_list_filters")
async def cb_list_filters(callback: CallbackQuery):
    if callback.from_user.id not in ADMIN_IDS: return
    if not SELECTED_GIFTS:
        text = "ℹ️ Фильтры не установлены. Парсятся все подарки."
    else:
        text = f"📋 <b>Текущие фильтры:</b>\n\n" + "\n".join([f"• {f}" for f in SELECTED_GIFTS])
        
    await callback.message.edit_text(text, reply_markup=get_main_menu())
    await callback.answer()
