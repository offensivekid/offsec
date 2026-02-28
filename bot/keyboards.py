from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton

def get_main_menu() -> InlineKeyboardMarkup:
    """Главная клавиатура бота."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Спарсить группу", callback_data="menu_parse_chat"),
                InlineKeyboardButton(text="👤 Проверить юзера", callback_data="menu_parse_user")
            ],
            [
                InlineKeyboardButton(text="🚪 Зайти в чат", callback_data="menu_join_chat")
            ],
            [
                InlineKeyboardButton(text="➕ Добавить фильтр", callback_data="menu_add_filter"),
                InlineKeyboardButton(text="📋 Мои фильтры", callback_data="menu_list_filters")
            ],
            [
                InlineKeyboardButton(text="🗑 Очистить фильтры", callback_data="menu_clear_filters")
            ]
        ]
    )

def get_cancel_menu() -> InlineKeyboardMarkup:
    """Клавиатура для отмены текущего действия."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="❌ Отмена", callback_data="menu_cancel")]
        ]
    )
