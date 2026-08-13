from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc
from datetime import datetime
from typing import List, Optional
import os
import shutil
import asyncio

from ..database import get_db
from ..models import User, Conversation, ConversationMember, Message, MessageStatus, Reaction
from ..schemas import MessageResponse, MessageCreate, ReactionCreate, ReactionResponse
from ..auth import get_current_user
from ..websocket import manager

router = APIRouter(prefix="/messages", tags=["messages"])

# Create attachment directory
UPLOAD_DIR = "./static/attachments"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.get("/{conversation_id}", response_model=List[MessageResponse])
def get_messages(
    conversation_id: int,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve message history for a conversation and mark them as read."""
    # Check membership
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    messages = db.query(Message).filter(Message.conversation_id == conversation_id)\
        .order_by(Message.created_at).limit(limit).all()

    # Filter out and delete expired disappearing messages
    now = datetime.utcnow()
    visible_messages = []
    messages_to_delete = []
    
    for msg in messages:
        if msg.disappear_after:
            # Check if this message was read by the current user and if it has expired
            status_obj = next((s for s in msg.statuses if s.user_id == current_user.id), None)
            if status_obj and status_obj.status == "read":
                elapsed = (now - status_obj.updated_at).total_seconds()
                if elapsed > msg.disappear_after:
                    messages_to_delete.append(msg)
                    continue
        visible_messages.append(msg)
        
    if messages_to_delete:
        for msg in messages_to_delete:
            db.delete(msg)
        db.commit()
        messages = visible_messages

    # Mark all messages sent by others as read for the current user
    unread_statuses = db.query(MessageStatus).join(Message).filter(
        Message.conversation_id == conversation_id,
        Message.sender_id != current_user.id,
        MessageStatus.user_id == current_user.id,
        MessageStatus.status != "read"
    ).all()
    
    if unread_statuses:
        for status_obj in unread_statuses:
            status_obj.status = "read"
            status_obj.updated_at = datetime.utcnow()
        db.commit()

        # Gather conversation members
        members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conversation_id).all()
        member_ids = [m.user_id for m in members]

        # Notify other members that messages have been read
        read_event = {
            "event_type": "messages_read",
            "data": {
                "conversation_id": conversation_id,
                "user_id": current_user.id,
                "message_ids": [s.message_id for s in unread_statuses],
                "status": "read"
            }
        }
        asyncio.create_task(manager.broadcast_to_conversation(conversation_id, read_event, member_ids))

    return messages

@router.post("/", response_model=MessageResponse)
def send_message(
    msg_data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a new text message."""
    # Check membership
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == msg_data.conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )

    # Save message
    new_message = Message(
        conversation_id=msg_data.conversation_id,
        sender_id=current_user.id,
        content=msg_data.content,
        message_type="text",
        reply_to_id=msg_data.reply_to_id,
        disappear_after=msg_data.disappear_after
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    # Get conversation members
    members = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == msg_data.conversation_id
    ).all()
    member_ids = [m.user_id for m in members]

    # Create message statuses for other members (as "sent" initially)
    # The sender's status is read
    sender_status = MessageStatus(message_id=new_message.id, user_id=current_user.id, status="read")
    db.add(sender_status)
    
    for member_id in member_ids:
        if member_id != current_user.id:
            # Check if user is online to set status as delivered, else sent
            is_online = member_id in manager.active_connections
            msg_status = "delivered" if is_online else "sent"
            status_obj = MessageStatus(
                message_id=new_message.id,
                user_id=member_id,
                status=msg_status
            )
            db.add(status_obj)
            
    db.commit()
    db.refresh(new_message)

    # Format reply_to message details if present
    replied_to_data = None
    if new_message.reply_to_id:
        rep_msg = db.query(Message).filter(Message.id == new_message.reply_to_id).first()
        if rep_msg:
            replied_to_data = {
                "id": rep_msg.id,
                "content": rep_msg.content,
                "sender_id": rep_msg.sender_id,
                "message_type": rep_msg.message_type
            }

    # Dispatch to WebSocket
    event = {
        "event_type": "message_new",
        "data": {
            "id": new_message.id,
            "conversation_id": new_message.conversation_id,
            "sender_id": new_message.sender_id,
            "content": new_message.content,
            "message_type": new_message.message_type,
            "attachment_path": new_message.attachment_path,
            "attachment_name": new_message.attachment_name,
            "reply_to_id": new_message.reply_to_id,
            "replied_to": replied_to_data,
            "disappear_after": new_message.disappear_after,
            "created_at": new_message.created_at.isoformat(),
            "sender": {
                "id": current_user.id,
                "phone": current_user.phone,
                "display_name": current_user.display_name,
                "avatar": current_user.avatar,
                "is_online": current_user.is_online,
                "last_seen": current_user.last_seen.isoformat(),
                "created_at": current_user.created_at.isoformat()
            },
            "statuses": [{"user_id": s.user_id, "status": s.status, "updated_at": s.updated_at.isoformat()} for s in new_message.statuses],
            "reactions": []
        }
    }
    
    asyncio.create_task(manager.broadcast_to_conversation(new_message.conversation_id, event, member_ids))

    return new_message

