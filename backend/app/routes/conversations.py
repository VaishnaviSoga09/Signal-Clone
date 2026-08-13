from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, desc
from datetime import datetime
from typing import List, Optional
from ..database import get_db
from ..models import User, Conversation, ConversationMember, Message, MessageStatus
from ..schemas import ConversationResponse, ConversationCreate, UserResponse, MessageResponse
from ..auth import get_current_user
from ..websocket import manager

router = APIRouter(prefix="/conversations", tags=["conversations"])

@router.get("/", response_model=List[ConversationResponse])
def get_conversations(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Retrieve all conversations for the current user, ordered by most recent message."""
    # Find all conversations the user is a member of
    memberships = db.query(ConversationMember).filter(ConversationMember.user_id == current_user.id).all()
    conv_ids = [m.conversation_id for m in memberships]

    conversations = db.query(Conversation).filter(Conversation.id.in_(conv_ids)).all()

    response_data = []
    for conv in conversations:
        # Get members
        members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
        
        # Get last message
        last_message = db.query(Message).filter(Message.conversation_id == conv.id)\
            .order_by(desc(Message.created_at)).first()
            
        # Count unread messages (messages where sender is not current_user and status for current_user is not 'read')
        unread_count = 0
        if last_message:
            unread_count = db.query(Message).join(MessageStatus).filter(
                Message.conversation_id == conv.id,
                Message.sender_id != current_user.id,
                MessageStatus.user_id == current_user.id,
                MessageStatus.status != "read"
            ).count()

        # Build response
        # To match the Pydantic ConversationResponse model:
        conv_res = {
            "id": conv.id,
            "name": conv.name,
            "is_group": conv.is_group,
            "avatar": conv.avatar,
            "created_by": conv.created_by,
            "created_at": conv.created_at,
            "members": members,
            "last_message": last_message,
            "unread_count": unread_count
        }
        response_data.append(conv_res)

    # Sort conversations by last_message.created_at desc or created_at desc
    response_data.sort(
        key=lambda x: x["last_message"].created_at if x["last_message"] else x["created_at"],
        reverse=True
    )

    return response_data

@router.post("/", response_model=ConversationResponse)
def create_conversation(
    conv_data: ConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new 1-on-1 or group conversation."""
    member_ids = list(set(conv_data.member_ids))
    if current_user.id not in member_ids:
        member_ids.append(current_user.id)

    # If it is a 1-to-1 conversation, check if it already exists
    if not conv_data.is_group and len(member_ids) == 2:
        other_user_id = [uid for uid in member_ids if uid != current_user.id][0]
        # Query 1-to-1 conversations between these two users
        existing_conv = db.query(Conversation).filter(Conversation.is_group == False).filter(
            Conversation.id.in_(
                db.query(ConversationMember.conversation_id)
                .filter(ConversationMember.user_id == current_user.id)
            )
        ).filter(
            Conversation.id.in_(
                db.query(ConversationMember.conversation_id)
                .filter(ConversationMember.user_id == other_user_id)
            )
        ).first()

        if existing_conv:
            # Populate members and return
            members = db.query(ConversationMember).filter(ConversationMember.conversation_id == existing_conv.id).all()
            last_msg = db.query(Message).filter(Message.conversation_id == existing_conv.id).order_by(desc(Message.created_at)).first()
            return {
                "id": existing_conv.id,
                "name": existing_conv.name,
                "is_group": existing_conv.is_group,
                "avatar": existing_conv.avatar,
                "created_by": existing_conv.created_by,
                "created_at": existing_conv.created_at,
                "members": members,
                "last_message": last_msg,
                "unread_count": 0
            }

    # Create new conversation
    new_conv = Conversation(
        name=conv_data.name,
        is_group=conv_data.is_group,
        avatar=conv_data.avatar,
        created_by=current_user.id
    )
    
    if conv_data.is_group and not conv_data.avatar:
        new_conv.avatar = f"https://api.dicebear.com/7.x/initials/svg?seed={conv_data.name or 'Group'}"

    db.add(new_conv)
    db.commit()
    db.refresh(new_conv)

    # Create membership records
    members = []
    for uid in member_ids:
        is_admin = (uid == current_user.id) if conv_data.is_group else False
        member = ConversationMember(
            conversation_id=new_conv.id,
            user_id=uid,
            is_admin=is_admin
        )
        db.add(member)
        members.append(member)
    
    db.commit()
    for m in members:
        db.refresh(m)

    # Notify members via websocket about new conversation
    event = {
        "event_type": "conversation_new",
        "data": {
            "id": new_conv.id,
            "name": new_conv.name,
            "is_group": new_conv.is_group,
            "avatar": new_conv.avatar,
            "created_by": new_conv.created_by,
            "created_at": new_conv.created_at.isoformat()
        }
    }
    # Send notify to all members online
    for m_id in member_ids:
        # We don't have to wait for websocket delivery to block HTTP
        import asyncio
        asyncio.create_task(manager.send_to_user(m_id, event))

    return {
        "id": new_conv.id,
        "name": new_conv.name,
        "is_group": new_conv.is_group,
        "avatar": new_conv.avatar,
        "created_by": new_conv.created_by,
        "created_at": new_conv.created_at,
        "members": members,
        "last_message": None,
        "unread_count": 0
    }

@router.get("/{conversation_id}", response_model=ConversationResponse)
def get_conversation_details(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve details for a single conversation."""
    member_check = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not member_check:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
        
    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
    last_msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).first()
    
    unread_count = db.query(Message).join(MessageStatus).filter(
        Message.conversation_id == conv.id,
        Message.sender_id != current_user.id,
        MessageStatus.user_id == current_user.id,
        MessageStatus.status != "read"
    ).count()

    return {
        "id": conv.id,
        "name": conv.name,
        "is_group": conv.is_group,
        "avatar": conv.avatar,
        "created_by": conv.created_by,
        "created_at": conv.created_at,
        "members": members,
        "last_message": last_msg,
        "unread_count": unread_count
    }

@router.put("/{conversation_id}", response_model=ConversationResponse)
def update_conversation(
    conversation_id: int,
    name: Optional[str] = None,
    avatar: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update conversation name or avatar (Groups only)."""
    # Check membership and admin status
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv.is_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot update details of 1-to-1 conversations"
        )
        
    if not membership.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can modify group details"
        )
        
    if name:
        conv.name = name
    if avatar:
        conv.avatar = avatar
        
    db.commit()
    db.refresh(conv)
    
    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
    last_msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).first()
    
    return {
        "id": conv.id,
        "name": conv.name,
        "is_group": conv.is_group,
        "avatar": conv.avatar,
        "created_by": conv.created_by,
        "created_at": conv.created_at,
        "members": members,
        "last_message": last_msg,
        "unread_count": 0
    }

