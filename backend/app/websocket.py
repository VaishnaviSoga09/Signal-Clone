from fastapi import WebSocket
from typing import Dict, List, Any
import json
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        # Maps user_id (int) -> list of WebSocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"User {user_id} connected via WebSocket. Active sessions: {len(self.active_connections[user_id])}")

    def disconnect(self, user_id: int, websocket: WebSocket):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        logger.info(f"User {user_id} disconnected from WebSocket.")

    async def send_to_user(self, user_id: int, event: Dict[str, Any]):
        """Send an event to all active sessions of a single user."""
        if user_id in self.active_connections:
            closed_sockets = []
            for websocket in self.active_connections[user_id]:
                try:
                    await websocket.send_text(json.dumps(event))
                except Exception as e:
                    logger.error(f"Error sending WebSocket message to user {user_id}: {e}")
                    closed_sockets.append(websocket)
            
            # Clean up any dead sockets
            for socket in closed_sockets:
                self.disconnect(user_id, socket)

    async def broadcast_to_conversation(self, conversation_id: int, event: Dict[str, Any], member_ids: List[int]):
        """Broadcasts an event to all members of a conversation who are online."""
        for member_id in member_ids:
            await self.send_to_user(member_id, event)

    async def broadcast_user_status(self, user_id: int, is_online: bool, last_seen_str: str, contact_ids: List[int]):
        """Send user online/offline status updates to all their contacts."""
        event = {
            "event_type": "user_status",
            "data": {
                "user_id": user_id,
                "is_online": is_online,
                "last_seen": last_seen_str
            }
        }
        for contact_id in contact_ids:
            await self.send_to_user(contact_id, event)

manager = ConnectionManager()