@router.post("/attachment", response_model=MessageResponse)
def upload_attachment(
    conversation_id: int = Form(...),
    reply_to_id: Optional[int] = Form(None),
    disappear_after: Optional[int] = Form(None),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload an attachment (image, PDF, etc.) and send it as a message."""
    # Check membership
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )

    # Save the file locally
    file_extension = os.path.splitext(file.filename)[1]
    safe_filename = f"{datetime.utcnow().timestamp()}_{file.filename.replace(' ', '_')}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Save message in db
    new_message = Message(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        content=f"Sent an attachment: {file.filename}",
        message_type="attachment",
        attachment_path=f"/static/attachments/{safe_filename}",
        attachment_name=file.filename,
        reply_to_id=reply_to_id,
        disappear_after=disappear_after
    )
    db.add(new_message)
    db.commit()
    db.refresh(new_message)

    # Get conversation members
    members = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id
    ).all()
    member_ids = [m.user_id for m in members]

    # Create status entries
    sender_status = MessageStatus(message_id=new_message.id, user_id=current_user.id, status="read")
    db.add(sender_status)
    
    for member_id in member_ids:
        if member_id != current_user.id:
            is_online = member_id in manager.active_connections
            msg_status = "delivered" if is_online else "sent"
            status_obj = MessageStatus(
                message_id=new_message.id,
                user_id=member_id,
                status=msg_status
            )
            db.add(status_obj)
            
    db.commit()
    db.refresh(new_message)

    # Format reply_to message details if present
    replied_to_data = None
    if new_message.reply_to_id:
        rep_msg = db.query(Message).filter(Message.id == new_message.reply_to_id).first()
        if rep_msg:
            replied_to_data = {
                "id": rep_msg.id,
                "content": rep_msg.content,
                "sender_id": rep_msg.sender_id,
                "message_type": rep_msg.message_type
            }

    # Dispatch to WebSocket
    event = {
        "event_type": "message_new",
        "data": {
            "id": new_message.id,
            "conversation_id": new_message.conversation_id,
            "sender_id": new_message.sender_id,
            "content": new_message.content,
            "message_type": new_message.message_type,
            "attachment_path": new_message.attachment_path,
            "attachment_name": new_message.attachment_name,
            "reply_to_id": new_message.reply_to_id,
            "replied_to": replied_to_data,
            "disappear_after": new_message.disappear_after,
            "created_at": new_message.created_at.isoformat(),
            "sender": {
                "id": current_user.id,
                "phone": current_user.phone,
                "display_name": current_user.display_name,
                "avatar": current_user.avatar,
                "is_online": current_user.is_online,
                "last_seen": current_user.last_seen.isoformat(),
                "created_at": current_user.created_at.isoformat()
            },
            "statuses": [{"user_id": s.user_id, "status": s.status, "updated_at": s.updated_at.isoformat()} for s in new_message.statuses],
            "reactions": []
        }
    }
    
    asyncio.create_task(manager.broadcast_to_conversation(new_message.conversation_id, event, member_ids))

    return new_message

@router.post("/react", response_model=ReactionResponse)
def add_reaction(
    react_data: ReactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add or update an emoji reaction on a message."""
    # Check if message exists
    message = db.query(Message).filter(Message.id == react_data.message_id).first()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
        
    # Check membership in the conversation
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == message.conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    # Check if user already reacted with this emoji, or update it
    existing_reaction = db.query(Reaction).filter(
        Reaction.message_id == react_data.message_id,
        Reaction.user_id == current_user.id
    ).first()
    
    if existing_reaction:
        existing_reaction.emoji = react_data.emoji
        db.commit()
        db.refresh(existing_reaction)
        reaction = existing_reaction
    else:
        new_reaction = Reaction(
            message_id=react_data.message_id,
            user_id=current_user.id,
            emoji=react_data.emoji
        )
        db.add(new_reaction)
        db.commit()
        db.refresh(new_reaction)
        reaction = new_reaction

    # Notify members via websocket
    members = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == message.conversation_id
    ).all()
    member_ids = [m.user_id for m in members]

    event = {
        "event_type": "reaction_new",
        "data": {
            "id": reaction.id,
            "message_id": reaction.message_id,
            "user_id": reaction.user_id,
            "emoji": reaction.emoji,
            "created_at": reaction.created_at.isoformat(),
            "user": {
                "id": current_user.id,
                "phone": current_user.phone,
                "display_name": current_user.display_name,
                "avatar": current_user.avatar
            }
        }
    }
    
    asyncio.create_task(manager.broadcast_to_conversation(message.conversation_id, event, member_ids))

    return reaction

@router.delete("/react/{message_id}", response_model=dict)
def delete_reaction(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove user's emoji reaction from a message."""
    message = db.query(Message).filter(Message.id == message_id).first()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found"
        )
        
    reaction = db.query(Reaction).filter(
        Reaction.message_id == message_id,
        Reaction.user_id == current_user.id
    ).first()
    
    if not reaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reaction not found"
        )
        
    emoji_removed = reaction.emoji
    db.delete(reaction)
    db.commit()

    # Notify members via websocket
    members = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == message.conversation_id
    ).all()
    member_ids = [m.user_id for m in members]

    event = {
        "event_type": "reaction_delete",
        "data": {
            "message_id": message_id,
            "user_id": current_user.id,
            "emoji": emoji_removed
        }
    }
    
    asyncio.create_task(manager.broadcast_to_conversation(message.conversation_id, event, member_ids))

    return {"status": "success", "message": "Reaction removed"}
