# 🎬 JellyTime

**Screen time manager for Jellyfin with chore-based rewards.**

JellyTime sits alongside your Jellyfin server and:
- Tracks **actual video playback time** (not just login time)
- **Disables Jellyfin accounts** when the daily limit is hit
- Lets kids **earn bonus time by completing chores**
- Supports **auto-approval** (honor system) or **manual parent approval** per chore
- **Re-enables accounts automatically at midnight** for a new day

---

## 🚀 Quick Start

### 1. Prerequisites
- Docker + Docker Compose installed
- A running Jellyfin server
- A Jellyfin API key (Jellyfin → Dashboard → API Keys → click **+**)

### 2. Clone / Download

```bash
git clone <this-repo> jellytime
cd jellytime
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3000
JWT_SECRET=your-random-secret-here   # generate with: openssl rand -hex 32
```

### 4. Build and Run

```bash
docker compose up -d --build
```

First build takes ~2–3 minutes (React compile + npm installs).

### 5. Open the app

Navigate to `http://YOUR-SERVER-IP:3000`

You'll be guided through:
1. Creating a **parent account** (username + password)
2. Entering your **Jellyfin URL and API key**
3. Adding your kids and linking them to Jellyfin accounts
4. Setting up chores

---

## 📱 Mobile App (PWA)

JellyTime is a **Progressive Web App**. On mobile:

**iPhone/iPad**: Open in Safari → Share → "Add to Home Screen"  
**Android**: Open in Chrome → Menu → "Add to Home Screen" / "Install App"

This gives you a full-screen icon on the home screen — no app store needed.

---

## 🧹 Chores Setup

After logging in as a parent, go to **Chores** to manage the chore library.

Each chore has:
- **Name & Icon** — shown to kids
- **Reward minutes** — how much time they earn
- **Auto-approve** — grants time instantly (honor system). Leave off to require your approval.

### Auto-approve vs Manual

| | Auto-approve ⚡ | Manual 👀 |
|---|---|---|
| Time granted | Instantly when child submits | After you approve in the app |
| Best for | Easy, observable chores (make bed, feed pets) | Bigger chores you want to verify |

---

## 👧 How kids use it

1. Open `http://YOUR-SERVER-IP:3000` on their device
2. Tap **"I'm a kid"** → select their name
3. See remaining screen time on the big circle timer
4. Tap **"Do chores, earn time"** to submit completed chores
5. Auto-approved chores add time immediately; others show as pending

When time runs out, Jellyfin disables their account — they can't log back in until a parent grants time or it resets at midnight.

---

## ⚙️ Architecture

```
Browser/App
    │
    ▼
frontend (React PWA, nginx)     :3000
    │  /api/* proxied to →
    ▼
backend (Node.js, Express)      :3001
    │
    ├── SQLite (persistent data)
    │
    └── Jellyfin API (every 30s)
            ├── GET /Sessions   (who's watching?)
            └── POST /Users/{id}/Policy   (enable/disable)
```

**Data stored locally** in a Docker volume (`jellytime-data`). No cloud, no external services.

---

## 🔧 Troubleshooting

**"Cannot connect to Jellyfin"**  
Make sure the URL is reachable from inside Docker. Use your server's LAN IP, not `localhost`.  
Example: `http://192.168.1.50:8096`

**Kids aren't being tracked**  
- Confirm the child's Jellyfin user is linked in Settings → Kids
- Check that the Jellyfin API key has read/write user permissions
- Look at backend logs: `docker compose logs backend -f`

**Account not re-enabling**  
The midnight reset checks at exactly 00:00. You can manually grant time from the parent dashboard.

---

## 📂 Data & Backup

All data lives in the `jellytime-data` Docker volume.

```bash
# Backup
docker run --rm -v jellytime_jellytime-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/jellytime-backup.tar.gz /data

# Restore
docker run --rm -v jellytime_jellytime-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/jellytime-backup.tar.gz -C /
```

---

## 🔒 Security Notes

- The parent dashboard requires login. Kids access their profile without a password (by design — the "lock" is Jellyfin itself).
- Change `JWT_SECRET` in `.env` before exposing to the internet.
- If exposing externally, put behind a reverse proxy (Nginx/Traefik) with HTTPS.
