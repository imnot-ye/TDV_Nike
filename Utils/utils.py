import json
import subprocess
import os
from typing import Dict, Optional, List
from urllib.parse import urlparse

CONFIG_FILE = 'config.json'
WEBHOOKS_FILE = 'Data/webhooks.json'

def load_webhooks() -> Dict:
    try:
        with open(WEBHOOKS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_webhooks(data: Dict):
    with open(WEBHOOKS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

def add_webhook_to_file(site: str, url: str, match_kw: Optional[List[str]] = None) -> int:
    webhooks = load_webhooks()
    site = site.lower()
    
    if site not in webhooks:
        webhooks[site] = []
        
    max_id = 0
    for s, hooks in webhooks.items():
        for hook in hooks:
            if hook["id"] > max_id:
                max_id = hook["id"]
                
    new_id = max_id + 1
    
    webhooks[site].append({
        "id": new_id,
        "url": url,
        "match_kw": match_kw
    })
    
    save_webhooks(webhooks)
    return new_id

def delete_webhook_from_file(webhook_id: int) -> bool:
    webhooks = load_webhooks()
    found = False
    
    for site in list(webhooks.keys()):
        original_len = len(webhooks[site])
        webhooks[site] = [w for w in webhooks[site] if w["id"] != webhook_id]
        if len(webhooks[site]) < original_len:
            found = True
            if not webhooks[site]:
                del webhooks[site]
            break
            
    if found:
        save_webhooks(webhooks)
        
    return found

def load_config() -> Dict:
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {"targets": [], "proxy_file": "Data/proxies.txt"}

def save_config(data: Dict):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

def generate_unique_id(config: Dict) -> str:
    if not config["targets"]:
        return "0"
    existing_ids: List[int] = []
    for target in config.get("targets", []):
        raw = target.get("Id")
        try:
            existing_ids.append(int(raw))
        except (TypeError, ValueError):
            # Ignore non-numeric IDs like "test_1"
            continue
    new_id = (max(existing_ids) + 1) if existing_ids else 0
    return str(new_id)

def get_target_url(target_id: str) -> Optional[str]:
    config = load_config()
    target = next((target for target in config["targets"] if target["Id"] == target_id), None)
    return target["url"] if target else None

def get_site_name(url: str) -> Optional[str]: 
    try:
        parsed_url = urlparse(url)
        domain = parsed_url.netloc
        if domain.startswith('www.'):
            domain = domain[4:]
        return domain.split('.')[0]
    except Exception as e:
        print(f"Error parsing URL for site name: {e}")
        return None

def add_target(config: Dict, site: str, url: str, monitor_delay: int = 3, success_delay: int = 60, error_timeout: int = 60, max_price: int = None):
    new_id = generate_unique_id(config)
    if site.lower() == "shopify" and monitor_delay == 3:
        monitor_delay = 1
    new_target = {
        "Id": new_id,
        "site": site.upper(),
        "url": url,
        "monitor_delay": monitor_delay,
        "success_delay": success_delay,
        "error_timeout": error_timeout
    }
    if max_price is not None:
        new_target["maxPriceEur"] = max_price
    
    config["targets"].append(new_target)
    save_config(config)

def remove_target(config: Dict, target_id: str):
    config["targets"] = [target for target in config["targets"] if target["Id"] != target_id]
    print(config)
    save_config(config)

def get_pm2_process_names() -> List[str]:
    try:
        result = subprocess.run(
            ['pm2', 'jlist'],
            check=True,
            text=True,
            capture_output=True,
            encoding='utf-8'
        )
        processes = json.loads(result.stdout)
        return [p['name'] for p in processes]
    except (subprocess.CalledProcessError, json.JSONDecodeError):
        return []

def start_monitor(script_name: str):
    script_path = os.path.join(os.getcwd(), f"{script_name}.js")
    
    if os.path.isfile(script_path):
        try:
            result = subprocess.run(
                ['pm2', 'start', f'{script_name}.js', '--name', script_name],
                check=True,
                text=True,
                capture_output=True,
                encoding='utf-8'
            )
            print(f"Monitor '{script_name}.js' avviato con successo.")
        except subprocess.CalledProcessError as e:
            print(f"Errore durante l'avvio di '{script_name}.js': {e.stderr}")
    else:
        print(f"File '{script_name}.js' non trovato. Avvio come istanza Shopify dedicata...")
        try:
            result = subprocess.run(
                ['pm2', 'start', 'shopify.js', '--name', script_name, '--', f'--site={script_name}'],
                check=True,
                text=True,
                capture_output=True,
                encoding='utf-8'
            )
            print(f"Monitor Shopify '{script_name}' avviato con successo.")
        except subprocess.CalledProcessError as e:
            print(f"Errore durante l'avvio del monitor Shopify '{script_name}': {e.stderr}")

def stop_monitor(script_name: str):
    try:
        result = subprocess.run(f'pm2 stop "{script_name}"', check=True, text=True, capture_output=True, shell=True,encoding='utf-8')
    except subprocess.CalledProcessError as e:
        print(f"Errore durante l'arresto di '{script_name}': {e.stderr}")

def restart_monitor(script_name: str):
    try:
        result = subprocess.run(f'pm2 restart "{script_name}"', check=True, text=True, capture_output=True, shell=True,encoding='utf-8')
    except subprocess.CalledProcessError as e:
        print(f"Errore durante il riavvio di '{script_name}': {e.stderr}")

def load_modules():
    try:
        with open("modules.txt", "r") as file:
            modules = [line.strip() for line in file if line.strip()]
        return modules
    except FileNotFoundError:
        print("Errore: Il file 'modules.txt' non è stato trovato.")
        return []

def start_all_monitors():
    config = load_config()
    sites_with_targets = set(target["site"].lower() for target in config["targets"])
    loaded_monitors = get_pm2_process_names()
    for site in sites_with_targets:
        if site.lower() not in loaded_monitors:
            if site.lower() == "sephora":
                start_monitor("sephoraInstore")
            start_monitor(site.lower())
