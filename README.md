# Signal Clone - Secure Messaging Platform

A fully functional clone of the Signal messenger client built as a fullstack application. It matches Signal's minimal, dark-first privacy-focused design language, incorporating real-time text messaging, typing indicators, read receipts, group conversation controls, attachments, quoted replies, emoji reactions, and functional disappearing messages.

---

## 🛠 Tech Stack

- **Frontend:** Next.js 14 (TypeScript, App Router, Client-side Auth Context, native HTML5 WebSockets, Vanilla CSS variables matching Signal's design token set)
- **Backend:** Python 3.11 (FastAPI, native WebSockets API)
- **Database:** SQLite (SQLAlchemy ORM)
- **Authentication:** JWT (JSON Web Tokens) with a mocked OTP flow for testing
- **Real-time Engine:** Native WebSockets connection with room/conversation routing and broadcast presence support

---

## 📂 Project Structure

```
/
├── backend/            # Python FastAPI app
│   ├── app/
│   │   ├── routes/     # Router definitions (auth, messages, chats, etc.)
│   │   ├── auth.py     # JWT & oauth2 dependency
│   │   ├── database.py # SQLAlchemy session & engine setup
│   │   ├── models.py   # SQLAlchemy model schemas
│   │   ├── schemas.py  # Pydantic schemas for serialization
│   │   ├── websocket.py# WebSockets connection manager
│   │   └── seed.py     # Script to pre-populate mock data
│   ├── static/         # Uploaded attachments storage
│   ├── run.py          # FastAPI dev server runner
│   └── requirements.txt# Python dependencies
│
└── frontend/           # Next.js app
    ├── app/
    │   ├── login/      # Phone entry view
    │   ├── verify/     # OTP verification view
    │   ├── register/   # Profile onboarding view
    │   ├── api.ts      # REST endpoints wrapper
    │   ├── AuthContext.tsx # Authentication persistence state
    │   ├── ClientLayout.tsx# Theme and global loaders layout
    │   ├── globals.css # CSS styling tokens and theme colors
    │   ├── layout.tsx  # Next.js layout bootstrap
    │   └── page.tsx    # Dashboard core panel (chat list, message feed)
    └── package.json
```

---

## 🚀 Setup & Installation

### Backend Setup

1. **Navigate to the backend folder**:
   ```bash
   cd backend
   ```
2. **Create a virtual environment**:
   ```bash
   python -m venv venv
   ```
3. **Activate the virtual environment**:
   - On Windows (PowerShell):
     ```powershell
     .\venv\Scripts\Activate.ps1
     ```
   - On Mac/Linux:
     ```bash
     source venv/bin/activate
     ```
4. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```
5. **Seed the database**:
   This generates multiple users, chat rooms, and a rich direct and group message history.
   ```bash
   python -m app.seed
   ```
6. **Run the API server**:
   Starts the FastAPI server on `http://localhost:8000`.
   ```bash
   python run.py
   ```

### Frontend Setup

1. **Navigate to the frontend folder**:
   ```bash
   cd ../frontend
   ```
2. **Install npm dependencies**:
   ```bash
   npm install
   ```
3. **Run the Next.js dev server**:
   Starts the React client on `http://localhost:3000`.
   ```bash
   npm run dev
   ```

---

## 💾 Database Schema

The database is built on a normalized SQLite schema using SQLAlchemy ORM models:

```mermaid
erDiagram
    USERS {
        int id PK
        string phone UNIQUE
        string display_name
        string avatar
        string last_seen
        boolean is_online
        datetime created_at
    }
    CONTACTS {
        int user_id PK, FK
        int contact_user_id PK, FK
        datetime created_at
    }
    CONVERSATIONS {
        int id PK
        string name
        boolean is_group
        string avatar
        int created_by FK
        datetime created_at
    }
    CONVERSATION_MEMBERS {
        int conversation_id PK, FK
        int user_id PK, FK
        boolean is_admin
        datetime joined_at
    }
    MESSAGES {
        int id PK
        int conversation_id FK
        int sender_id FK
        string content
        string message_type
        string attachment_path
        string attachment_name
        int reply_to_id FK
        int disappear_after
        datetime created_at
    }
    MESSAGE_STATUS {
        int message_id PK, FK
        int user_id PK, FK
        string status "sending/sent/delivered/read"
        datetime updated_at
    }
    REACTIONS {
        int id PK
        int message_id FK
        int user_id FK
        string emoji
        datetime created_at
    }

    USERS ||--o{ CONTACTS : "has contact"
    USERS ||--o{ CONVERSATION_MEMBERS : "member of"
    CONVERSATIONS ||--o{ CONVERSATION_MEMBERS : "has members"
    CONVERSATIONS ||--o{ MESSAGES : "has messages"
    USERS ||--o{ MESSAGES : "sends"
    MESSAGES ||--o| MESSAGES : "replies to"
    MESSAGES ||--o{ MESSAGE_STATUS : "has status"
    USERS ||--o{ MESSAGE_STATUS : "updates status"
    MESSAGES ||--o{ REACTIONS : "has reactions"
    USERS ||--o{ REACTIONS : "reacts with"
```

---

## 📡 API Overview & WebSocket Events

### REST Endpoints
- **Auth:**
  - `POST /api/auth/login-check` - Check phone registration status.
  - `POST /api/auth/register` - Create profile details (name, avatar).
  - `POST /api/auth/verify` - Verify OTP and return JWT token.
- **Users & Contacts:**
  - `GET /api/users/me` - Retrieve logged in user's profile.
  - `PUT /api/users/me` - Update display name & avatar.
  - `GET /api/users/search` - Search users by name/phone.
  - `GET /api/contacts` - Get contact list.
  - `POST /api/contacts` - Add a contact by phone.
- **Conversations:**
  - `GET /api/conversations` - Retrieve all conversations.
  - `POST /api/conversations` - Create direct or group chat.
  - `GET /api/conversations/{id}` - Details of a single conversation.
  - `PUT /api/conversations/{id}` - Update group details.
  - `POST /api/conversations/{id}/members` - Add members to group.
  - `DELETE /api/conversations/{id}/members/{user_id}` - Leave or remove member.
- **Messages:**
  - `GET /api/messages/{conversation_id}` - Paginated chat history (marks messages as read).
  - `POST /api/messages` - Send a text message.
  - `POST /api/messages/attachment` - Upload a file/image attachment.
  - `POST /api/messages/react` - Add emoji reaction.
  - `DELETE /api/messages/react/{id}` - Remove emoji reaction.

### WebSocket Events
The client connects to `ws://localhost:8000/api/ws?token=<jwt_token>`.
- **Received by Server:**
  - `typing` event - `{"event_type": "typing", "conversation_id": int, "is_typing": bool}`
- **Dispatched to Client:**
  - `message_new` - Dispatches new message details to conversation members.
  - `messages_read` - Dispatches read indicator updates (status tick updates).
  - `typing` - Live typing indicators.
  - `user_status` - Live user presence update (online/offline/last seen).
  - `reaction_new` / `reaction_delete` - Live emoji reaction updates.
  - `conversation_new` - Notifies members when added to a new chat.

---

## 🔒 Assumptions & Mocked Features

1. **Authentication OTP:** A mock verification flow is used. Any valid phone number can login; entering OTP code `123456` will succeed.
2. **Encryption:** End-to-end cryptographic keys exchange is simulated (shows "This chat is end-to-end encrypted" banner, without actual cryptography).
3. **Calls & Stories:** Features like Voice/Video calling buttons and Stories in settings are present as visual placeholders (click opens a "Coming Soon" toast/info tooltip).
4. **Disappearing Messages:** Functional. When disappearing messages is set for a chat, a countdown starts when the message is read. Once the timer reaches 0, the message vanishes from the client view and is cleaned from the database on subsequent loads.

---

## 🧪 Demo Users & Credentials

To test real-time features (typing, live status, instant messages, and ticks), open **two separate browser sessions** (e.g. standard and incognito) and log in with the following seeded credentials:

- **User 1:**
  - **Phone:** `+12065550100` (Alice Smith)
  - **OTP Code:** `123456`
- **User 2:**
  - **Phone:** `+12065550101` (Bob Jones)
  - **OTP Code:** `123456`
- **User 3:**
  - **Phone:** `+12065550102` (Charlie Brown)
  - **OTP Code:** `123456`
- **User 4:**
  - **Phone:** `+12065550103` (Diana Prince)
  - **OTP Code:** `123456`
