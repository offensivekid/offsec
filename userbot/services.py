from pyrogram.errors import UsernameInvalid, UsernameNotOccupied, Forbidden, Unauthorized

from userbot.client import userbot
from userbot.parser import get_gifts_for_user, group_gifts, SELECTED_GIFTS
from utils.logger import logger

async def filter_user_gifts(user_or_id):
    """Спарсить подарки одного юзера и вернуть отформатированный текст"""
    user, gifts = await get_gifts_for_user(user_or_id)
    
    if not isinstance(user, type(None)) and getattr(user, 'id', None) is None:
        pass # fallback
        
    if not gifts:
        return None
        
    grouped = group_gifts(gifts)
    
    # Фильтрация (оставляем только если есть подарки из SELECTED_GIFTS, или если фильтр пуст - берем все)
    filtered_gifts = {}
    for name, count in grouped.items():
        if not SELECTED_GIFTS or any(f.lower() in name.lower() for f in SELECTED_GIFTS):
            filtered_gifts[name] = count
            
    if not filtered_gifts:
         return None

    # Форматируем текст
    username_text = f"(@{getattr(user, 'username', '')})" if getattr(user, 'username', None) else ""
    text = f"👤 Владелец: {getattr(user, 'id', user)} {username_text}\n\n"
    
    for name, count in filtered_gifts.items():
        text += f"🎁 Название: {name} (x{count})\n"
        
    return text

async def parse_chat_users(chat_id: str | int, limit_users: int = 20):
    """Спарсить юзеров чата, проверить их подарки и вернуть список (макс 20)."""
    results = []
    
    try:
        # Если передан username, получаем int ID
        try:
             chat = await userbot.get_chat(chat_id)
             chat_identifier = chat.id
        except Exception:
             chat_identifier = chat_id
             
        # Пытаемся получить участников через историю сообщений, чтобы обойти скрытые списки
        seen_users = set()
        users_processed = 0
        
        # Получаем последние 3000 сообщений в чате (исключаем повторы)
        logger.info(f"Начинаем сбор сообщений из чата {chat_identifier} (до 3000 сообщений)...")
        messages_processed = 0
        async for message in userbot.get_chat_history(chat_identifier, limit=3000):
             messages_processed += 1
             if messages_processed % 100 == 0:
                 logger.info(f"Обработано сообщений: {messages_processed}. Проверено уник. юзеров: {users_processed}. Найдено: {len(results)}")
             if len(results) >= limit_users:
                 break
                 
             # Если сообщение отправлено от имени канала или анонимного админа
             if not message.from_user:
                 continue
                 
             user_id = message.from_user.id
             
             # Пропускаем, если уже проверяли этого человека
             if user_id in seen_users:
                 continue
                 
             seen_users.add(user_id)
             
             if message.from_user.is_bot or message.from_user.is_deleted:
                 continue
                 
             try:
                 user_text = await filter_user_gifts(message.from_user)
                 if user_text:
                     results.append(user_text)
             except Exception as e:
                 logger.error(f"Ошибка парсинга {user_id}: {e}")
                 
             users_processed += 1
             logger.info(f"Проверен юзер {user_id}. Пауза 0.5с... (найдено {len(results)})")
             
             # Небольшая пауза, чтобы не словить лимиты Telegram
             import asyncio
             await asyncio.sleep(0.5)

    except (Forbidden, Unauthorized) as e:
        logger.error(f"Account restricted/banned during chat parsing: {e}")
        from utils.notifier import notify_admin
        await notify_admin(f"🚨 Парсер столкнулся с блокировкой при сборе участников чата <code>{chat_id}</code>!\n\nОшибка: {e}")
        return [f"❌ Критическая ошибка доступа или бан парсера: {e}"]
    except Exception as e:
        logger.error(f"Ошибка при парсинге чата {chat_id}: {e}")
        return [f"❌ Произошла ошибка при доступе к чату: {e}"]
        
    return results
