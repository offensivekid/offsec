import asyncio
from typing import List, Dict, Tuple
from pyrogram.errors import FloodWait, Forbidden, Unauthorized
from pyrogram.types import User
from pyrogram.raw.functions.users import GetFullUser
from pyrogram.raw.functions.payments import GetSavedStarGifts
from pyrogram.raw.types import InputUser
import logging

from userbot.client import userbot
from utils.logger import logger

# Здесь будем хранить ID выбранных гифтов для поиска
SELECTED_GIFTS = [] 

async def get_gifts_for_user(user_or_id) -> Tuple[User, List[Dict]]:
    """Получает список подарков (не улучшенных в NFT) пользователя."""
    gifts_data = []
    user = None
    
    try:
        # Получаем данные о пользователе
        if isinstance(user_or_id, (int, str)):
            user = await userbot.get_users(user_or_id)
            peer = await userbot.resolve_peer(user_or_id)
        else:
            user = user_or_id
            from pyrogram.raw.types import InputPeerUser
            if hasattr(user, 'id') and hasattr(user, 'access_hash') and user.access_hash:
                peer = InputPeerUser(user_id=user.id, access_hash=user.access_hash)
            else:
                peer = await userbot.resolve_peer(user.id)
        
        # Вызываем сырой метод API для получения подарков юзера
        raw_gifts_req = GetSavedStarGifts(peer=peer, offset="", limit=100)
        user_gifts_result = await userbot.invoke(raw_gifts_req)
        
        if not hasattr(user_gifts_result, 'gifts'):
            return user, []
            
        for saved_gift in user_gifts_result.gifts:
            gift_name = "Неизвестный подарок"
            is_upgradable = False
            is_nft = False
            
            inner_gift = getattr(saved_gift, 'gift', None)
            if not inner_gift:
                continue
                
            # Проверяем, является ли подарок уже улучшенным (NFT)
            inner_gift_type = getattr(inner_gift, '_', '')
            if inner_gift_type == 'StarGiftUnique' or type(inner_gift).__name__ == 'StarGiftUnique' or hasattr(inner_gift, 'owner_name'):
                is_nft = True
                
            # Проверяем, можно ли его улучшить
            if hasattr(inner_gift, 'upgrade_stars') and getattr(inner_gift, 'upgrade_stars') is not None:
                is_upgradable = True
            elif hasattr(saved_gift, 'can_upgrade') and getattr(saved_gift, 'can_upgrade'):
                is_upgradable = True
            elif hasattr(inner_gift, 'availability_total') and getattr(inner_gift, 'availability_total') is not None:
                # В новой версии Telegram появились лимитированные подарки
                is_upgradable = True
            
            # Извлекаем название
            if hasattr(inner_gift, 'title') and getattr(inner_gift, 'title'):
                gift_name = getattr(inner_gift, 'title')
            elif hasattr(inner_gift, 'sticker') and hasattr(inner_gift.sticker, 'attributes'):
                for attr in inner_gift.sticker.attributes:
                    attr_type = type(attr).__name__
                    if attr_type in ['DocumentAttributeCustomEmoji', 'DocumentAttributeSticker'] and hasattr(attr, 'alt'):
                        gift_name = attr.alt
            
            # В ТЗ: берем только все подарки, которые МОЖНО превратить в NFT, но они еще НЕ NFT.
            if is_upgradable and not is_nft:
                gifts_data.append({
                    "name": gift_name,
                    "count": 1
                })

    except FloodWait as e:
        logger.warning(f"FloodWait: sleeping for {e.value} seconds...")
        await asyncio.sleep(e.value)
    except (Forbidden, Unauthorized) as e:
        logger.error(f"Account block/ban error: {e}")
        from utils.notifier import notify_admin
        await notify_admin(f"С парсером проблема (возможно бан или заморозка).\nПодробности: {e}")
    except Exception as e:
        if user is None:
            user = user_or_id
        logger.error(f"Ошибка при получении подарков пользователя {getattr(user, 'id', user)}: {e}")
        
    return user, gifts_data


def group_gifts(gifts_list: List[Dict]) -> Dict[str, int]:
    """Группирует подарки и считает их количество"""
    grouped = {}
    for g in gifts_list:
        name = g['name']
        grouped[name] = grouped.get(name, 0) + g['count']
    return grouped