@router.post("/{conversation_id}/members", response_model=ConversationResponse)
def add_group_members(
    conversation_id: int,
    user_ids: List[int],
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add new users to a group conversation."""
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv.is_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add members to 1-to-1 conversations"
        )
        
    # Check if they are already in the group
    for uid in user_ids:
        existing = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == uid
        ).first()
        if not existing:
            new_member = ConversationMember(
                conversation_id=conversation_id,
                user_id=uid,
                is_admin=False
            )
            db.add(new_member)
            
    db.commit()
    db.refresh(conv)
    
    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
    last_msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).first()
    
    return {
        "id": conv.id,
        "name": conv.name,
        "is_group": conv.is_group,
        "avatar": conv.avatar,
        "created_by": conv.created_by,
        "created_at": conv.created_at,
        "members": members,
        "last_message": last_msg,
        "unread_count": 0
    }

@router.delete("/{conversation_id}/members/{user_id}", response_model=ConversationResponse)
def remove_group_member(
    conversation_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a user from a group conversation (admin only, unless removing self)."""
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv.is_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove members from 1-to-1 conversations"
        )
        
    if user_id != current_user.id and not membership.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can remove other members"
        )
        
    target_member = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == user_id
    ).first()
    
    if target_member:
        db.delete(target_member)
        db.commit()
        
    db.refresh(conv)
    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
    last_msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).first()
    
    return {
        "id": conv.id,
        "name": conv.name,
        "is_group": conv.is_group,
        "avatar": conv.avatar,
        "created_by": conv.created_by,
        "created_at": conv.created_at,
        "members": members,
        "last_message": last_msg,
        "unread_count": 0
    }

@router.put("/{conversation_id}/members/{user_id}/promote", response_model=ConversationResponse)
async def promote_group_member(
    conversation_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Promote a member to admin in a group conversation (admin only)."""
    membership = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == current_user.id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this conversation"
        )
        
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversation not found"
        )
        
    if not conv.is_group:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot promote members in 1-to-1 conversations"
        )
        
    if not membership.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can promote other members"
        )
        
    target_member = db.query(ConversationMember).filter(
        ConversationMember.conversation_id == conversation_id,
        ConversationMember.user_id == user_id
    ).first()
    
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target user is not a member of this conversation"
        )
        
    target_member.is_admin = True
    db.commit()
    db.refresh(conv)
    
    # Notify members via websocket
    members = db.query(ConversationMember).filter(ConversationMember.conversation_id == conv.id).all()
    member_ids = [m.user_id for m in members]
    
    event = {
        "event_type": "conversation_new",
        "data": {
            "id": conv.id,
            "name": conv.name,
            "is_group": conv.is_group,
            "avatar": conv.avatar,
            "created_by": conv.created_by,
            "created_at": conv.created_at.isoformat()
        }
    }
    
    import asyncio
    for m_id in member_ids:
        asyncio.create_task(manager.send_to_user(m_id, event))
        
    last_msg = db.query(Message).filter(Message.conversation_id == conv.id).order_by(desc(Message.created_at)).first()
    
    return {
        "id": conv.id,
        "name": conv.name,
        "is_group": conv.is_group,
        "avatar": conv.avatar,
        "created_by": conv.created_by,
        "created_at": conv.created_at,
        "members": members,
        "last_message": last_msg,
        "unread_count": 0
    }

