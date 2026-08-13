from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from datetime import datetime
import asyncio
import logging

from .database import engine, Base, SessionLocal
from .models import User, Contact, ConversationMember
from .auth import get_current_user_from_token
from .websocket import manager
from .routes import auth, users, conversations, messages, contacts

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Signal Clone API", version="1.0.0")

# CORS middleware to allow nextjs client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve attachments and avatars statically
#app.mount("/static", StaticFiles(directory="static"), name="static")

# Include Routers
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(contacts.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(messages.router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Signal Clone API!"}

# WebSocket Endpoint
@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    db = SessionLocal()
    user = None
    try:
        user = get_current_user_from_token(token, db)
    except Exception as e:
        logger.error(f"WebSocket auth failed: {e}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        db.close()
        return

    # Accept connection and register in manager
    await manager.connect(user.id, websocket)
    
    # Set user online
    user.is_online = True
    user.last_seen = datetime.utcnow()
    db.commit()

    # Get user contacts
    contacts = db.query(Contact).filter(
        (Contact.user_id == user.id) | (Contact.contact_user_id == user.id)
    ).all()
    contact_ids = list(set([c.contact_user_id for c in contacts] + [c.user_id for c in contacts]))
    if user.id in contact_ids:
        contact_ids.remove(user.id)

    # Broadcast online status
    last_seen_str = user.last_seen.isoformat()
    await manager.broadcast_user_status(user.id, True, last_seen_str, contact_ids)

    try:
        while True:
            # Maintain connection and listen for typing indicators
            data = await websocket.receive_json()
            event_type = data.get("event_type")
            
            if event_type == "typing":
                conv_id = data.get("conversation_id")
                is_typing = data.get("is_typing", False)
                if conv_id:
                    # Get members of conversation to broadcast to
                    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv_id).all()
                    member_ids = [m.user_id for m in members if m.user_id != user.id]
                    
                    typing_event = {
                        "event_type": "typing",
                        "data": {
                            "conversation_id": conv_id,
                            "user_id": user.id,
                            "is_typing": is_typing
                        }
                    }
                    await manager.broadcast_to_conversation(conv_id, typing_event, member_ids)

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for user {user.id}")
    except Exception as e:
        logger.error(f"WebSocket error for user {user.id}: {e}")
    finally:
        # Clean up
        manager.disconnect(user.id, websocket)
        
        # Mark user offline
        # Need a fresh session to ensure thread safety
        db_cleanup = SessionLocal()
        try:
            cleanup_user = db_cleanup.query(User).filter(User.id == user.id).first()
            if cleanup_user:
                cleanup_user.is_online = False
                cleanup_user.last_seen = datetime.utcnow()
                db_cleanup.commit()
                
                # Broadcast offline status
                last_seen_str = cleanup_user.last_seen.isoformat()
                await manager.broadcast_user_status(cleanup_user.id, False, last_seen_str, contact_ids)
        except Exception as ex:
            logger.error(f"Error during WebSocket disconnect cleanup: {ex}")
        finally:
            db_cleanup.close()
            db.close()
