from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# --- User Schemas ---
class UserBase(BaseModel):
    phone: str
    display_name: Optional[str] = None
    avatar: Optional[str] = None

class UserCreate(UserBase):
    pass

class UserLogin(BaseModel):
    phone: str

class UserVerifyOTP(BaseModel):
    phone: str
    otp: str

class UserResponse(UserBase):
    id: int
    is_online: bool
    last_seen: datetime
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# --- Contact Schemas ---
class ContactCreate(BaseModel):
    contact_phone: str

class ContactResponse(BaseModel):
    contact_user: UserResponse
    created_at: datetime

    class Config:
        from_attributes = True

# --- Reaction Schemas ---
class ReactionBase(BaseModel):
    emoji: str

class ReactionCreate(ReactionBase):
    message_id: int

class ReactionResponse(ReactionBase):
    id: int
    message_id: int
    user_id: int
    created_at: datetime
    user: UserResponse

    class Config:
        from_attributes = True

# --- Message Status Schemas ---
class MessageStatusBase(BaseModel):
    status: str  # "sending", "sent", "delivered", "read"

class MessageStatusResponse(MessageStatusBase):
    user_id: int
    updated_at: datetime

    class Config:
        from_attributes = True

# --- Message Schemas ---
class MessageBase(BaseModel):
    content: Optional[str] = None
    message_type: str = "text"  # "text", "attachment"
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None
    reply_to_id: Optional[int] = None
    disappear_after: Optional[int] = None

class MessageCreate(MessageBase):
    conversation_id: int

class MessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_id: int
    content: Optional[str] = None
    message_type: str
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None
    reply_to_id: Optional[int] = None
    disappear_after: Optional[int] = None
    created_at: datetime
    sender: UserResponse
    statuses: List[MessageStatusResponse] = []
    reactions: List[ReactionResponse] = []
    replied_to: Optional[BaseModel] = None  # To be dynamically updated in python if needed, or simplified

    class Config:
        from_attributes = True

# Workaround for self-referencing model serialization:
class MessageResponseWithReply(MessageResponse):
    replied_to: Optional[MessageResponse] = None

# --- Conversation Member Schemas ---
class ConversationMemberBase(BaseModel):
    user_id: int
    is_admin: bool = False

class ConversationMemberCreate(ConversationMemberBase):
    pass

class ConversationMemberResponse(ConversationMemberBase):
    joined_at: datetime
    user: UserResponse

    class Config:
        from_attributes = True

# --- Conversation Schemas ---
class ConversationBase(BaseModel):
    name: Optional[str] = None
    is_group: bool = False
    avatar: Optional[str] = None

class ConversationCreate(ConversationBase):
    member_ids: List[int]

class ConversationResponse(ConversationBase):
    id: int
    created_by: Optional[int] = None
    created_at: datetime
    members: List[ConversationMemberResponse] = []
    last_message: Optional[MessageResponse] = None
    unread_count: Optional[int] = 0

    class Config:
        from_attributes = True
