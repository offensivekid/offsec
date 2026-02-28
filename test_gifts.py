import asyncio
import sys
from pyrogram import Client
from pyrogram.raw.functions.payments import GetSavedStarGifts
from userbot.client import userbot

async def main():
    await userbot.start()
    try:
        user = await userbot.get_users("POH_093")
        peer = await userbot.resolve_peer(user.id)
        raw_gifts_req = GetSavedStarGifts(peer=peer, offset="", limit=10)
        user_gifts_result = await userbot.invoke(raw_gifts_req)
        
        for saved_gift in getattr(user_gifts_result, 'gifts', []):
            inner_gift = getattr(saved_gift, 'gift', None)
            
            print("\n=== FULL GIFT STRUCT ===")
            if hasattr(inner_gift, '__dict__'):
                for k, v in vars(inner_gift).items():
                    print(f"{k}: {v}")
            else:
                print(inner_gift)
                
            if hasattr(inner_gift, 'sticker') and inner_gift.sticker:
                print("--- Sticker Info ---")
                if hasattr(inner_gift.sticker, '__dict__'):
                     for k, v in vars(inner_gift.sticker).items():
                          print(f"Sticker {k}: {v}")
                     if hasattr(inner_gift.sticker, 'attributes'):
                          for attr in inner_gift.sticker.attributes:
                               print(f"Attr: {type(attr).__name__} -> {vars(attr) if hasattr(attr, '__dict__') else attr}")
    except Exception as e:
        print("Error:", e)
    finally:
        try:
            await userbot.stop()
        except: pass

if __name__ == "__main__":
    asyncio.run(main())
